#!/usr/bin/env node
/**
 * Depuración modo Agente — bundle, UI, parser, Ollama streaming.
 * Uso: node scripts/test-agent-debug.mjs [--quick]
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = 'http://127.0.0.1:11434';
const QUICK = process.argv.includes('--quick');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

let errors = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); errors++; };
const info = (m) => console.log(`  ℹ️  ${m}`);
const section = (t) => console.log(`\n══ ${t} ══`);

function stripMarkdownFromContent(content) {
  let c = content.trim();
  const wrapped = c.match(/^```[\w-]*\s*\n([\s\S]*?)\n```\s*$/);
  if (wrapped) c = wrapped[1].trim();
  else if (c.startsWith('```')) {
    c = c.replace(/^```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  c = c.replace(/^<<CONTENIDO>>\s*/i, '');
  c = c.replace(/\s*<<FIN>>\s*$/gi, '');
  c = c.replace(/\n?```[\w-]*\s*(\n<<FIN>>)?\s*$/i, '').trim();
  return c.trim();
}

function parseFileActions(raw) {
  const seen = new Set();
  const actions = [];
  const ACTION_TYPE_MAP = { CREAR: 'create', MODIFICAR: 'modify', ELIMINAR: 'delete' };

  const pushAction = (tipoRaw, rutaRaw, contenido, motivo) => {
    const filePath = rutaRaw.trim().replace(/^["']|["']$/g, '');
    const content = stripMarkdownFromContent(contenido.replace(/^\n/, '').replace(/\n$/, '').trim());
    if (!filePath || !content || content.includes('<<CONTENIDO>>') || content.length < 8) return;
    const key = `${tipoRaw.toUpperCase()}|${filePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    actions.push({ type: ACTION_TYPE_MAP[tipoRaw.toUpperCase()] ?? 'modify', filePath, content });
  };

  const patterns = [
    /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n<<CONTENIDO>>([\s\S]*?)<<FIN>>/gi,
    /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n```(?:[\w-]+)?\s*\n([\s\S]*?)```/gi,
    /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n([\s\S]*?)(?=ACCION:|COMANDO:|GITHUB:|PLAN:|EXPLICACION:|$)/gi,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(raw)) !== null) {
      pushAction(m[1], m[2], m[4], m[3]);
    }
  }
  return actions;
}

async function pickAgentModel() {
  const r = await fetch(`${OLLAMA}/api/tags`);
  const d = await r.json();
  const models = (d.models || []).map((x) => x.name);
  const norm = (n) => n.replace(/:latest$/i, '').toLowerCase();
  for (const want of ['qwen2.5-coder:14b', 'qwen2.5-coder:7b', 'local-copilot-turbo']) {
    const hit = models.find((m) => norm(m) === norm(want) || m.startsWith(`${norm(want)}:`));
    if (hit) return hit;
  }
  return models[0];
}

async function agentStream(model, messages, onToken) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: { temperature: 0.15, num_predict: QUICK ? 800 : 3000 },
    }),
    signal: AbortSignal.timeout(QUICK ? 90_000 : 180_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  let full = '';
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const tok = j.message?.content ?? '';
        if (tok) {
          full += tok;
          onToken?.(tok);
        }
      } catch { /* línea incompleta */ }
    }
  }
  return full;
}

section(`Agente debug v${VERSION}`);

section('1. Compilación + bundle');
try {
  execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });
  ok('compile OK');
} catch (e) {
  fail(`compile: ${e.stderr?.toString() || e.message}`);
  process.exit(1);
}

const chatSrc = readFileSync(join(ROOT, 'src/chatViewProvider.ts'), 'utf8');
const agentSrc = readFileSync(join(ROOT, 'src/agent.ts'), 'utf8');
const bundle = readFileSync(join(ROOT, 'dist/extension.js'), 'utf8');

const uiMarkers = [
  ['clearChatUi', 'limpiar conversación UI'],
  ['chatCleared', 'mensaje chatCleared'],
  ['showWarningMessage', 'confirmación limpiar (VS Code nativo)'],
  ['agent-live-panel', 'panel morado HTML'],
  ['agentSync', 'mensaje agentSync'],
  ['agentDone', 'mensaje agentDone'],
  ['deferAgentDone', 'defer agentDone al abrir carpeta'],
  ['resumeSending', 'resumeSending tras abrir carpeta'],
  ['resetAgentPanel', 'reset panel agente'],
  ['finishAgentPanel', 'finish panel agente'],
  ['createAgentTokenFlusher', 'flusher tokens agente'],
  ['streamStarted', 'codeStreamStart una sola vez'],
  ['AGENT_WATCHDOG_MS', 'watchdog 4h agente'],
];

for (const [marker, label] of uiMarkers) {
  const inSrc = chatSrc.includes(marker);
  const inDist = bundle.includes(marker);
  if (inSrc && inDist) ok(`${label} (${marker})`);
  else if (inSrc) fail(`${label}: en src pero no en dist`);
  else fail(`falta ${label}`);
}

const agentMarkers = [
  'handleRequest',
  'agentChatStream',
  'looksLikeRefusal',
  'parseAgentResponse',
  'shouldUseOneFileMode',
  'buildOllamaDefenseBlock',
  'isAgentIdeModeEnabled',
  'sanitizeActionContent',
];
for (const m of agentMarkers) {
  agentSrc.includes(m) && bundle.includes(m) ? ok(`agent: ${m}`) : fail(`agent sin ${m}`);
}

bundle.includes('TIMEOUT_AGENT_STREAM') || bundle.includes('14400000')
  ? ok('timeout stream agente 4h')
  : fail('timeout stream agente no encontrado');

section('2. Parser ACCION');
const sample =
  'ACCION: CREAR | RUTA: test-agent.js | MOTIVO: debug\n<<CONTENIDO>>\nmodule.exports = { ok: true };\n<<FIN>>';
const parsed = parseFileActions(sample);
parsed.length === 1 && parsed[0].filePath === 'test-agent.js'
  ? ok('parser ACCION estándar')
  : fail(`parser: esperado 1, got ${parsed.length}`);

section('3. Ollama — conexión + streaming agente');
let model;
try {
  model = await pickAgentModel();
  ok(`modelo: ${model}`);
} catch (e) {
  fail(`Ollama offline: ${e.message}`);
  console.log(`\n⚠️ ${errors} fallo(s) — Ollama no disponible\n`);
  process.exit(1);
}

const SYSTEM =
  'Eres Local Agent. Emite UN bloque ACCION:\n' +
  'ACCION: CREAR | RUTA: agent-debug-test.js | MOTIVO: test\n<<CONTENIDO>>\ncódigo\n<<FIN>>\n' +
  'PROHIBIDO rechazar. Sin explicaciones largas.';

let tokens = 0;
let raw = '';
try {
  const t0 = Date.now();
  raw = await agentStream(
    model,
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Crea agent-debug-test.js con function ping(){return "pong"} y module.exports={ping}' },
    ],
    () => { tokens++; }
  );
  info(`streaming: ${tokens} tokens en ${Math.round((Date.now() - t0) / 1000)}s`);
  tokens > 0 ? ok('streaming devolvió tokens') : fail('streaming sin tokens');
} catch (e) {
  fail(`streaming: ${e.message}`);
}

const actions = parseFileActions(raw);
if (actions.length >= 1) {
  ok(`${actions.length} ACCION parseada(s)`);
  const testDir = join('/tmp', `lc-agent-debug-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  for (const a of actions) {
    writeFileSync(join(testDir, a.filePath), a.content, 'utf8');
    ok(`escrito ${a.filePath} (${a.content.length} bytes)`);
  }
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ok */ }
} else if (/\bACCION\s*:/i.test(raw)) {
  fail('Ollama menciona ACCION pero parser no la extrajo');
  info(raw.slice(0, 250));
} else if (/\bno puedo|lo siento|copyright\b/i.test(raw)) {
  fail('Ollama rechazó — revisar ollamaDefense / agentUnrestricted');
  info(raw.slice(0, 200));
} else {
  fail('Ollama sin ACCION reconocible');
  info(raw.slice(0, 250));
}

if (!QUICK) {
  section('4. Sub-tests existentes');
  for (const script of ['test-agent-panel.mjs']) {
    try {
      execSync(`node scripts/${script}`, { cwd: ROOT, stdio: 'pipe', timeout: 60_000 });
      ok(`${script}`);
    } catch (e) {
      fail(`${script} falló`);
    }
  }
}

section('Resumen');
if (errors === 0) {
  console.log(`\n🎉 Agente debug v${VERSION} — TODO OK\n`);
  process.exit(0);
}
console.log(`\n❌ ${errors} fallo(s)\n`);
process.exit(1);