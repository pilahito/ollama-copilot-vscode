#!/usr/bin/env node
/**
 * Simula el flujo de la EXTENSIÓN (v1.0.42) con modo lote:
 * 1) Ollama responde solo PLAN → diagnóstico
 * 2) Modo lote automático hasta N archivos
 * 3) Escribe en ~/nekotina-bot-test
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = 'http://127.0.0.1:11434';
const TEST_DIR = join('/home/david', 'nekotina-bot-test');

const USER_PROMPT =
  'Hazme un bot de Discord impresionante, con APIs de GitHub y que tenga de todo, ' +
  'vamos una copia del Nekotina por ejemplo pero todo gratis. ' +
  'Música, trivia, economía, moderación, minijuegos, clima, memes, niveles, radio.';

const FILE_BATCHES = [
  ['package.json', 'index.js', '.env.example', 'deploy-commands.js'],
  ['events/ready.js', 'events/interactionCreate.js', 'commands/ping.js', 'commands/help.js'],
  ['commands/trivia.js', 'commands/weather.js', 'commands/joke.js', 'commands/pokemon.js'],
  ['commands/economy.js', 'commands/daily.js', 'commands/music.js', 'commands/radio.js'],
  ['commands/moderation.js', 'commands/games.js', 'commands/levels.js', 'commands/memes.js'],
  ['services/triviaService.js', 'services/weatherService.js', 'services/jokeService.js', 'services/pokemonService.js'],
  ['services/economyService.js', 'services/levelsService.js', 'admin/moderation.js', 'musica/player.js'],
  ['utils/db.js', 'README.md'],
];

const STRICT_SYSTEM =
  'Eres Local Agent MODO LOTE (extensión Local Copilot). SOLO bloques ACCION.\n' +
  'ACCION: CREAR | RUTA: path | MOTIVO: x\n<<CONTENIDO>>\ncódigo\n<<FIN>>\n' +
  'discord.js v14, APIs gratis. Código REAL.';

let errors = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); errors++; };
const info = (m) => console.log(`  ℹ️  ${m}`);
const section = (t) => console.log(`\n══ ${t} ══`);

function diagnose(raw, n) {
  if (n > 0) return `${n} ACCION parseadas`;
  if (/\bPLAN\s*:/i.test(raw) && !/\bACCION\s*:/i.test(raw)) {
    return 'DIAGNÓSTICO: solo PLAN sin ACCION → modo lote (como extensión v1.0.42)';
  }
  return 'DIAGNÓSTICO: sin ACCION parseables → modo lote';
}

function parseActions(raw) {
  const seen = new Set();
  const out = [];
  const push = (path, content) => {
    let p = path.trim().replace(/^["']|["']$/g, '');
    if (p.startsWith('/')) {
      const i = p.indexOf('commands/');
      p = i >= 0 ? p.slice(i) : p.split('/').slice(-2).join('/');
    }
    const c = content.replace(/^\n/, '').replace(/\n$/, '').trim();
    if (!p || c.length < 10 || seen.has(p)) return;
    seen.add(p);
    out.push({ path: p, content: c });
  };
  const patterns = [
    [/ACCION:\s*CREAR\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*.+?\n<<CONTENIDO>>([\s\S]*?)<<FIN>>/gi, (m) => push(m[1], m[2])],
    [/ACCION:\s*CREAR\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*.+?\n```(?:[\w-]+)?\s*\n([\s\S]*?)```/gi, (m) => push(m[1], m[2])],
  ];
  for (const [re, fn] of patterns) {
    let m;
    while ((m = re.exec(raw)) !== null) fn(m);
  }
  return out;
}

async function chat(model, messages) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.1, num_predict: 8000 } }),
    signal: AbortSignal.timeout(240_000),
  });
  return (await r.json()).message?.content || '';
}

section('Compilación extensión v1.0.42');
try {
  execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });
  ok('esbuild OK');
  const bundle = readFileSync(join(ROOT, 'dist/extension.js'), 'utf8');
  bundle.includes('generateSolutionByBatches') ? ok('modo lote en bundle') : fail('sin generateSolutionByBatches');
  bundle.includes('diagnoseAgentFailure') ? ok('diagnóstico en bundle') : fail('sin diagnoseAgentFailure');
} catch (e) {
  fail(e.message);
  process.exit(1);
}

section('Petición usuario (como pestaña Agente VS Code)');
console.log(`  📝 ${USER_PROMPT}\n`);

if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

const tags = await (await fetch(`${OLLAMA}/api/tags`)).json();
const model = tags.models?.find((m) => m.name.includes('qwen2.5-coder:14b'))?.name ||
  tags.models?.[0]?.name;
ok(`Ollama: ${model}`);

section('Fase 1 — respuesta monolítica (fallo típico)');
const mono = await chat(model, [
  { role: 'system', content: 'Eres agente. PLAN + EXPLICACION + ACCION.' },
  { role: 'user', content: USER_PROMPT },
]);
const monoN = parseActions(mono).length;
info(diagnose(mono, monoN));

const merged = new Map();
section('Fase 2 — modo lote automático (extensión)');
let round = 0;
for (const batch of FILE_BATCHES) {
  const missing = batch.filter((f) => !merged.has(f));
  if (!missing.length) continue;
  round++;
  const prompt =
    `Bot Nekotina gratis. Crea SOLO:\n${missing.map((f) => `- ${f}`).join('\n')}\n` +
    `Petición: ${USER_PROMPT}\nUn ACCION CREAR por archivo.`;

  let actions = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = [
      { role: 'system', content: STRICT_SYSTEM },
      { role: 'user', content: prompt },
    ];
    if (attempt === 1) {
      messages.push({
        role: 'user',
        content: `CORRECCIÓN: ${missing.length} ACCION CREAR con <<CONTENIDO>> para ${missing.join(', ')}`,
      });
    }
    const raw = await chat(model, messages);
    actions = parseActions(raw);
    if (actions.length) break;
    info(`  Lote ${round} intento ${attempt + 1}: ${diagnose(raw, 0)}`);
  }

  for (const a of actions) {
    const full = join(TEST_DIR, a.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, a.content);
    merged.set(a.path, a.content);
  }
  info(`Lote ${round}: +${actions.length} → total ${merged.size} archivos`);
}

section('Resultado en disco');
merged.size >= 12 ? ok(`${merged.size} archivos (mínimo 12)`) : fail(`solo ${merged.size} archivos`);
[...merged.keys()].some((k) => k.startsWith('commands/')) ? ok('commands/') : fail('sin commands/');
[...merged.keys()].some((k) => k.startsWith('services/')) ? ok('services/') : fail('sin services/');
merged.has('index.js') ? ok('index.js') : fail('sin index.js');

const all = [...merged.values()].join('\n');
[/discord\.js/i.test(all), 'discord.js'];
[/opentdb|trivia/i.test(all), 'trivia'];
[/meteo|weather/i.test(all), 'clima'];
[/econom|balance/i.test(all), 'economía'];
[/ban|kick|moder/i.test(all), 'moderación'];
for (const [pass, label] of [
  [/discord\.js/i.test(all), 'discord.js'],
  [/opentdb|trivia/i.test(all), 'trivia API'],
  [/meteo|weather/i.test(all), 'clima'],
  [/econom|balance/i.test(all), 'economía'],
  [/ban|kick|moder/i.test(all), 'moderación'],
]) {
  pass ? ok(label) : fail(`falta ${label}`);
}

console.log(`\n📂 Proyecto: ${TEST_DIR}`);
console.log('   Abre esta carpeta en VS Code → pestaña Agente para seguir ampliando.\n');

process.exit(errors ? 1 : 0);