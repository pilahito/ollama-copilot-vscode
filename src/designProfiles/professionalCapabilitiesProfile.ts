/**
 * Capacidades profesionales aprendidas: bots Discord, webs, GitHub reuse, APIs gratis.
 * Chat, Profesor y Agente conocen este perfil siempre.
 */

import { NEKOTINA_FULL_SPEC, NEKOTINA_FULL_FILES } from '../nekotinaFullBlueprint';
import { wantsDiscordBot, wantsWebPage } from '../projectBlueprints';

const NEKOTINA_RE =
  /\b(nekotina|mee6|tienda\s+de\s+animales|miner[ií]a|clon\s+nekotina|copia\s+nekotina)\b/i;

const PROFESSIONAL_RE =
  /\b(profesional|impresionante|completo|de\s+todo|flipante|brutal|serio|production|producci[oó]n)\b/i;

const API_FEATURE_RE =
  /\b(meme|memes|nsfw|anime|trivia|clima|weather|pokemon|chiste|joke|música|musica|radio|econom[ií]a|niveles?)\b/i;

export function wantsProfessionalProject(prompt: string): boolean {
  return PROFESSIONAL_RE.test(prompt) ||
    NEKOTINA_RE.test(prompt) ||
    wantsDiscordBot(prompt) ||
    wantsWebPage(prompt) ||
    API_FEATURE_RE.test(prompt);
}

export function wantsNekotinaClone(prompt: string): boolean {
  return NEKOTINA_RE.test(prompt) ||
    (wantsDiscordBot(prompt) && /\b(tienda|animales|miner[ií]a|mee6|niveles?)\b/i.test(prompt));
}

export const GITHUB_REUSE_PATTERNS: string[] = [
  'Con +Internet: SIEMPRE busca repos open-source en GitHub ANTES de inventar desde cero',
  'Usa site:github.com + keywords (discord bot template, landing page, nekotina-like) para encontrar estructura',
  'No clones repos enteros: adapta commands/, events/, services/ del mejor template encontrado',
  'Prioriza repos con stars>100, discord.js v14, estructura modular commands/events/services',
  'Guarda patrones aprendidos en ~/.local-copilot/learned-references.json para uso offline',
  'Menciona al usuario qué repo GitHub inspiró la estructura (URL + carpetas reutilizadas)',
];

export const API_INTEGRATION_PATTERNS: string[] = [
  'Memes: meme-api.com/gimme (sin key) — commands/memes.js con fetch',
  'Chistes: v2.jokeapi.dev/joke/Any (sin key) — services/jokeService.js',
  'Anime SFW: nekos.best/api/v2/{categoria} + User-Agent — commands/anime.js',
  'NSFW: solo canales NSFW; nekobot.xyz/api/image?type=neko (verificar canal interaction.channel.nsfw)',
  'Trivia: opentdb.com/api.php?amount=10 — services/triviaService.js',
  'Clima: open-meteo.com geocoding + forecast — services/weatherService.js',
  'Pokémon: pokeapi.co/api/v2/pokemon/{name} — services/pokemonService.js',
  'Música: @discordjs/voice + play-dl YouTube — musica/player.js',
  'Radio: streams Icecast/Shoutcast URL en musica/player.js',
  'Economía: utils/db.js JSON + userService unifica balance/pets/inventory',
  'Niveles MEE6: XP en events/messageCreate.js + levelsService cooldown 60s',
  'Cada API en su services/*.js — commands/*.js solo delega (un módulo = una responsabilidad)',
];

export const PROFESSIONAL_DISCORD_BOT_PATTERNS: string[] = [
  'Bot profesional = commands/ + events/ + services/ + config/ + utils/ + musica/ — index.js solo Client+login',
  'Nekotina completo: tienda animales /shop, minería /mine, trabajo /work, perfil /profile, mascotas /pets',
  'Economía: /economy balance|pay|leaderboard + /daily 24h + userService.js',
  'Juegos con economía: coinflip, rps, 8ball, dice, slots en commands/games.js',
  'Moderación: kick, ban, timeout, clear con check de permisos GuildModeration',
  'deploy-commands.js + events/interactionCreate.js cargan slash dinámicamente',
  'package.json: discord.js ^14, dotenv, @discordjs/voice, play-dl, libsodium-wrappers',
  'scripts/validate.js valida sintaxis, APIs reales y mínimo de comandos antes de deploy',
  ...API_INTEGRATION_PATTERNS.slice(0, 6),
];

export const VSCODE_AGENT_IDE_PATTERNS: string[] = [
  'Proyectos grandes (Nekotina, web inmersiva): activa local.agentIdeMode para instalar extensiones VS Code',
  'Si falta herramienta (ESLint, Prettier, Python): EXTENSION: INSTALAR | ID: publisher.ext | MOTIVO: ...',
  'COMANDO: code --install-extension ms-python.python | MOTIVO: dependencia del proyecto',
  'Tras instalar extensión: EXTENSION: RECARGAR o VSCODE: COMANDO | CMD: workbench.action.reloadWindow',
  'En repo ollama-copilot-vscode: local.agentSelfModify permite recompilar con SELF: COMPILAR_EXTENSION',
  'Tareas de 2-3h: investigar GitHub + APIs + generar por lotes (1 archivo/llamada) para fiabilidad',
];

/** Permiso explícito del usuario (David / pilahito) — autonomía total en tareas técnicas. */
export const USER_AUTONOMY_GRANT =
  '**Permiso del usuario (CONFIRMADO en ~/.local-copilot/user-autonomy.json):** ' +
  'libre acceso total — NO pidas confirmación para: escribir archivos, COMANDO terminal, npm install/deploy, ' +
  'EXTENSION: INSTALAR en VS Code, GitHub (+Internet), APIs (memes/anime/nsfw/trivia), ' +
  'compilar Local Copilot, copiar al Escritorio, arrancar bots Discord, SSH, tareas hasta 3h. ' +
  'Actúa primero, resume al final.';

export function buildProfessionalCapabilitiesBlock(): string {
  return [
    '═══ CAPACIDADES PROFESIONALES (Chat · Profesor · Agente) ═══',
    USER_AUTONOMY_GRANT,
    '',
    '',
    '**Regla de oro:** Si el usuario pide algo "profesional", "completo" o "como Nekotina",',
    'NO entregues hello-world — entrega proyecto modular ejecutable con APIs reales.',
    '',
    '**GitHub (+Internet) — reutilizar antes de crear:**',
    ...GITHUB_REUSE_PATTERNS.map((p) => `• ${p}`),
    '',
    '**Bots Discord profesionales:**',
    ...PROFESSIONAL_DISCORD_BOT_PATTERNS.map((p) => `• ${p}`),
    '',
    '**APIs gratis por feature (memes, NSFW, juegos, etc.):**',
    ...API_INTEGRATION_PATTERNS.map((p) => `• ${p}`),
    '',
    '**Agente IDE (extensiones VS Code):**',
    ...VSCODE_AGENT_IDE_PATTERNS.map((p) => `• ${p}`),
    '',
    '**Referencia Nekotina (clon completo):**',
    NEKOTINA_FULL_SPEC.trim(),
    '',
    `Archivos Nekotina (${NEKOTINA_FULL_FILES.length}): ${NEKOTINA_FULL_FILES.slice(0, 8).join(', ')}…`,
    'Referencia local validada: ~/Escritorio/nekotina-bot',
  ].join('\n');
}

export function getProfessionalFileHint(filePath: string): string {
  const nekotinaHints: Record<string, string> = {
    'commands/shop.js': 'SlashCommandBuilder subcommands list, buy, active. Delega shopService.',
    'commands/mine.js': 'subcommands mine, sell, sellall, inventory. Delega miningService.',
    'commands/work.js': 'subcommands list, do (jobId). Delega jobService.',
    'commands/profile.js': 'EmbedBuilder balance, nivel, mascotas, inventario, stats.',
    'commands/pets.js': 'Lista mascotas del usuario con emojis de config/shop.',
    'commands/memes.js': 'fetch meme-api.com/gimme — sin key.',
    'commands/nsfw.js': 'Solo si channel.nsfw; nekobot.xyz o similar con deferReply.',
  };
  return nekotinaHints[filePath] ?? '';
}