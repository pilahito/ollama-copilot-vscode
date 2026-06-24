#!/usr/bin/env node
/**
 * Ollama Build — agente autónomo en terminal (como Grok Build / Cursor).
 *
 * Uso:
 *   node scripts/ollama-build.mjs "Crea un bot Discord con radio y música"
 *   TASK="arregla los tests" MAX_ROUNDS=15 node scripts/ollama-build.mjs
 *   PROJECT=~/mi-proyecto node scripts/ollama-build.mjs
 */
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const ROOT = process.env.PROJECT || process.cwd();
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:14b';
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS || '20');
const LOG = process.env.BUILD_LOG || '/tmp/ollama-build.log';
const TASK = process.argv.slice(2).join(' ') || process.env.TASK || '';

const BLOCKED = /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=)/i;
const ALLOWED = ['git ', 'npm ', 'npx ', 'node ', 'yarn ', 'python ', 'python3 ', 'mkdir ', 'cp ', 'mv ', 'touch ', 'chmod ', 'cat ', 'grep ', 'rg ', 'find ', 'ls ', 'curl ', 'bash ', 'ollama ', 'code ', 'make ', 'cargo ', 'go '];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
}

function safePath(rel) {
  let c = rel.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!c || c.includes('..')) return null;
  const rootR = path.resolve(ROOT);
  if (path.isAbsolute(c) && c.startsWith(rootR)) return c;
  if (path.isAbsolute(c)) c = path.basename(c);
  const full = path.resolve(ROOT, c);
  if (!full.startsWith(rootR)) return null;
  return full;
}

function isAllowed(cmd) {
  const n = cmd.trim().toLowerCase();
  if (BLOCKED.test(n)) return false;
  return ALLOWED.some((p) => n.startsWith(p));
}

function parseTools(raw) {
  const calls = [];
  const doneM = /TOOL:\s*DONE\s*\|\s*RESUMEN:\s*(.+)/i.exec(raw);
  if (doneM) calls.push({ tool: 'done', summary: doneM[1].trim() });

  let m;
  const readRe = /TOOL:\s*READ\s*\|\s*PATH:\s*(.+?)(?:\n|$)/gi;
  while ((m = readRe.exec(raw)) !== null) calls.push({ tool: 'read', path: m[1].trim() });

  const listRe = /TOOL:\s*LIST\s*\|\s*PATH:\s*(.+?)(?:\n|$)/gi;
  while ((m = listRe.exec(raw)) !== null) calls.push({ tool: 'list', path: m[1].trim() });

  const runRe = /TOOL:\s*RUN\s*\|\s*CMD:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)(?:\n|<<FIN>>)/gi;
  while ((m = runRe.exec(raw)) !== null) calls.push({ tool: 'run', command: m[1].trim() });

  const writeRe = /TOOL:\s*WRITE\s*\|\s*PATH:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n<<CONTENIDO>>\n([\s\S]*?)<<FIN>>/gi;
  while ((m = writeRe.exec(raw)) !== null) calls.push({ tool: 'write', path: m[1].trim(), content: m[3] });

  const writeAltRe = /TOOL:\s*WRITE\s*\|\s*PATH:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n+(?:c[oó]digo\n)?(?:```[\w]*\n)?([\s\S]*?)(?:<<FIN>>|```\s*\n|(?=TOOL:)|$)/gi;
  while ((m = writeAltRe.exec(raw)) !== null) {
    const content = m[3].replace(/^c[oó]digo\n/i, '').replace(/```\s*$/, '').trim();
    if (!content || calls.some((c) => c.tool === 'write' && c.path === m[1].trim())) continue;
    calls.push({ tool: 'write', path: m[1].trim(), content });
  }

  const compileRe = /TOOL:\s*COMPILE/gi;
  if (compileRe.test(raw)) calls.push({ tool: 'compile' });

  return calls;
}

async function execTool(call) {
  switch (call.tool) {
    case 'read': {
      const full = safePath(call.path);
      if (!full || !fs.existsSync(full)) return `ERROR: no existe ${call.path}`;
      const lines = fs.readFileSync(full, 'utf8').split('\n').slice(0, 300);
      return `READ ${call.path}:\n${lines.map((l, i) => `${i + 1}| ${l}`).join('\n')}`;
    }
    case 'list': {
      const full = safePath(call.path || '.');
      if (!full) return 'ERROR: ruta inválida';
      const entries = fs.readdirSync(full).filter((e) => !e.startsWith('.') && e !== 'node_modules').slice(0, 60);
      return `LIST ${call.path || '.'}:\n${entries.join('\n')}`;
    }
    case 'write': {
      const full = safePath(call.path);
      if (!full) return 'ERROR: ruta inválida';
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, call.content, 'utf8');
      return `WRITE OK: ${call.path}`;
    }
    case 'run':
    case 'compile': {
      const cmd = call.tool === 'compile' ? 'npm run compile 2>&1 || npm run build 2>&1' : call.command;
      if (!isAllowed(cmd)) return `BLOCKED: ${cmd}`;
      try {
        const { stdout, stderr } = await execFileAsync('bash', ['-lc', cmd], { cwd: ROOT, maxBuffer: 6e6, timeout: 180000 });
        return [stdout, stderr].filter(Boolean).join('\n').slice(0, 5000) || 'OK (sin salida)';
      } catch (e) {
        return `FAIL: ${e.message}\n${(e.stdout || '') + (e.stderr || '')}`.slice(0, 4000);
      }
    }
    case 'done':
      return call.summary || 'DONE';
    default:
      return 'ERROR: tool desconocida';
  }
}

async function ollamaChat(messages) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: false, messages, options: { temperature: 0.3, num_predict: 8192 } }),
  });
  const data = await res.json();
  return data.message?.content || '';
}

const SYSTEM = `Eres Ollama Build — agente autónomo en terminal como Cursor.
TIENES permiso total: los TOOL se ejecutan REALMENTE en el PC del usuario.
PROHIBIDO: decir "no puedo", dar instrucciones al usuario, placeholders.
USA HERRAMIENTAS (obligatorio):
TOOL: LIST | PATH: .
TOOL: WRITE | PATH: hello.js | MOTIVO: crear
<<CONTENIDO>>
console.log('hola');
<<FIN>>
TOOL: RUN | CMD: node hello.js | MOTIVO: probar
TOOL: DONE | RESUMEN: ...
Primero WRITE, luego RUN. Código REAL. Español.`;

async function main() {
  if (!TASK) {
    console.error('Uso: node scripts/ollama-build.mjs "tu tarea"');
    process.exit(1);
  }
  log(`Ollama Build — modelo=${MODEL} proyecto=${ROOT}`);
  log(`Tarea: ${TASK.slice(0, 120)}`);

  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `TAREA: ${TASK}\nPROYECTO: ${ROOT}\nEmpieza con LIST y READ.` },
  ];

  let writesOk = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    log(`── Ronda ${round}/${MAX_ROUNDS} ──`);
    const response = await ollamaChat(messages);
    log(`Respuesta: ${response.length} chars`);
    fs.appendFileSync(LOG, `\n--- Ronda ${round} ---\n${response}\n`);

    const calls = parseTools(response);
    const done = calls.find((c) => c.tool === 'done');
    const work = calls.filter((c) => c.tool !== 'done');

    if (work.length === 0) {
      messages.push({ role: 'assistant', content: response });
      messages.push({ role: 'user', content: 'Emite TOOL: ahora. No solo texto.' });
      continue;
    }

    const results = [];
    for (const call of work.slice(0, 6)) {
      log(`  → ${call.tool} ${call.path || call.command || ''}`);
      const out = await execTool(call);
      results.push(`[${call.tool}] ${out}`);
      if (call.tool === 'write' && out.startsWith('WRITE OK')) writesOk++;
      log(`    ${out.split('\n')[0].slice(0, 100)}`);
    }

    messages.push({ role: 'assistant', content: response });
    messages.push({ role: 'user', content: results.join('\n\n') + '\n\nContinúa o TOOL: DONE.' });

    if (done) {
      const needsWrite = /\b(crea|crear|implementa|write)\b/i.test(TASK);
      if (needsWrite && writesOk === 0) {
        log('⚠ DONE rechazado — sin WRITE. Pidiendo archivo…');
        messages.push({
          role: 'user',
          content: 'RECHAZADO: DONE sin WRITE. Emite TOOL: WRITE con <<CONTENIDO>> ahora.',
        });
        continue;
      }
      log(`✅ COMPLETADO: ${done.summary || 'ok'}`);
      process.exit(0);
    }
  }

  log('⚠ Máximo de rondas alcanzado');
  process.exit(1);
}

main().catch((e) => {
  log(`ERROR: ${e.message}`);
  process.exit(1);
});