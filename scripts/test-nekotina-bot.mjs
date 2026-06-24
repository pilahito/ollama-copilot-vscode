#!/usr/bin/env node
/**
 * Test Agente — bot estilo Nekotina (APIs gratis). Generación por lotes si hace falta.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const OLLAMA = 'http://127.0.0.1:11434';
const TEST_DIR = join('/home/david', 'nekotina-bot-test');

const USER_PROMPT =
  'Hazme un bot de Discord impresionante, con APIs de GitHub y que tenga de todo, ' +
  'vamos una copia del Nekotina por ejemplo pero todo gratis. ' +
  'Música, trivia, economía, moderación, minijuegos, clima, memes, niveles, radio. ' +
  'Slash commands, discord.js v14, APIs gratuitas (Open Trivia, Open-Meteo, JokeAPI, PokéAPI).';

const FILE_BATCHES = [
  ['package.json', 'index.js', '.env.example', 'README.md'],
  ['commands/ping.js', 'commands/help.js', 'commands/trivia.js', 'commands/weather.js'],
  ['commands/balance.js', 'commands/daily.js', 'commands/joke.js', 'commands/pokemon.js'],
  ['commands/play.js', 'commands/radio.js', 'commands/ban.js', 'commands/kick.js'],
  ['events/ready.js', 'events/interactionCreate.js'],
  ['services/trivia.js', 'services/weather.js', 'services/jokes.js', 'services/pokemon.js'],
  ['admin/moderation.js', 'data/economy.js', 'musica/player.js', 'juegos/coinflip.js'],
];

const ACTION_TYPE_MAP = { CREAR: 'create', MODIFICAR: 'modify' };
let errors = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); errors++; };
const info = (m) => console.log(`  ℹ️  ${m}`);
const section = (t) => console.log(`\n══ ${t} ══`);

function stripMd(c) {
  const t = c.trim();
  const w = t.match(/^```[\w-]*\s*\n([\s\S]*?)\n```\s*$/);
  return w ? w[1].trim() : t.replace(/^```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

function parseFileActions(raw) {
  const seen = new Set();
  const actions = [];
  const push = (tipo, ruta, contenido, motivo) => {
    let filePath = ruta.trim().replace(/^["']|["']$/g, '');
    if (filePath.startsWith('/')) {
      const idx = filePath.indexOf('commands/');
      filePath = idx >= 0 ? filePath.slice(idx) : filePath.split('/').slice(-2).join('/');
    }
    const content = stripMd(contenido.replace(/^\n/, '').replace(/\n$/, '').trim());
    if (!filePath || !content || content.length < 10) return;
    if (seen.has(filePath)) return;
    seen.add(filePath);
    actions.push({ type: ACTION_TYPE_MAP[tipo.toUpperCase()] ?? 'create', filePath, content });
  };
  const patterns = [
    [/ACCION:\s*(CREAR|MODIFICAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n<<CONTENIDO>>([\s\S]*?)<<FIN>>/gi, (m) => push(m[1], m[2], m[4], m[3])],
    [/ACCION:\s*(CREAR|MODIFICAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n```(?:[\w-]+)?\s*\n([\s\S]*?)```/gi, (m) => push(m[1], m[2], m[4], m[3])],
    [/ACCION:\s*(CREAR|MODIFICAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n([\s\S]*?)(?=ACCION:|COMANDO:|$)/gi, (m) => push(m[1], m[2], m[4], m[3])],
  ];
  for (const [re, map] of patterns) {
    let m;
    while ((m = re.exec(raw)) !== null) map(m);
  }
  return actions;
}

function applyActions(actions, root, merged) {
  for (const a of actions) {
    merged.set(a.filePath, a.content);
    const full = join(root, a.filePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, a.content, 'utf8');
  }
}

function listTree(dir, prefix = '') {
  const lines = [];
  if (!existsSync(dir)) return lines;
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      lines.push(`${prefix}📁 ${name}/`);
      lines.push(...listTree(p, prefix + '  '));
    } else {
      lines.push(`${prefix}📄 ${name} (${readFileSync(p, 'utf8').length} B)`);
    }
  }
  return lines;
}

async function pickModel() {
  const r = await fetch(`${OLLAMA}/api/tags`);
  const models = (await r.json()).models?.map((m) => m.name) || [];
  const norm = (n) => n.replace(/:latest$/i, '').toLowerCase();
  for (const w of ['qwen2.5-coder:14b', 'qwen2.5-coder:7b']) {
    const h = models.find((m) => norm(m) === norm(w));
    if (h) return h;
  }
  return models[0];
}

async function chat(model, messages) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature: 0.1, num_predict: 8000 },
    }),
    signal: AbortSignal.timeout(240_000),
  });
  return (await r.json()).message?.content || '';
}

const STRICT_SYSTEM =
  'Eres Local Agent. SOLO respondes con bloques ACCION — sin listas numeradas sueltas.\n' +
  'FORMATO ÚNICO:\n' +
  'ACCION: CREAR | RUTA: archivo.js | MOTIVO: x\n<<CONTENIDO>>\ncódigo completo\n<<FIN>>\n' +
  'Bot Discord Nekotina-style: discord.js v14, slash commands, APIs gratis (opentdb, open-meteo, jokeapi, pokeapi).\n' +
  'PROHIBIDO: explicar sin ACCION, .gitkeep, TODO, "copia este código".';

section('Petición al Agente (estilo Nekotina, todo gratis)');
console.log(`  📝 ${USER_PROMPT}\n`);

if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

const model = await pickModel();
ok(`Modelo: ${model}`);

const merged = new Map();
let totalActions = 0;

// Intento monolítico primero
section('Fase 1 — petición completa');
const monoRaw = await chat(model, [
  { role: 'system', content: STRICT_SYSTEM + '\nEmite MÍNIMO 15 ACCION CREAR en una sola respuesta.' },
  {
    role: 'user',
    content:
      `${USER_PROMPT}\n\nArquitectura: commands/, events/, admin/, services/, data/, musica/, juegos/, index.js.\n` +
      'APIs gratis en services/. Economía en data/. Moderación en admin/.',
  },
]);
let monoActions = parseFileActions(monoRaw);
info(`Monolítico: ${monoActions.length} ACCION`);
if (monoActions.length >= 8) {
  applyActions(monoActions, TEST_DIR, merged);
  totalActions = monoActions.length;
}

// Fase 2 — por lotes (como hace el agente con reintentos)
if (totalActions < 8) {
  section('Fase 2 — generación por lotes (automático)');
  for (let bi = 0; bi < FILE_BATCHES.length; bi++) {
    const files = FILE_BATCHES[bi];
    const missing = files.filter((f) => !merged.has(f));
    if (!missing.length) continue;

    const batchPrompt =
      `Crea SOLO estos archivos del bot Nekotina (gratis, discord.js v14):\n${missing.map((f) => `- ${f}`).join('\n')}\n` +
      `Petición original: ${USER_PROMPT}\n` +
      'Un ACCION CREAR por archivo. Código REAL y ejecutable.';

    let batchActions = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages = [
        { role: 'system', content: STRICT_SYSTEM },
        { role: 'user', content: batchPrompt },
      ];
      if (attempt === 1) {
        messages.push({
          role: 'user',
          content: `CORRECCIÓN: emite exactamente ${missing.length} bloques ACCION CREAR:\n` +
            missing.map((f) => `ACCION: CREAR | RUTA: ${f} | MOTIVO: módulo\n<<CONTENIDO>>\n...\n<<FIN>>`).join('\n'),
        });
      }
      const raw = await chat(model, messages);
      batchActions = parseFileActions(raw);
      if (batchActions.length >= 1) break;
    }

    applyActions(batchActions, TEST_DIR, merged);
    totalActions += batchActions.length;
    info(`Lote ${bi + 1}: +${batchActions.length} archivos (total ${merged.size})`);
  }
}

section('Resultado');
if (merged.size < 6) {
  fail(`Solo ${merged.size} archivos generados`);
  process.exit(1);
}
ok(`${merged.size} archivos en ${TEST_DIR}`);

const allContent = [...merged.values()].join('\n');
const paths = [...merged.keys()].join('\n');
const checks = [
  [/commands\//.test(paths), 'commands/'],
  [/events\//.test(paths), 'events/'],
  [merged.has('index.js'), 'index.js'],
  [/discord\.js|Client|GatewayIntentBits/i.test(allContent), 'discord.js v14'],
  [/trivia|opentdb/i.test(allContent), 'trivia (OpenTDB)'],
  [/weather|meteo|open-meteo/i.test(allContent), 'clima (Open-Meteo)'],
  [/econom|balance|daily/i.test(allContent), 'economía'],
  [/ban|kick|moder/i.test(allContent), 'moderación'],
  [/joke|jokeapi/i.test(allContent), 'chistes (JokeAPI)'],
  [/pokemon|pokeapi/i.test(allContent), 'Pokémon (PokéAPI)'],
  [/play|musica|player/i.test(allContent), 'música'],
];
for (const [pass, label] of checks) {
  pass ? ok(label) : fail(`falta: ${label}`);
}

section('Árbol del proyecto');
for (const line of listTree(TEST_DIR)) console.log(`  ${line}`);

console.log(`\n📂 ${TEST_DIR}`);
console.log('   npm install discord.js dotenv better-sqlite3');
console.log('   # .env: DISCORD_TOKEN=… DISCORD_CLIENT_ID=…\n');

process.exit(errors > 2 ? 1 : 0);