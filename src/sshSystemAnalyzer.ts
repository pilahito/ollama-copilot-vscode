/**
 * Analizador de sistema local/SSH — recolección, optimización autónoma estilo Grok.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';
import { LocalAgent } from './agent';
import {
  buildGrokSystemBlock,
  buildGrokUserPrompt,
  getGrokMaxHours,
  isGrokModeEnabled,
} from './grokMode';

const execFileAsync = promisify(execFile);

export interface SshConfig {
  enabled: boolean;
  target: string | null;
  display: string;
  invoke: string;
  port: number;
}

export interface SystemSnapshot {
  collectedAt: string;
  target: 'local' | 'ssh';
  display: string;
  raw: string;
  osHint: string;
}

const LINUX_DISCOVERY = `
set +e
echo "=== HOST ==="
hostname -f 2>/dev/null || hostname
echo "=== OS ==="
cat /etc/os-release 2>/dev/null | head -20
uname -a
echo "=== UPTIME ==="
uptime
echo "=== DISK ==="
df -hT 2>/dev/null | head -25
echo "=== MEMORY ==="
free -h 2>/dev/null || free -m
echo "=== CPU ==="
nproc 2>/dev/null; lscpu 2>/dev/null | grep -E 'Model name|CPU\\(s\\)|Architecture' | head -5
echo "=== FAILED UNITS ==="
systemctl --failed --no-pager 2>/dev/null | head -30
echo "=== LISTEN PORTS ==="
ss -tlnp 2>/dev/null | head -25 || netstat -tlnp 2>/dev/null | head -25
echo "=== TOP MEM ==="
ps aux --sort=-%mem 2>/dev/null | head -12
echo "=== APT UPGRADABLE ==="
apt list --upgradable 2>/dev/null | head -15
echo "=== LAST ERRORS ==="
journalctl -p err -n 20 --no-pager 2>/dev/null | tail -20
echo "=== NVIDIA ==="
nvidia-smi --query-gpu=name,driver_version,memory.total,temperature.gpu --format=csv,noheader 2>/dev/null || echo "no-nvidia"
echo "=== DOCKER ==="
docker ps -a 2>/dev/null | head -8 || echo "no-docker"
echo "=== END ==="
`.trim();

const WINDOWS_DISCOVERY = `
Write-Output "=== HOST ==="
hostname
Write-Output "=== OS ==="
systeminfo | Select-String "OS Name","OS Version","System Type","Total Physical Memory"
Write-Output "=== DISK ==="
Get-PSDrive -PSProvider FileSystem | Format-Table Name,Used,Free -AutoSize
Write-Output "=== SERVICES STOPPED CRITICAL ==="
Get-Service | Where-Object {$_.Status -eq 'Stopped' -and $_.StartType -eq 'Automatic'} | Select-Object -First 15 Name,Status
Write-Output "=== END ==="
`.trim();

export function getSshConfig(): SshConfig {
  const config = vscode.workspace.getConfiguration('local');
  const sshHost = config.get<string>('sshHost', '').trim();
  const sshUser = config.get<string>('sshUser', '').trim();
  const sshPort = config.get<number>('sshPort', 22);
  const sshCommand = config.get<string>('sshCommand', 'ssh');
  const automation = config.get<boolean>('enableAutomation', false);
  const enabled = automation && sshHost.length > 0;
  const target = enabled
    ? `${sshUser ? `${sshUser}@` : ''}${sshHost}`
    : null;
  const portFlag = sshPort !== 22 ? ` -p ${sshPort}` : '';
  const invoke = target ? `${sshCommand}${portFlag} ${target}` : '';
  const display = target
    ? (sshPort !== 22 ? `${target}:${sshPort}` : target)
    : 'local';

  return { enabled, target, display, invoke, port: sshPort };
}

export async function runRemoteShell(
  invoke: string,
  script: string,
  timeoutMs = 180_000
): Promise<string> {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  const remote = invoke
    ? `${invoke} "echo ${b64} | base64 -d | bash"`
    : `echo ${b64} | base64 -d | bash`;
  const { stdout, stderr } = await execFileAsync('bash', ['-lc', remote], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return [stdout, stderr].filter((s) => s.trim()).join('\n');
}

export async function collectSystemSnapshot(
  preferSsh: boolean,
  onProgress?: (msg: string) => void
): Promise<SystemSnapshot> {
  const ssh = getSshConfig();
  const useSsh = preferSsh && ssh.enabled && !!ssh.invoke;
  const log = onProgress ?? (() => undefined);

  log(useSsh ? `📡 Recolectando datos SSH (${ssh.display})…` : '🖥️ Recolectando datos del sistema local…');

  let raw = '';
  try {
    raw = await runRemoteShell(useSsh ? ssh.invoke : '', LINUX_DISCOVERY);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`⚠️ Linux discovery falló (${msg.slice(0, 80)}), probando local…`);
    try {
      raw = await runRemoteShell('', LINUX_DISCOVERY);
    } catch {
      raw = `Error recolectando snapshot: ${msg}`;
    }
  }

  const osHint = /ubuntu|debian|fedora|arch|cinnamon|linux/i.test(raw)
    ? 'linux'
    : /windows|microsoft/i.test(raw)
      ? 'windows'
      : 'unknown';

  return {
    collectedAt: new Date().toISOString(),
    target: useSsh ? 'ssh' : 'local',
    display: useSsh ? ssh.display : 'local',
    raw: raw.slice(0, 24_000),
    osHint,
  };
}

function parseCommands(text: string): Array<{ command: string; reason: string }> {
  const out: Array<{ command: string; reason: string }> = [];
  const re = /COMANDO:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)(?:\n|<<FIN>>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const command = m[1].trim();
    const reason = m[2].trim();
    if (command) { out.push({ command, reason }); }
  }
  return out;
}

function isBlockedCommand(command: string): boolean {
  const n = command.trim().toLowerCase();
  return /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=|:(){ :|:& };:)\b/.test(n);
}

async function executeSafeCommands(
  commands: Array<{ command: string; reason: string }>,
  cwd: string,
  onProgress: (msg: string) => void
): Promise<number> {
  let ran = 0;
  for (const { command, reason } of commands) {
    if (isBlockedCommand(command)) {
      onProgress(`⛔ Bloqueado: ${command}`);
      continue;
    }
    onProgress(`▶ ${command}`);
    try {
      const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 300_000,
      });
      if (stdout.trim()) { onProgress(stdout.trim().slice(0, 500)); }
      if (stderr.trim()) { onProgress(`stderr: ${stderr.trim().slice(0, 300)}`); }
      ran++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onProgress(`⚠️ Error: ${msg.slice(0, 200)}`);
    }
  }
  return ran;
}

export class SshGrokOptimizer {
  constructor(
    private readonly ollama: OllamaClient,
    private readonly agent: LocalAgent | null,
    private readonly log: (line: string) => void
  ) {}

  async run(options?: {
    preferSsh?: boolean;
    maxHours?: number;
    onProgress?: (msg: string) => void;
  }): Promise<{ rounds: number; complete: boolean; summary: string }> {
    if (!isGrokModeEnabled()) {
      throw new Error('Activa local.grokMode en Settings para usar el optimizador Grok.');
    }

    const onProgress = options?.onProgress ?? (() => undefined);
    const maxHours = options?.maxHours ?? getGrokMaxHours();
    const deadline = Date.now() + maxHours * 3_600_000;
    const ssh = getSshConfig();
    const preferSsh = options?.preferSsh ?? ssh.enabled;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.env.HOME ?? '/tmp';

    let round = 0;
    let priorFindings = '';
    let complete = false;
    const summaries: string[] = [];

    onProgress(`🚀 Modo Grok iniciado (máx. ${maxHours}h) — ${preferSsh && ssh.enabled ? ssh.display : 'local'}`);
    this.log(`[grok] inicio maxHours=${maxHours} target=${preferSsh ? ssh.display : 'local'}`);

    while (Date.now() < deadline) {
      round++;
      onProgress(`\n═══ Ronda ${round} ═══`);

      const snapshot = await collectSystemSnapshot(preferSsh, onProgress);
      const grokBlock = buildGrokSystemBlock(snapshot.target, snapshot.display);
      const userPrompt = buildGrokUserPrompt(snapshot.raw, round, priorFindings);

      onProgress('🧠 Ollama analizando sistema…');

      let response = '';
      if (this.agent && vscode.workspace.workspaceFolders?.length) {
        const result = await this.agent.handleRequest(
          `${grokBlock}\n\n${userPrompt}`,
          (p) => onProgress(p),
          this.ollama.getModelForTask('agent')
        );
        response = result.explanation;
        priorFindings += `\nRonda ${round}: ${result.explanation.slice(0, 800)}`;
        if (/OPTIMIZACIÓN COMPLETA|OPTIMIZACION COMPLETA/i.test(response)) {
          complete = true;
          summaries.push(response.slice(0, 1500));
          break;
        }
        await new Promise<void>((r) => setTimeout(r, 15_000));
        continue;
      }

      const messages = [
        { role: 'system' as const, content: grokBlock },
        { role: 'user' as const, content: userPrompt },
      ];
      response = await this.ollama.chatStream(messages, (t) => {
        if (t.includes('\n')) { onProgress(t.trim()); }
      }, this.ollama.getModelForTask('agent'));

      const commands = parseCommands(response);
      if (commands.length > 0) {
        onProgress(`⚙️ Ejecutando ${commands.length} comando(s)…`);
        await executeSafeCommands(commands, cwd, onProgress);
      }

      priorFindings += `\nRonda ${round}: ${response.slice(0, 800)}`;
      summaries.push(response.slice(0, 600));

      if (/OPTIMIZACIÓN COMPLETA|OPTIMIZACION COMPLETA/i.test(response)) {
        complete = true;
        break;
      }

      if (commands.length === 0 && round > 1) {
        onProgress('ℹ️ Sin más comandos — finalizando.');
        break;
      }

      await new Promise<void>((r) => setTimeout(r, 20_000));
    }

    const summary = summaries.join('\n---\n').slice(0, 4000) ||
      `Completadas ${round} rondas de análisis.`;
    onProgress(complete ? '✅ Optimización completa' : `✓ Finalizado tras ${round} ronda(s)`);
    this.log(`[grok] fin rounds=${round} complete=${complete}`);
    return { rounds: round, complete, summary };
  }
}

export function buildSshAnalyzePrompt(snapshot: SystemSnapshot): string {
  return (
    buildGrokSystemBlock(snapshot.target, snapshot.display) +
    '\n' +
    buildGrokUserPrompt(snapshot.raw, 1) +
    '\n\nAnaliza primero sin cambiar nada crítico; luego propón mejoras.'
  );
}