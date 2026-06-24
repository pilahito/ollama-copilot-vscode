/**
 * Herramientas del agente autónomo — estilo Cursor/Grok Build con Ollama.
 * Lee, escribe, busca y ejecuta terminal con feedback al modelo.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export type AgentToolName =
  | 'read'
  | 'write'
  | 'edit'
  | 'grep'
  | 'list'
  | 'run'
  | 'compile'
  | 'test'
  | 'done';

export interface AgentToolCall {
  tool: AgentToolName;
  path?: string;
  pattern?: string;
  command?: string;
  search?: string;
  replace?: string;
  content?: string;
  reason?: string;
  summary?: string;
}

export interface ToolContext {
  rootPath: string;
  allowTerminal: boolean;
  maxReadLines?: number;
}

export interface ToolResult {
  tool: AgentToolName;
  ok: boolean;
  output: string;
}

const BLOCKED_CMD =
  /\b(rm\s+-rf\s+\/|rm\s+-rf\s+~\s*$|mkfs|dd\s+if=|:(){ :|:& };:|>\s*\/dev\/sd|shutdown\s+-h\s+now|init\s+0)\b/i;

const ALLOWED_PREFIXES = [
  'git ', 'gh ', 'npm ', 'npx ', 'node ', 'yarn ', 'pnpm ', 'bun ', 'ollama ',
  'python ', 'python3 ', 'pip ', 'pip3 ', 'cargo ', 'go ', 'make ', 'cmake ',
  'docker ', 'docker-compose ', 'ssh ', 'sudo ', 'systemctl ', 'journalctl ',
  'apt ', 'apt-get ', 'ufw ', 'nginx ', 'mkdir ', 'cp ', 'mv ', 'touch ', 'chmod ',
  'cat ', 'grep ', 'rg ', 'find ', 'ls ', 'head ', 'tail ', 'wc ', 'sed ', 'awk ',
  'tar ', 'curl ', 'wget ', 'code ', 'xdotool ', 'gnome-screenshot ', 'bash ', 'sh ',
  'powershell ', 'pwsh ', 'wsl ', 'echo ', 'test ', 'cd ',
];

export function isAllowedShellCommand(command: string): boolean {
  const n = command.trim().toLowerCase();
  if (!n || BLOCKED_CMD.test(n)) { return false; }
  if (/^sudo\s+(rm|mkfs|dd|shutdown|reboot|init|halt)\b/.test(n)) { return false; }
  return ALLOWED_PREFIXES.some((p) => n.startsWith(p));
}

function safePath(root: string, rel: string): string | null {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!cleaned || cleaned.includes('..')) { return null; }
  const full = path.resolve(root, cleaned);
  if (!full.startsWith(path.resolve(root))) { return null; }
  return full;
}

/** Parsea bloques TOOL: del modelo (compatible con formato ACCION/COMANDO). */
export function parseAgentToolCalls(raw: string): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  const upper = raw;

  const doneM = /TOOL:\s*DONE\s*\|\s*RESUMEN:\s*(.+)/i.exec(upper);
  if (doneM) {
    calls.push({ tool: 'done', summary: doneM[1].trim() });
  }

  const readRe = /TOOL:\s*READ\s*\|\s*PATH:\s*(.+?)(?:\s*\|\s*MOTIVO:\s*(.+?))?(?:\n|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = readRe.exec(upper)) !== null) {
    calls.push({ tool: 'read', path: m[1].trim(), reason: m[2]?.trim() });
  }

  const listRe = /TOOL:\s*LIST\s*\|\s*PATH:\s*(.+?)(?:\s*\|\s*MOTIVO:\s*(.+?))?(?:\n|$)/gi;
  while ((m = listRe.exec(upper)) !== null) {
    calls.push({ tool: 'list', path: m[1].trim(), reason: m[2]?.trim() });
  }

  const grepRe =
    /TOOL:\s*GREP\s*\|\s*PATTERN:\s*(.+?)\s*\|\s*PATH:\s*(.+?)(?:\s*\|\s*MOTIVO:\s*(.+?))?(?:\n|$)/gi;
  while ((m = grepRe.exec(upper)) !== null) {
    calls.push({ tool: 'grep', pattern: m[1].trim(), path: m[2].trim(), reason: m[3]?.trim() });
  }

  const runRe = /TOOL:\s*RUN\s*\|\s*CMD:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)(?:\n|<<FIN>>)/gi;
  while ((m = runRe.exec(upper)) !== null) {
    calls.push({ tool: 'run', command: m[1].trim(), reason: m[2].trim() });
  }

  const compileRe = /TOOL:\s*COMPILE(?:\s*\|\s*MOTIVO:\s*(.+?))?(?:\n|$)/gi;
  while ((m = compileRe.exec(upper)) !== null) {
    calls.push({ tool: 'compile', reason: m[1]?.trim() });
  }

  const testRe = /TOOL:\s*TEST(?:\s*\|\s*MOTIVO:\s*(.+?))?(?:\n|$)/gi;
  while ((m = testRe.exec(upper)) !== null) {
    calls.push({ tool: 'test', reason: m[1]?.trim() });
  }

  const editRe =
    /TOOL:\s*EDIT\s*\|\s*PATH:\s*(.+?)\s*\|\s*BUSCAR:\s*(.+?)\s*\|\s*REEMPLAZAR:\s*(.+?)(?:\s*\|\s*MOTIVO:\s*(.+?))?(?:\n|$)/gi;
  while ((m = editRe.exec(upper)) !== null) {
    calls.push({
      tool: 'edit',
      path: m[1].trim(),
      search: m[2].trim(),
      replace: m[3].trim(),
      reason: m[4]?.trim(),
    });
  }

  const writeRe =
    /TOOL:\s*WRITE\s*\|\s*PATH:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n<<CONTENIDO>>\n([\s\S]*?)<<FIN>>/gi;
  while ((m = writeRe.exec(upper)) !== null) {
    calls.push({
      tool: 'write',
      path: m[1].trim(),
      reason: m[2].trim(),
      content: m[3],
    });
  }

  return calls;
}

async function toolRead(ctx: ToolContext, rel: string): Promise<string> {
  const full = safePath(ctx.rootPath, rel);
  if (!full) { return 'ERROR: ruta inválida'; }
  if (!fs.existsSync(full)) { return `ERROR: no existe ${rel}`; }
  const stat = fs.statSync(full);
  if (!stat.isFile()) { return `ERROR: ${rel} no es archivo`; }
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  const max = ctx.maxReadLines ?? 400;
  const slice = lines.slice(0, max);
  const numbered = slice.map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');
  const tail = lines.length > max ? `\n… (${lines.length - max} líneas más)` : '';
  return `READ ${rel} (${lines.length} líneas):\n${numbered}${tail}`;
}

async function toolList(ctx: ToolContext, rel: string): Promise<string> {
  const full = safePath(ctx.rootPath, rel || '.');
  if (!full) { return 'ERROR: ruta inválida'; }
  if (!fs.existsSync(full)) { return `ERROR: no existe ${rel}`; }

  const walk = (dir: string, depth: number, prefix: string): string[] => {
    if (depth > 3) { return []; }
    const out: string[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [`${prefix}[sin acceso]`];
    }
    const sorted = entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const e of sorted.slice(0, 80)) {
      const p = path.join(dir, e.name);
      const relP = path.relative(ctx.rootPath, p).replace(/\\/g, '/');
      out.push(`${prefix}${e.isDirectory() ? '📁' : '📄'} ${relP}`);
      if (e.isDirectory() && depth < 2) {
        out.push(...walk(p, depth + 1, prefix + '  '));
      }
    }
    return out;
  };

  const stat = fs.statSync(full);
  if (!stat.isDirectory()) { return `LIST: ${rel} es archivo, no carpeta`; }
  return `LIST ${rel}:\n${walk(full, 0, '').join('\n')}`;
}

async function toolGrep(ctx: ToolContext, pattern: string, rel: string): Promise<string> {
  const full = safePath(ctx.rootPath, rel || '.');
  if (!full) { return 'ERROR: ruta inválida'; }
  try {
    const { stdout } = await execFileAsync('bash', [
      '-lc',
      `rg -n --max-count 40 --glob '!.git' --glob '!node_modules' --glob '!dist' ${JSON.stringify(pattern)} ${JSON.stringify(full)} 2>/dev/null || grep -rn --include='*.ts' --include='*.js' --include='*.json' --include='*.md' -m 40 ${JSON.stringify(pattern)} ${JSON.stringify(full)} 2>/dev/null | head -40`,
    ], { cwd: ctx.rootPath, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 });
    return stdout.trim() || `GREP "${pattern}": sin coincidencias`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `GREP error: ${msg.slice(0, 300)}`;
  }
}

async function toolWrite(ctx: ToolContext, rel: string, content: string): Promise<string> {
  const full = safePath(ctx.rootPath, rel);
  if (!full) { return 'ERROR: ruta inválida'; }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return `WRITE OK: ${rel} (${content.length} bytes)`;
}

async function toolEdit(ctx: ToolContext, rel: string, search: string, replace: string): Promise<string> {
  const full = safePath(ctx.rootPath, rel);
  if (!full) { return 'ERROR: ruta inválida'; }
  if (!fs.existsSync(full)) { return `ERROR: no existe ${rel}`; }
  const before = fs.readFileSync(full, 'utf8');
  if (!before.includes(search)) {
    return `EDIT FAIL: texto BUSCAR no encontrado en ${rel}`;
  }
  const after = before.replace(search, replace);
  fs.writeFileSync(full, after, 'utf8');
  return `EDIT OK: ${rel} (${before.length} → ${after.length} bytes)`;
}

async function detectNpmScript(ctx: ToolContext, names: string[]): Promise<string | null> {
  const pkgPath = path.join(ctx.rootPath, 'package.json');
  if (!fs.existsSync(pkgPath)) { return null; }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    for (const n of names) {
      if (pkg.scripts?.[n]) { return `npm run ${n}`; }
    }
  } catch { /* */ }
  return null;
}

async function toolRun(ctx: ToolContext, command: string): Promise<string> {
  if (!ctx.allowTerminal) { return 'ERROR: terminal desactivada'; }
  if (!isAllowedShellCommand(command)) { return `ERROR: comando bloqueado: ${command}`; }
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      cwd: ctx.rootPath,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 180_000,
    });
    const out = [stdout, stderr].filter((s) => s.trim()).join('\n').trim();
    return out.slice(0, 6000) || `RUN OK (sin salida): ${command}`;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const parts = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim();
    return `RUN FAIL: ${command}\n${parts.slice(0, 4000)}`;
  }
}

export async function executeAgentTool(call: AgentToolCall, ctx: ToolContext): Promise<ToolResult> {
  try {
    switch (call.tool) {
      case 'read':
        return { tool: 'read', ok: true, output: await toolRead(ctx, call.path ?? '') };
      case 'list':
        return { tool: 'list', ok: true, output: await toolList(ctx, call.path ?? '.') };
      case 'grep':
        return { tool: 'grep', ok: true, output: await toolGrep(ctx, call.pattern ?? '', call.path ?? '.') };
      case 'write':
        return { tool: 'write', ok: true, output: await toolWrite(ctx, call.path ?? '', call.content ?? '') };
      case 'edit':
        return { tool: 'edit', ok: true, output: await toolEdit(ctx, call.path ?? '', call.search ?? '', call.replace ?? '') };
      case 'run': {
        const out = await toolRun(ctx, call.command ?? '');
        return { tool: 'run', ok: !out.startsWith('RUN FAIL'), output: out };
      }
      case 'compile': {
        const cmd = (await detectNpmScript(ctx, ['compile', 'build', 'vscode:prepublish'])) ?? 'npm run compile';
        const out = await toolRun(ctx, cmd);
        return { tool: 'compile', ok: !out.startsWith('RUN FAIL'), output: out };
      }
      case 'test': {
        const cmd = (await detectNpmScript(ctx, ['test', 'test:full', 'lint'])) ?? 'npm test';
        const out = await toolRun(ctx, cmd);
        return { tool: 'test', ok: !out.startsWith('RUN FAIL'), output: out };
      }
      case 'done':
        return { tool: 'done', ok: true, output: call.summary ?? 'Tarea completada' };
      default:
        return { tool: call.tool, ok: false, output: 'ERROR: herramienta desconocida' };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: call.tool, ok: false, output: `ERROR: ${msg}` };
  }
}

export function formatToolResults(results: ToolResult[]): string {
  return results.map((r) => `═══ RESULTADO ${r.tool.toUpperCase()} ${r.ok ? 'OK' : 'FAIL'} ═══\n${r.output}`).join('\n\n');
}