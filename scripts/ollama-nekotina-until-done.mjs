#!/usr/bin/env node
/**
 * OLLAMA genera Nekotina COMPLETO — no para hasta cumplir.
 * 1 archivo / llamada · reintentos · validación · bucle hasta OK (hasta 3h).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = 'http://127.0.0.1:11434';
const BUILD = '/home/david/nekotina-ollama-full';
const DESKTOP = '/home/david/Escritorio/nekotina-bot';
const TOKEN = '/home/david/Escritorio/token Ayitax';
const MAX_HOURS = 3;
const MAX_ATTEMPTS = 5;
const MAX_ROUNDS = 8;

const SPEC = `
CLON NEKOTINA+MEE6 discord.js v14. APIs gratis. Código REAL ejecutable.
TIENDA animales /shop | MINERÍA /mine | TRABAJO /work | PERFIL /profile | MASCOTAS /pets
ECONOMÍA balance/pay/leaderboard | DAILY 24h | NIVELES XP mensajes | ANIME nekos.best
MÚSICA play-dl+voice | RADIO streams | JUEGOS slots | MOD kick/ban/timeout
utils/db.js load/save JSON. userService unifica usuarios. Sin TODO ni placeholders.
`;

const FILES = [
  'package.json', '.env.example', 'README.md', 'utils/db.js',
  'config/shop.js', 'config/mines.js', 'config/jobs.js',
  'services/userService.js', 'services/shopService.js', 'services/miningService.js',
  'services/jobService.js', 'services/economyService.js', 'services/levelsService.js',
  'services/triviaService.js', 'services/weatherService.js', 'services/jokeService.js',
  'services/pokemonService.js',
  'musica/player.js',
  'events/ready.js', 'events/interactionCreate.js', 'events/messageCreate.js',
  'commands/ping.js', 'commands/help.js', 'commands/profile.js',
  'commands/shop.js', 'commands/mine.js', 'commands/work.js',
  'commands/economy.js', 'commands/daily.js', 'commands/pets.js',
  'commands/trivia.js', 'commands/weather.js', 'commands/joke.js',
  'commands/pokemon.js', 'commands/memes.js', 'commands/anime.js', 'commands/nsfw.js',
  'commands/music.js', 'commands/radio.js', 'commands/moderation.js',
  'commands/games.js', 'commands/levels.js',
  'deploy-commands.js', 'index.js',
  'scripts/validate.js',
];

const HINTS = {
  'package.json': 'JSON: discord.js, dotenv, @discordjs/voice, play-dl, libsodium-wrappers',
  'config/shop.js': '10 animales con id,name,price,rarity,emoji,bonusMine,bonusWork',
  'config/mines.js': '6 minerales carbón a diamante con value y weight',
  'config/jobs.js': '6 trabajos minero granjero pescador chef programador veterinario',
  'services/userService.js': 'getUser mutateUser petBonus getLeaderboard pets inventory balance',
  'commands/shop.js': 'SlashCommandBuilder subcommands list buy active',
  'commands/mine.js': 'subcommands mine sell sellall inventory cooldown',
  'commands/work.js': 'subcommands list do jobId',
  'commands/profile.js': 'EmbedBuilder balance nivel mascotas inventario',
  'commands/anime.js': 'nekos.best/api/v2 categorías neko waifu hug',
  'musica/player.js': 'play-dl stream_from_info @discordjs/voice',
  'index.js': 'intents Guilds GuildVoiceStates GuildMessages MessageContent client.player',
};

const SYS =
  'SOLO UN bloque ACCION:\nACCION: CREAR | RUTA: archivo | MOTIVO: x\n<<CONTENIDO>>\ncódigo completo\n<<FIN>>\n' +
  'PROHIBIDO PLAN, EXPLICACION, TODO, placeholders.';

const t0 = Date.now();
const log = (m) => {
  const elapsed = ((Date.now() - t0) / 60_000).toFixed(1);
  console.log(`[${elapsed}m] ${m}`);
};

function parse(raw) {
  const m = raw.match(/<<CONTENIDO>>([\s\S]*?)<<FIN>>/);
  if (m) {
    let c = m[1].trim();
    if (c.startsWith('```')) c = c.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '');
    return c.length >= 30 ? c : null;
  }
  const code = raw.match(/```(?:json|javascript|js)?\s*\n([\s\S]*?)```/);
  return code?.[1]?.trim()?.length >= 30 ? code[1].trim() : null;
}

async function pickModel() {
  const tags = (await (await fetch(`${OLLAMA}/api/tags`)).json()).models ?? [];
  const order = ['qwen2.5-coder:14b', 'qwen2.5:14b', 'qwen2.5-coder:7b', 'local-copilot-turbo:latest'];
  for (const name of order) {
    if (tags.find((m) => m.name === name)) return name;
  }
  return tags[0]?.name;
}

async function gen(model, file, extra = '') {
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
            `${SPEC}\n\nARCHIVO OBLIGATORIO: ${file}\n` +
            `Requisitos: ${HINTS[file] || 'discord.js v14 código completo'}\n${extra}`,
        },
      ],
      stream: false,
      options: { temperature: 0.03, num_predict: 8000 },
    }),
    signal: AbortSignal.timeout(600_000),
  });
  return parse((await r.json()).message?.content || '');
}

function write(rel, content) {
  const full = join(BUILD, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function validate() {
  const issues = [];
  const mustCmd = ['shop.js', 'mine.js', 'work.js', 'profile.js', 'pets.js', 'anime.js', 'economy.js', 'levels.js'];
  const cmdDir = join(BUILD, 'commands');
  if (!existsSync(cmdDir)) return ['sin commands/'];
  const cmds = readdirSync(cmdDir).filter((f) => f.endsWith('.js'));
  if (cmds.length < 22) issues.push(`solo ${cmds.length} comandos (min 22)`);
  for (const c of mustCmd) if (!cmds.includes(c)) issues.push(`falta commands/${c}`);
  for (const c of ['shop.js', 'mines.js', 'jobs.js']) {
    if (!existsSync(join(BUILD, 'config', c))) issues.push(`falta config/${c}`);
  }
  for (const s of ['userService.js', 'shopService.js', 'miningService.js', 'jobService.js']) {
    if (!existsSync(join(BUILD, 'services', s))) issues.push(`falta services/${s}`);
  }
  if (!existsSync(join(BUILD, 'index.js'))) issues.push('falta index.js');

  const checkJs = [...cmds.map((c) => `commands/${c}`), 'index.js', 'deploy-commands.js',
    'services/userService.js', 'commands/shop.js', 'commands/mine.js', 'commands/work.js'].filter((f) => existsSync(join(BUILD, f)));
  for (const f of checkJs) {
    try { execSync(`node --check "${join(BUILD, f)}"`, { stdio: 'pipe' }); }
    catch { issues.push(`sintaxis rota: ${f}`); }
  }

  const shop = existsSync(join(BUILD, 'commands/shop.js'))
    ? readFileSync(join(BUILD, 'commands/shop.js'), 'utf8') : '';
  if (shop && !/buy|list|shop/i.test(shop)) issues.push('shop.js sin lógica tienda');

  const mine = existsSync(join(BUILD, 'commands/mine.js'))
    ? readFileSync(join(BUILD, 'commands/mine.js'), 'utf8') : '';
  if (mine && !/mine|sell|min/i.test(mine)) issues.push('mine.js sin minería');

  const work = existsSync(join(BUILD, 'commands/work.js'))
    ? readFileSync(join(BUILD, 'commands/work.js'), 'utf8') : '';
  if (work && !/work|job|trabaj/i.test(work)) issues.push('work.js sin trabajos');

  const anime = existsSync(join(BUILD, 'commands/anime.js'))
    ? readFileSync(join(BUILD, 'commands/anime.js'), 'utf8') : '';
  if (anime && !/nekos|fetch|anime/i.test(anime)) issues.push('anime.js sin API');

  const all = cmds.map((c) => readFileSync(join(cmdDir, c), 'utf8')).join('\n');
  if (/instala.*@discordjs|módulo música: instala|\bTODO\b/i.test(all)) issues.push('texto relleno en comandos');

  return issues;
}

async function main() {
  log('══ OLLAMA → NEKOTINA COMPLETO (hasta cumplir) ══');
  const model = await pickModel();
  log(`Modelo: ${model} (RTX 3060 12GB → coder:14b recomendado)`);

  if (existsSync(BUILD)) rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });

  let round = 0;
  while (round < MAX_ROUNDS) {
    if ((Date.now() - t0) > MAX_HOURS * 3600_000) {
      log(`⏱ Límite ${MAX_HOURS}h alcanzado`);
      break;
    }
    round++;
    log(`── Ronda ${round}/${MAX_ROUNDS} ──`);

    const missing = FILES.filter((f) => !existsSync(join(BUILD, f)));
    const broken = [];
    for (const f of FILES.filter((x) => x.endsWith('.js') && existsSync(join(BUILD, x)))) {
      try { execSync(`node --check "${join(BUILD, f)}"`, { stdio: 'pipe' }); }
      catch { broken.push(f); }
    }
    const todo = [...new Set([...missing, ...broken])];
    if (!todo.length) {
      const issues = validate();
      if (!issues.length) {
        log('🎉 VALIDACIÓN COMPLETA — Nekotina cumple todos los requisitos');
        break;
      }
      log(`Validación: ${issues.join('; ')}`);
      todo.push(...issues.filter((i) => i.startsWith('falta ')).map((i) => i.replace('falta ', '')));
      if (issues.some((i) => i.includes('shop'))) todo.push('commands/shop.js');
      if (issues.some((i) => i.includes('mine'))) todo.push('commands/mine.js');
      if (issues.some((i) => i.includes('work'))) todo.push('commands/work.js');
      if (issues.some((i) => i.includes('anime'))) todo.push('commands/anime.js');
      if (!todo.length) {
        log('Re-generando archivos clave por validación lógica…');
        todo.push('commands/shop.js', 'commands/mine.js', 'commands/work.js', 'services/userService.js');
      }
    }

    log(`Pendientes: ${todo.length} archivos`);
    let ok = 0;
    for (const file of todo) {
      if ((Date.now() - t0) > MAX_HOURS * 3600_000) break;
      process.stdout.write(`  🧠 ${file}… `);
      let content = null;
      for (let a = 0; a < MAX_ATTEMPTS && !content; a++) {
        const extra = a > 0 ? `CORRECCIÓN intento ${a + 1}: código COMPLETO sin errores sintaxis.` : '';
        content = await gen(model, file, extra);
      }
      if (content) {
        write(file, content);
        try {
          if (file.endsWith('.js')) execSync(`node --check "${join(BUILD, file)}"`, { stdio: 'pipe' });
          console.log('✅');
          ok++;
        } catch {
          console.log('⚠️ sintaxis');
        }
      } else console.log('❌');
    }
    log(`Ronda ${round}: +${ok} archivos`);

    const issues = validate();
    if (!issues.length) {
      log('🎉 NEKOTINA COMPLETO generado por OLLAMA');
      break;
    }
    log(`Quedan: ${issues.join(' | ')}`);
  }

  const issues = validate();
  if (existsSync(TOKEN)) {
    write('.env', readFileSync(TOKEN, 'utf8').trim().split('\n').map((l) =>
      l.includes('=') ? l : `DISCORD_TOKEN=${l}`
    ).join('\n') + '\nCLIENT_ID=1515757314244870286\n');
  }

  try {
    execSync('npm install', { cwd: BUILD, stdio: 'pipe', timeout: 120_000 });
    log('npm install OK');
  } catch { log('npm install con avisos'); }

  if (!issues.length) {
    if (existsSync(DESKTOP)) rmSync(DESKTOP, { recursive: true, force: true });
    execSync(`cp -a "${BUILD}/." "${DESKTOP}/"`, { stdio: 'pipe' });
    log(`📁 Copiado a ${DESKTOP}`);
    try {
      execSync('node deploy-commands.js', { cwd: DESKTOP, stdio: 'pipe' });
      log('Comandos desplegados en Discord');
    } catch (e) { log('deploy: ' + (e.stderr?.toString() || e.message)); }
  }

  log(issues.length ? `⚠️ Terminado con ${issues.length} pendiente(s): ${issues.join(', ')}` : '✅ LISTO — npm start en Escritorio/nekotina-bot');
  process.exit(issues.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });