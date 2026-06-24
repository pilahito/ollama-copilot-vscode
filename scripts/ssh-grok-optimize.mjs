#!/usr/bin/env node
/**
 * Optimización autónoma estilo Grok — local o SSH (2–3 h por defecto).
 * Uso:
 *   node scripts/ssh-grok-optimize.mjs
 *   SSH_HOST=user@servidor MAX_HOURS=3 node scripts/ssh-grok-optimize.mjs
 */
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:14b';
const MAX_HOURS = Number(process.env.MAX_HOURS || '3');
const SSH_HOST = process.env.SSH_HOST || '';
const LOG = process.env.GROK_LOG || path.join(process.env.HOME || '/tmp', 'grok-system-optimize.log');

const DISCOVERY = `
set +e
hostname; cat /etc/os-release 2>/dev/null | head -12; uname -a
uptime; df -hT 2>/dev/null | head -20; free -h 2>/dev/null
systemctl --failed --no-pager 2>/dev/null | head -20
ss -tlnp 2>/dev/null | head -15
journalctl -p err -n 15 --no-pager 2>/dev/null | tail -15
nvidia-smi --query-gpu=name,driver_version,temperature.gpu --format=csv,noheader 2>/dev/null || true
`.trim();

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG, line);
  process.stdout.write(line);
}

async function runShell(script) {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  const cmd = SSH_HOST
    ? `${SSH_HOST.startsWith('ssh ') ? SSH_HOST : `ssh ${SSH_HOST}`} "echo ${b64} | base64 -d | bash"`
    : `echo ${b64} | base64 -d | bash`;
  const { stdout, stderr } = await execFileAsync('bash', ['-lc', cmd], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 180_000,
  });
  return [stdout, stderr].filter(Boolean).join('\n');
}

async function ollamaChat(system, user) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options: { temperature: 0.35, num_predict: 4096 },
    }),
  });
  const data = await res.json();
  return data.message?.content || '';
}

function parseCommands(text) {
  const out = [];
  const re = /COMANDO:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)(?:\n|<<FIN>>)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ command: m[1].trim(), reason: m[2].trim() });
  }
  return out;
}

const BLOCKED = /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=)/i;

const GROK_SYSTEM = `Eres Grok en modo sysadmin. Analiza el snapshot y emite COMANDO seguros para mejorar el sistema.
Prioriza seguridad, estabilidad, rendimiento. Responde en español.
Si todo está bien: "OPTIMIZACIÓN COMPLETA" en la explicación.
Formato: EXPLICACION: ... luego COMANDO: cmd | MOTIVO: razón`;

async function main() {
  const deadline = Date.now() + MAX_HOURS * 3_600_000;
  let round = 0;
  let prior = '';

  log(`Inicio Grok optimize — modelo=${MODEL} ssh=${SSH_HOST || 'local'} max=${MAX_HOURS}h`);

  while (Date.now() < deadline) {
    round++;
    log(`=== Ronda ${round} ===`);
    const snapshot = await runShell(DISCOVERY);
    const user = `[Ronda ${round}]\n${snapshot}\n\n${prior}\nMejora lo que encuentres.`;
    const response = await ollamaChat(GROK_SYSTEM, user);
    log(`Respuesta (${response.length} chars)`);
    fs.appendFileSync(LOG, `\n--- Ronda ${round} respuesta ---\n${response}\n`);

    if (/OPTIMIZACIÓN COMPLETA|OPTIMIZACION COMPLETA/i.test(response)) {
      log('Optimización completa.');
      break;
    }

    const commands = parseCommands(response).filter((c) => !BLOCKED.test(c.command));
    if (!commands.length) {
      log('Sin comandos — fin.');
      break;
    }

    for (const { command, reason } of commands) {
      log(`CMD: ${command} (${reason})`);
      try {
        const out = await runShell(command);
        log(out.slice(0, 800));
      } catch (e) {
        log(`Error: ${e.message}`);
      }
    }

    prior += `\nR${round}: ${response.slice(0, 500)}`;
    await new Promise((r) => setTimeout(r, 20_000));
  }

  log(`Fin — ${round} rondas. Log: ${LOG}`);
}

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});