#!/usr/bin/env node
/**
 * Test E2E Agente v1.0.41 — parser real + Ollama + escritura en disco.
 * Uso: node scripts/test-agent-v1041.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = 'http://127.0.0.1:11434';
const TEST_DIR = join('/tmp', `lc-agent-v1041-${Date.now()}`);

const ACTION_TYPE_MAP = { CREAR: 'create', MODIFICAR: 'modify', ELIMINAR: 'delete' };

let errors = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); errors++; };
const info = (m) => console.log(`  ℹ️  ${m}`);
const section = (t) => console.log(`\n══ ${t} ══`);

function stripMarkdownFromContent(content) {
  let c = content.trim();
  const wrapped = c.match(/^```[\w-]*\s*\n([\s\S]*?)\n```\s*$/);
  if (wrapped) return wrapped[1].trim();
  if (c.startsWith('```')) {
    return c.replace(/^```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  return c;
}

/** Parser v1.0.41 — igual que agent.ts parseFileActions */
function parseFileActions(raw) {
  const seen = new Set();
  const actions = [];

  const pushAction = (tipoRaw, rutaRaw, contenido, motivo) => {
    const filePath = rutaRaw.trim().replace(/^["']|["']$/g, '');
    const content = stripMarkdownFromContent(contenido.replace(/^\n/, '').replace(/\n$/, '').trim());
    if (!filePath || !content || content.includes('<<CONTENIDO>>') || content.length < 8) return;
    const key = `${tipoRaw.toUpperCase()}|${filePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    actions.push({
      type: ACTION_TYPE_MAP[tipoRaw.toUpperCase()] ?? 'modify',
      filePath,
      content,
      reason: motivo.trim() || 'test',
    });
  };

  const patterns = [
    {
      re: /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n<<CONTENIDO>>([\s\S]*?)<<FIN>>/gi,
      map: (m) => pushAction(m[1], m[2], m[4], m[3]),
    },
    {
      re: /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n```(?:[\w-]+)?\s*\n([\s\S]*?)```/gi,
      map: (m) => pushAction(m[1], m[2], m[4], m[3]),
    },
    {
      re: /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n([\s\S]*?)(?=ACCION:|COMANDO:|GITHUB:|PLAN:|EXPLICACION:|$)/gi,
      map: (m) => pushAction(m[1], m[2], m[4], m[3]),
    },
  ];

  for (const { re, map } of patterns) {
    let match;
    while ((match = re.exec(raw)) !== null) map(match);
  }
  return actions;
}

function applyActions(actions, root) {
  for (const a of actions) {
    const full = join(root, a.filePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, a.content, 'utf8');
  }
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

async function agentChat(model, messages) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature: 0.15, num_predict: 6000 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const d = await r.json();
  return d.message?.content || '';
}

const AGENT_SYSTEM =
  'Eres Local Agent en MODO AGENTE. PROGRAMAS emitiendo bloques ACCION.\n' +
  'FORMATO: ACCION: CREAR | RUTA: ruta/archivo | MOTIVO: ...\n<<CONTENIDO>>\ncódigo\n<<FIN>>\n' +
  'La extensión escribe en disco automáticamente. PROHIBIDO decir "copia este código".\n' +
  'Organiza por carpetas (public/, commands/, events/). Código REAL y completo.';

// ── 1. Parser unit tests ─────────────────────────────────────────────────────
section('Parser v1.0.41 — formatos ACCION');

const samples = [
  {
    name: '<<CONTENIDO>> estándar',
    raw: 'ACCION: CREAR | RUTA: index.js | MOTIVO: test\n<<CONTENIDO>>\nconsole.log("ok");\n<<FIN>>',
    expect: 1,
  },
  {
    name: 'bloque ```javascript',
    raw: 'ACCION: CREAR | RUTA: bot.js | MOTIVO: bot\n```javascript\nconst x = 1;\nmodule.exports = x;\n```',
    expect: 1,
  },
  {
    name: 'múltiples ACCION',
    raw:
      'ACCION: CREAR | RUTA: a.js | MOTIVO: a\n<<CONTENIDO>>\nconst a=1;\n<<FIN>>\n' +
      'ACCION: CREAR | RUTA: b.js | MOTIVO: b\n<<CONTENIDO>>\nconst b=2;\n<<FIN>>',
    expect: 2,
  },
];

for (const s of samples) {
  const parsed = parseFileActions(s.raw);
  if (parsed.length === s.expect) ok(`Parser: ${s.name} → ${parsed.length} acción(es)`);
  else fail(`Parser: ${s.name} esperado ${s.expect}, got ${parsed.length}`);
}

// ── 2. Ollama conexión ───────────────────────────────────────────────────────
section('Ollama — conexión y modelo agente');
let model;
try {
  model = await pickAgentModel();
  ok(`Modelo: ${model}`);
} catch (e) {
  fail(`Ollama no disponible: ${e.message}`);
  process.exit(1);
}

// ── 3. Test web animalista (petición vaga — como usuario real) ───────────────
section('Agente E2E — web animalista (petición vaga, sin cuestionario)');
mkdirSync(TEST_DIR, { recursive: true });
writeFileSync(join(TEST_DIR, 'package.json'), '{"name":"agent-test-web"}\n');

const webPrompt =
  'Crea una página web animalista con animaciones CSS: public/index.html, public/css/styles.css y public/js/main.js. ' +
  'Diseño dinámico con colores verdes/naturaleza. Emite 3 bloques ACCION CREAR con código COMPLETO.';

let webActions = [];
let webRaw = '';
for (let attempt = 0; attempt < 4; attempt++) {
  const messages = [
    { role: 'system', content: AGENT_SYSTEM },
    { role: 'user', content: webPrompt },
  ];
  if (attempt === 1) {
    messages.push({
      role: 'user',
      content:
        'CORRECCIÓN ACCION: emite ACCION: CREAR para public/index.html, public/css/styles.css y public/js/main.js ' +
        'con <<CONTENIDO>> completo. Sin explicaciones largas.',
    });
  } else if (attempt === 2) {
    messages.push({
      role: 'user',
      content:
        'CORRECCIÓN: no escribiste archivos. Emite bloques ACCION con <<CONTENIDO>> o ```html/css/javascript```. ' +
        'Mínimo 3 archivos. La extensión escribe en disco automáticamente.',
    });
  } else if (attempt === 3) {
    messages.push({
      role: 'user',
      content:
        'ÚLTIMO INTENTO. Formato obligatorio:\n' +
        'ACCION: CREAR | RUTA: public/index.html | MOTIVO: html\n<<CONTENIDO>>\n<!DOCTYPE html>…\n<<FIN>>\n' +
        'ACCION: CREAR | RUTA: public/css/styles.css | MOTIVO: css\n<<CONTENIDO>>\nbody{…}\n<<FIN>>\n' +
        'ACCION: CREAR | RUTA: public/js/main.js | MOTIVO: js\n<<CONTENIDO>>\nconsole.log("ok");\n<<FIN>>',
    });
  }

  const t0 = Date.now();
  webRaw = await agentChat(model, messages);
  webActions = parseFileActions(webRaw);
  info(`Intento ${attempt + 1}: ${webActions.length} ACCION (${Math.round((Date.now() - t0) / 1000)}s)`);

  if (webActions.length >= 2) break;
}

if (webActions.length >= 2) {
  applyActions(webActions, TEST_DIR);
  ok(`${webActions.length} archivo(s) escritos en ${TEST_DIR}`);
  for (const a of webActions) {
    const full = join(TEST_DIR, a.filePath);
    if (existsSync(full)) {
      const bytes = readFileSync(full, 'utf8').length;
      ok(`${a.filePath} (${bytes} bytes)`);
    } else {
      fail(`No existe en disco: ${a.filePath}`);
    }
  }
  const html = join(TEST_DIR, 'public/index.html');
  if (existsSync(html)) {
    const content = readFileSync(html, 'utf8');
    if (content.includes('<!DOCTYPE') || content.includes('<html')) ok('HTML válido en public/index.html');
    else fail('public/index.html sin estructura HTML');
  } else {
    fail('Falta public/index.html');
  }
  const hasCss = webActions.some((a) => a.filePath.includes('.css')) ||
    existsSync(join(TEST_DIR, 'public/css/styles.css'));
  hasCss ? ok('Incluye CSS') : fail('Sin archivo CSS');
} else {
  fail(`Web: solo ${webActions.length} ACCION tras 4 intentos`);
  info(`Respuesta: ${webRaw.slice(0, 200)}…`);
}

// ── 4. Test modificar archivo existente ──────────────────────────────────────
section('Agente E2E — modificar index.js existente');
const botDir = join(TEST_DIR, 'discord-bot');
mkdirSync(botDir, { recursive: true });
writeFileSync(
  join(botDir, 'index.js'),
  "const { Client } = require('discord.js');\nconst client = new Client({ intents: [] });\nclient.login('TOKEN');\n"
);
writeFileSync(join(botDir, 'package.json'), '{"name":"discord-bot","dependencies":{"discord.js":"^14.0.0"}}\n');

const modPrompt =
  'Modifica index.js: añade un comando /ping que responda "Pong!". ' +
  'Crea commands/ping.js con la lógica y modifica index.js para registrarlo. ' +
  'Emite ACCION CREAR y ACCION MODIFICAR con <<CONTENIDO>> completo.';

let modActions = [];
let modRaw = '';
for (let attempt = 0; attempt < 3; attempt++) {
  const messages = [
    { role: 'system', content: AGENT_SYSTEM },
    { role: 'user', content: `Proyecto en ${botDir}\n\nindex.js actual:\n\`\`\`\n${readFileSync(join(botDir, 'index.js'), 'utf8')}\n\`\`\`\n\n${modPrompt}` },
  ];
  if (attempt > 0) {
    messages.push({
      role: 'user',
      content: 'CORRECCIÓN: emite ACCION: CREAR | RUTA: commands/ping.js y ACCION: MODIFICAR | RUTA: index.js con código completo.',
    });
  }
  modRaw = await agentChat(model, messages);
  modActions = parseFileActions(modRaw);
  info(`Modificar intento ${attempt + 1}: ${modActions.length} ACCION`);
  if (modActions.length >= 1) break;
}

if (modActions.length >= 1) {
  applyActions(modActions, botDir);
  ok(`${modActions.length} cambio(s) aplicados`);
  for (const a of modActions) {
    const full = join(botDir, a.filePath);
    existsSync(full) ? ok(`Escrito: ${a.filePath}`) : fail(`Falta: ${a.filePath}`);
  }
  const ping = join(botDir, 'commands/ping.js');
  if (existsSync(ping)) {
    const c = readFileSync(ping, 'utf8');
    /ping|pong/i.test(c) ? ok('commands/ping.js con lógica ping') : fail('ping.js sin lógica');
  }
} else {
  fail('Modificar: sin ACCION');
}

// ── 5. Resumen ───────────────────────────────────────────────────────────────
section('Resumen');
try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }

if (errors === 0) {
  console.log('\n🎉 Agente v1.0.41 — TODOS LOS TESTS OK\n');
  process.exit(0);
} else {
  console.log(`\n❌ ${errors} fallo(s)\n`);
  process.exit(1);
}