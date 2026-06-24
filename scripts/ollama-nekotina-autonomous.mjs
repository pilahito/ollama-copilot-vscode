#!/usr/bin/env node
/**
 * Recrea Nekotina desde CERO solo con Ollama (flujo extensión v1.0.42).
 * Si falla → diagnostica → corrige → reintenta hasta que funcione.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = 'http://127.0.0.1:11434';
const BUILD_DIR = join('/home/david', 'nekotina-ollama-build');
const TOKEN_FILE = '/home/david/Escritorio/token Ayitax';
const MAX_FIX_ROUNDS = 40;

const REQUIREMENTS = `
═══ RECREAR NEKOTINA (bot Discord completo, TODO GRATIS) ═══

Necesitas crear un clon funcional inspirado en Nekotina con:

**Stack:** Node.js 18+, discord.js v14, dotenv. Sin mongoose ni express.

**Estructura modular obligatoria:**
- index.js — SOLO Client + cargar commands/ y events/
- deploy-commands.js — registra slash commands
- package.json, .env.example, README.md
- commands/ — ping, help, trivia, weather, joke, pokemon, economy, daily, moderation, games, levels, memes, music, radio
- events/ready.js, events/interactionCreate.js
- services/ — triviaService, weatherService, jokeService, pokemonService, economyService, levelsService (fetch APIs gratis)
- admin/moderation.js, musica/player.js, utils/db.js, data/ (JSON persistencia)

**APIs 100% gratuitas (usar fetch, no axios):**
- Trivia: https://opentdb.com/api.php?amount=1
- Clima: geocoding-api.open-meteo.com + api.open-meteo.com
- Chistes: https://v2.jokeapi.dev/joke/Any?safe-mode
- Pokémon: https://pokeapi.co/api/v2/pokemon/{name}
- Memes: https://meme-api.com/gimme

**Reglas:**
- SlashCommandBuilder de "discord.js" (NO @discordjs/builders)
- Cada opción de comando debe tener .setDescription()
- Código REAL ejecutable, sin TODO, sin .gitkeep
- DISCORD_TOKEN en .env.example (nunca hardcodear token)
`;

const FILE_BATCHES = [
  ['package.json', '.env.example', 'README.md', 'deploy-commands.js'],
  ['index.js', 'events/ready.js', 'events/interactionCreate.js', 'utils/db.js'],
  ['commands/ping.js', 'commands/help.js', 'commands/trivia.js', 'commands/weather.js'],
  ['commands/joke.js', 'commands/pokemon.js', 'commands/economy.js', 'commands/daily.js'],
  ['commands/moderation.js', 'commands/games.js', 'commands/levels.js', 'commands/memes.js'],
  ['commands/music.js', 'commands/radio.js'],
  ['services/triviaService.js', 'services/weatherService.js', 'services/jokeService.js', 'services/pokemonService.js'],
  ['services/economyService.js', 'services/levelsService.js', 'admin/moderation.js', 'musica/player.js'],
];

const STRICT =
  'Local Agent MODO LOTE. SOLO bloques ACCION: CREAR | RUTA: x | MOTIVO: y\n<<CONTENIDO>>\ncódigo\n<<FIN>>\n' +
  'discord.js v14. fetch nativo. Sin axios. Sin markdown fuera de ACCION.';

let log = (m) => console.log(m);

function stripMd(c) {
  let t = c.trim();
  const w = t.match(/^```[\w-]*\s*\n([\s\S]*?)\n```\s*$/);
  if (w) return w[1].trim();
  if (t.startsWith('```')) return t.replace(/^```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  return t;
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
    const c = stripMd(content);
    if (!p || c.length < 8 || seen.has(p)) return;
    seen.add(p);
    out.push({ path: p, content: c });
  };
  const reps = [
    [/ACCION:\s*CREAR\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*.+?\n<<CONTENIDO>>([\s\S]*?)<<FIN>>/gi, (m) => push(m[1], m[2])],
    [/ACCION:\s*CREAR\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*.+?\n```[\w-]*\s*\n([\s\S]*?)```/gi, (m) => push(m[1], m[2])],
  ];
  for (const [re, fn] of reps) {
    let m;
    while ((m = re.exec(raw)) !== null) fn(m);
  }
  return out;
}

function diagnose(raw, n) {
  if (n > 0) return `${n} ACCION OK`;
  if (/\bPLAN\s*:/i.test(raw) && !/\bACCION\s*:/i.test(raw)) return 'FALLO: solo PLAN → modo lote';
  return 'FALLO: sin ACCION parseables → reintento/corrección';
}

async function pickModel() {
  const d = await (await fetch(`${OLLAMA}/api/tags`)).json();
  return d.models?.find((m) => m.name.includes('qwen2.5-coder:14b'))?.name || d.models?.[0]?.name;
}

async function chat(model, messages) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.08, num_predict: 9000 } }),
    signal: AbortSignal.timeout(300_000),
  });
  return (await r.json()).message?.content || '';
}

function writeFile(rel, content) {
  const full = join(BUILD_DIR, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, stripMd(content), 'utf8');
}

function validateFile(rel) {
  const full = join(BUILD_DIR, rel);
  if (!existsSync(full)) return `no existe`;
  if (!rel.endsWith('.js')) return null;
  try {
    execSync(`node --check "${full}"`, { stdio: 'pipe' });
    return null;
  } catch (e) {
    return e.stderr?.toString() || e.message;
  }
}

async function fixFile(model, rel, errMsg) {
  log(`  🔧 Corrigiendo ${rel}: ${errMsg.slice(0, 80)}…`);
  const current = existsSync(join(BUILD_DIR, rel)) ? readFileSync(join(BUILD_DIR, rel), 'utf8') : '';
  const raw = await chat(model, [
    { role: 'system', content: STRICT },
    {
      role: 'user',
      content:
        `${REQUIREMENTS}\n\nCORRECCIÓN archivo ${rel}:\nError: ${errMsg}\n\n` +
        (current ? `Código actual:\n${current.slice(0, 3000)}\n\n` : '') +
        `Emite UN bloque ACCION: CREAR | RUTA: ${rel} con código corregido.`,
    },
  ]);
  const actions = parseActions(raw);
  if (actions.length) {
    writeFile(actions[0].path, actions[0].content);
    return validateFile(rel);
  }
  return 'Ollama no emitió ACCION en corrección';
}

async function generateBatch(model, files, merged) {
  const missing = files.filter((f) => !merged.has(f));
  if (!missing.length) return 0;

  const prompt =
    `${REQUIREMENTS}\n\nCrea SOLO estos archivos:\n${missing.map((f) => `- ${f}`).join('\n')}\n` +
    'Un ACCION CREAR por archivo.';

  let actions = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const messages = [
      { role: 'system', content: STRICT },
      { role: 'user', content: prompt },
    ];
    if (attempt > 0) {
      messages.push({
        role: 'user',
        content: `CORRECCIÓN: ${missing.length} ACCION CREAR con <<CONTENIDO>> para: ${missing.join(', ')}`,
      });
    }
    const raw = await chat(model, messages);
    actions = parseActions(raw);
    log(`    ${diagnose(raw, actions.length)} (intento ${attempt + 1})`);
    if (actions.length) break;
  }

  for (const a of actions) {
    writeFile(a.path, a.content);
    merged.set(a.path, true);
  }
  return actions.length;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  Ollama recrea Nekotina — autónomo (extensión v1.0.42) ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

if (existsSync(BUILD_DIR)) rmSync(BUILD_DIR, { recursive: true, force: true });
mkdirSync(BUILD_DIR, { recursive: true });

const model = await pickModel();
log(`🧠 Modelo agente: ${model}`);
log(`📂 Carpeta vacía: ${BUILD_DIR}\n`);

log('══ Fase 1: petición completa (como pestaña Agente) ══');
const mono = await chat(model, [
  { role: 'system', content: 'Agente Local Copilot. Emite ACCION CREAR con <<CONTENIDO>>. Mínimo 15 archivos.' },
  { role: 'user', content: REQUIREMENTS + '\n\nHazme un bot estilo Nekotina impresionante con todo lo anterior.' },
]);
const monoN = parseActions(mono);
log(`   ${diagnose(mono, monoN.length)}`);
const merged = new Map();
for (const a of monoN) {
  writeFile(a.path, a.content);
  merged.set(a.path, true);
}

log('\n══ Fase 2: modo lote automático (si faltan archivos) ══');
let batchNum = 0;
for (const batch of FILE_BATCHES) {
  batchNum++;
  log(`📦 Lote ${batchNum}/${FILE_BATCHES.length}…`);
  await generateBatch(model, batch, merged);
  log(`   Total archivos: ${merged.size}`);
}

log('\n══ Fase 3: validar y auto-corregir con Ollama ══');
const allJs = [...merged.keys()].filter((f) => f.endsWith('.js'));
let fixRound = 0;
let pending = allJs.map((f) => ({ f, err: validateFile(f) })).filter((x) => x.err);

while (pending.length && fixRound < MAX_FIX_ROUNDS) {
  fixRound++;
  const item = pending[0];
  const newErr = await fixFile(model, item.f, item.err);
  if (!newErr) {
    log(`  ✅ ${item.f} corregido`);
    pending.shift();
  } else {
    log(`  ⚠ ${item.f}: ${newErr.slice(0, 60)}`);
    item.err = newErr;
    pending.push(pending.shift());
  }
}

// Validar index y deploy
for (const critical of ['index.js', 'deploy-commands.js', 'package.json']) {
  if (!merged.has(critical)) {
    log(`🔧 Faltaba ${critical} — pidiendo a Ollama…`);
    await fixFile(model, critical, 'archivo obligatorio faltante');
    merged.set(critical, true);
  }
}

log('\n══ Fase 4: npm + Discord (token Ayitax) ══');
try {
  execSync('npm install', { cwd: BUILD_DIR, stdio: 'pipe' });
  log('✅ npm install');
} catch (e) {
  log('⚠ npm install: ' + (e.stderr?.toString() || e.message).slice(0, 100));
}

if (existsSync(TOKEN_FILE)) {
  const token = readFileSync(TOKEN_FILE, 'utf8').trim();
  const app = await fetch(`${OLLAMA.replace('11434', '11434')}`, { method: 'GET' }).catch(() => null);
  let clientId = '1515757314244870286';
  try {
    const me = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
      headers: { Authorization: `Bot ${token}` },
    }).then((r) => r.json());
    clientId = me.id || clientId;
  } catch { /* default Ayitax */ }
  writeFileSync(join(BUILD_DIR, '.env'), `DISCORD_TOKEN=${token}\nDISCORD_CLIENT_ID=${clientId}\n`, { mode: 0o600 });
  try {
    execSync('npm run deploy', { cwd: BUILD_DIR, stdio: 'pipe' });
    log(`✅ Comandos registrados en Discord (Ayitax)`);
  } catch (e) {
    log('⚠ deploy: ' + (e.stderr?.toString() || '').slice(0, 120));
  }
}

const finalErrors = [...merged.keys()].filter((f) => f.endsWith('.js') && validateFile(f));
log('\n══ RESULTADO ══');
log(`📁 ${BUILD_DIR}`);
log(`📄 ${merged.size} archivos generados por Ollama`);
log(finalErrors.length ? `❌ ${finalErrors.length} archivos con error de sintaxis` : '✅ Sintaxis JS OK');

if (!finalErrors.length) {
  log('\n🚀 Arrancando bot 10s…');
  const child = spawn('npm', ['start'], { cwd: BUILD_DIR, stdio: 'pipe' });
  let out = '';
  child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
  await new Promise((r) => setTimeout(r, 10000));
  child.kill();
  if (/online|Logged in|conectado/i.test(out)) log('\n🎉 Ayitax online — Ollama creó el bot');
}

log('\n💡 Abre en VS Code: Archivo → Abrir carpeta → ~/nekotina-ollama-build');
log('   Pestaña Agente para seguir ampliando.\n');
process.exit(finalErrors.length ? 1 : 0);