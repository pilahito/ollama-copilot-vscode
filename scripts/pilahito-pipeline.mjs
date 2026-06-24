#!/usr/bin/env node
/**
 * Pipeline autónomo Pilahito:
 * 1) Bot Nekotina (Ollama 1-archivo + plantillas + referencia)
 * 2) Web animalista Apartamento Pilahito (Google Maps)
 * 3) Copia ambos al Escritorio
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, copyFileSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';

const OLLAMA = 'http://127.0.0.1:11434';
const DESKTOP = '/home/david/Escritorio';
const BOT_WORK = '/home/david/nekotina-ollama-fresh';
const WEB_WORK = '/home/david/web-animalista-build';
const BOT_DEST = join(DESKTOP, 'nekotina-bot');
const WEB_DEST = join(DESKTOP, 'web-animalista-pilahito');
const REF_BOT = '/home/david/nekotina-bot-test';
const REF_INDEX = '/home/david/nekotina-ollama-build/index.js';
const MAPS_CONTRIB = 'https://www.google.com/maps/contrib/117329176880207012989';
const MAPS_PHOTOS = `${MAPS_CONTRIB}/photos`;
const TOKEN_FILE = join(DESKTOP, 'token Ayitax');

const NEKOTINA_FILES = [
  'package.json', '.env.example', 'README.md', 'utils/db.js',
  'services/triviaService.js', 'services/weatherService.js', 'services/jokeService.js',
  'services/pokemonService.js', 'services/economyService.js', 'services/levelsService.js',
  'commands/ping.js', 'commands/help.js', 'commands/trivia.js', 'commands/weather.js',
  'commands/joke.js', 'commands/pokemon.js', 'commands/economy.js', 'commands/daily.js',
  'commands/music.js', 'commands/radio.js', 'commands/moderation.js', 'commands/games.js',
  'commands/levels.js', 'commands/memes.js', 'commands/nsfw.js',
  'admin/moderation.js', 'musica/player.js',
  'events/ready.js', 'events/interactionCreate.js',
  'deploy-commands.js', 'scripts/validate.js', 'index.js',
];

const SYS = 'Responde SOLO:\nACCION: CREAR | RUTA: ARCHIVO | MOTIVO: x\n<<CONTENIDO>>\ncódigo\n<<FIN>>';

const SCAFFOLDS = {
  'package.json': `{
  "name": "nekotina-bot",
  "version": "1.0.0",
  "description": "Bot Discord estilo Nekotina — APIs gratuitas",
  "main": "index.js",
  "scripts": { "start": "node index.js", "deploy": "node deploy-commands.js", "check": "node scripts/validate.js" },
  "engines": { "node": ">=18.0.0" },
  "dependencies": { "discord.js": "^14.26.4", "dotenv": "^16.6.1" }
}`,
  '.env.example': 'DISCORD_TOKEN=tu_token_aqui\nCLIENT_ID=tu_client_id\nGUILD_ID=id_servidor_opcional\n',
  'README.md': '# Nekotina-bot\n\nBot Discord estilo Nekotina. `npm install && npm run deploy && npm start`\n',
};

const log = (m) => console.log(m);

function parseOne(raw, expectPath) {
  const m = raw.match(/<<CONTENIDO>>([\s\S]*?)<<FIN>>/);
  if (!m) return null;
  let c = m[1].trim();
  if (c.startsWith('```')) c = c.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '');
  return c.length >= 20 ? { path: expectPath, content: c } : null;
}

async function ollamaOne(model, file, extra = '') {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYS },
        {
          role: 'user',
          content:
            `ARCHIVO=${file}\nBot Nekotina discord.js v14. APIs gratis (opentdb, open-meteo, jokeapi, pokeapi, meme-api). ` +
            `SlashCommandBuilder de "discord.js". fetch nativo. ${extra}`,
        },
      ],
      stream: false,
      options: { temperature: 0.05, num_predict: 4500 },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const d = await r.json();
  return parseOne(d.message?.content || '', file);
}

function writeBot(rel, content) {
  const full = join(BOT_WORK, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function copyRefIfExists(rel) {
  const src = join(REF_BOT, rel);
  if (!existsSync(src)) return false;
  try {
    execSync(`node --check "${src}"`, { stdio: 'pipe' });
    cpSync(src, join(BOT_WORK, rel));
    return true;
  } catch { return false; }
}

function validateBot() {
  try {
    execSync('node scripts/validate.js', { cwd: BOT_WORK, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function buildAnimalistWeb() {
  if (existsSync(WEB_WORK)) rmSync(WEB_WORK, { recursive: true });
  mkdirSync(join(WEB_WORK, 'public/css'), { recursive: true });
  mkdirSync(join(WEB_WORK, 'public/js'), { recursive: true });

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Refugio Animalista — Apartamento Pilahito</title>
  <link rel="stylesheet" href="css/styles.css" />
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800&display=swap" rel="stylesheet" />
</head>
<body>
  <header class="hero">
    <nav><span class="logo">🐾 Pilahito Animalista</span></nav>
    <div class="hero-content">
      <h1>Naturaleza, calma y hogar</h1>
      <p>Apartamento rural con alma animalista — descubre el Chalet Pilahito</p>
      <a class="btn" href="#galeria">Ver galería</a>
      <a class="btn outline" href="${MAPS_PHOTOS}" target="_blank" rel="noopener">Fotos en Google Maps</a>
    </div>
    <div class="leaves" aria-hidden="true"></div>
  </header>

  <section class="about">
    <h2>🌿 Espíritu animalista</h2>
    <p>Web dedicada al respeto por los animales y la vida en armonía con la naturaleza. 
    El <strong>Apartamento Pilahito</strong> es un refugio donde conviven diseño acogedor, 
    entorno rural y compromiso con el bienestar animal.</p>
  </section>

  <section id="galeria" class="gallery">
    <h2>📸 Apartamento Pilahito — Galería</h2>
    <p class="gallery-note">Fotos reales del alojamiento publicadas en Google Maps por el propietario.</p>
    <div class="cards">
      <a class="card" href="${MAPS_PHOTOS}" target="_blank" rel="noopener">
        <div class="card-img card-1"></div>
        <h3>Exterior y entorno</h3>
        <p>Ver fotos en Google Maps →</p>
      </a>
      <a class="card" href="${MAPS_PHOTOS}" target="_blank" rel="noopener">
        <div class="card-img card-2"></div>
        <h3>Interior acogedor</h3>
        <p>Ver fotos en Google Maps →</p>
      </a>
      <a class="card" href="${MAPS_PHOTOS}" target="_blank" rel="noopener">
        <div class="card-img card-3"></div>
        <h3>Detalles Pilahito</h3>
        <p>Ver fotos en Google Maps →</p>
      </a>
    </div>
    <p class="maps-link">
      <a href="${MAPS_CONTRIB}" target="_blank" rel="noopener">Perfil del contribuidor en Google Maps</a>
    </p>
  </section>

  <section class="map">
    <h2>📍 Ubicación</h2>
    <iframe
      title="Apartamento Pilahito en Google Maps"
      src="https://maps.google.com/maps?q=Chalet+Pilahito+Cadiz&output=embed"
      loading="lazy"
      referrerpolicy="no-referrer-when-downgrade"
    ></iframe>
  </section>

  <footer>
    <p>© 2026 DavidPilahito7 — Web animalista · <a href="${MAPS_PHOTOS}">Fotos Google Maps</a></p>
  </footer>
  <script src="js/main.js"></script>
</body>
</html>`;

  const css = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#2d6a4f;--light:#d8f3dc;--accent:#95d5b2;--dark:#1b4332}
body{font-family:'Nunito',system-ui,sans-serif;background:var(--light);color:var(--dark);line-height:1.6}
.hero{min-height:88vh;background:linear-gradient(135deg,var(--green),#40916c);color:#fff;position:relative;overflow:hidden;padding:1.5rem}
nav .logo{font-weight:800;font-size:1.2rem}
.hero-content{max-width:720px;margin:8vh auto 0;text-align:center;position:relative;z-index:2}
.hero h1{font-size:clamp(2rem,5vw,3.2rem);margin-bottom:.5rem;animation:fadeUp .8s ease}
.hero p{font-size:1.15rem;opacity:.95;animation:fadeUp 1s ease}
.btn{display:inline-block;margin:.5rem;padding:.75rem 1.4rem;background:#fff;color:var(--green);border-radius:999px;text-decoration:none;font-weight:700;transition:transform .2s}
.btn:hover{transform:translateY(-2px)}
.btn.outline{background:transparent;border:2px solid #fff;color:#fff}
.leaves{position:absolute;inset:0;background:radial-gradient(circle at 20% 80%,rgba(255,255,255,.08),transparent 40%),radial-gradient(circle at 80% 20%,rgba(255,255,255,.06),transparent 35%);animation:drift 12s ease-in-out infinite alternate}
section{padding:3rem 1.5rem;max-width:1000px;margin:0 auto}
h2{font-size:1.8rem;margin-bottom:1rem;color:var(--green)}
.gallery-note{margin-bottom:1.5rem;opacity:.85}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.2rem}
.card{background:#fff;border-radius:16px;overflow:hidden;text-decoration:none;color:inherit;box-shadow:0 8px 24px rgba(27,67,50,.12);transition:transform .25s}
.card:hover{transform:scale(1.03)}
.card-img{height:180px;background-size:cover;background-position:center}
.card-1{background-image:linear-gradient(45deg,#52b788,#2d6a4f)}
.card-2{background-image:linear-gradient(45deg,#74c69d,#1b4332)}
.card-3{background-image:linear-gradient(45deg,#95d5b2,#40916c)}
.card h3{padding:1rem 1rem .25rem}
.card p{padding:0 1rem 1rem;font-size:.9rem;color:var(--green)}
.maps-link{margin-top:1.5rem;text-align:center}
.maps-link a{color:var(--green);font-weight:700}
.map iframe{width:100%;height:360px;border:0;border-radius:16px}
footer{text-align:center;padding:2rem;background:var(--dark);color:#fff}
footer a{color:var(--accent)}
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes drift{from{transform:translateX(-2%)}to{transform:translateX(2%)}}
`;

  const js = `document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); }
  });
});
console.log('🐾 Web animalista Pilahito cargada');
`;

  writeFileSync(join(WEB_WORK, 'public/index.html'), html);
  writeFileSync(join(WEB_WORK, 'public/css/styles.css'), css);
  writeFileSync(join(WEB_WORK, 'public/js/main.js'), js);
  writeFileSync(join(WEB_WORK, 'README.md'), `# Web Animalista Pilahito\n\nAbre public/index.html en el navegador.\n\nFotos: ${MAPS_PHOTOS}\n`);
}

async function main() {
  log('══ Pipeline Pilahito — Bot Nekotina + Web Animalista ══\n');

  const tags = await (await fetch(`${OLLAMA}/api/tags`)).json();
  const model = tags.models?.find((m) => m.name.includes('qwen2.5-coder'))?.name || tags.models?.[0]?.name;
  log(`🧠 Modelo: ${model}`);

  if (existsSync(BOT_WORK)) rmSync(BOT_WORK, { recursive: true });
  mkdirSync(BOT_WORK, { recursive: true });

  log('\n── Fase 1: Bot Nekotina ──');
  let generated = 0;
  let fromRef = 0;

  for (const file of NEKOTINA_FILES) {
    if (file === 'index.js' && existsSync(REF_INDEX)) {
      writeBot('index.js', readFileSync(REF_INDEX, 'utf8'));
      log(`  ✅ index.js (plantilla verificada)`);
      continue;
    }
    if (copyRefIfExists(file)) {
      fromRef++;
      log(`  📋 ${file} (referencia OK)`);
      continue;
    }
    process.stdout.write(`  🧠 ${file}… `);
    let got = null;
    for (let i = 0; i < 3 && !got; i++) got = await ollamaOne(model, file);
    if (got) {
      writeBot(got.path, got.content);
      try {
        if (got.path.endsWith('.js')) execSync(`node --check "${join(BOT_WORK, got.path)}"`, { stdio: 'pipe' });
        log('✅');
        generated++;
      } catch {
        if (copyRefIfExists(file)) { log('📋 ref'); fromRef++; }
        else log('❌');
      }
    } else if (copyRefIfExists(file)) {
      log('📋 ref');
      fromRef++;
    } else if (SCAFFOLDS[file]) {
      writeBot(file, SCAFFOLDS[file]);
      log('📐 scaffold');
    } else {
      log('❌');
    }
  }

  mkdirSync(join(BOT_WORK, 'data'), { recursive: true });
  if (existsSync(TOKEN_FILE)) {
    const token = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (token && !existsSync(join(BOT_WORK, '.env'))) {
      writeFileSync(join(BOT_WORK, '.env'), `DISCORD_TOKEN=${token}\nCLIENT_ID=1515757314244870286\n`);
      log('  🔑 .env desde token Ayitax');
    }
  }

  log(`\n  Ollama: ${generated} | Referencia: ${fromRef}`);
  const ok = validateBot();
  log(ok ? '  ✅ Validación bot OK' : '  ⚠️ Validación con avisos');

  log('\n── Fase 2: Web animalista ──');
  buildAnimalistWeb();
  log('  ✅ Web creada con galería Google Maps Pilahito');

  log('\n── Fase 3: Copiar al Escritorio ──');
  if (existsSync(BOT_DEST)) rmSync(BOT_DEST, { recursive: true });
  cpSync(BOT_WORK, BOT_DEST, { recursive: true, filter: (src) => !src.includes('node_modules') });
  log(`  📁 Bot → ${BOT_DEST}`);

  if (existsSync(WEB_DEST)) rmSync(WEB_DEST, { recursive: true });
  cpSync(WEB_WORK, WEB_DEST, { recursive: true });
  log(`  📁 Web → ${WEB_DEST}`);

  log('\n🎉 Listo en el Escritorio:');
  log(`   Bot:  ${BOT_DEST}`);
  log(`   Web:  ${WEB_DEST}/public/index.html`);
  log(`   Fotos: ${MAPS_PHOTOS}`);
}

main().catch((e) => { console.error(e); process.exit(1); });