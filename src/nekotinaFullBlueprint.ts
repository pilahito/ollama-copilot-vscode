/**
 * Blueprint Nekotina COMPLETO — tienda animales, minería, trabajo, economía, anime, MEE6-like niveles.
 * Ollama debe generar TODOS estos archivos (modo 1-archivo).
 */

export const NEKOTINA_FULL_FILES: string[] = [
  'package.json', '.env.example', 'README.md', 'index.js', 'deploy-commands.js',
  'utils/db.js',
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
  'scripts/validate.js',
];

export const NEKOTINA_FULL_SPEC = `
Bot Discord CLON NEKOTINA + MEE6 — TODO GRATIS, 100% FUNCIONAL.

SISTEMAS OBLIGATORIOS (código REAL, sin placeholders):
1. TIENDA ANIMALES (/shop): comprar mascotas con monedas, listar tienda, activar mascota. config/shop.js con 8+ animales y precios.
2. MINERÍA (/mine): minar minerales con cooldown, inventario JSON, vender por monedas. config/mines.js carbón→diamante.
3. TRABAJO (/work): 5+ trabajos (minero, granjero, pescador, chef, programador) con cooldown y pago. config/jobs.js.
4. ECONOMÍA (/economy): balance, pay, leaderboard. /daily recompensa 24h. userService.js unifica datos en data/users.json.
5. MASCOTAS (/pets): ver zoo del usuario. Mascotas dan bonus a mina/trabajo.
6. PERFIL (/profile): balance, nivel, mascotas, inventario, stats.
7. NIVELES MEE6: XP por mensajes (messageCreate) y comandos. /levels rank y leaderboard.
8. ANIME (/anime): nekos.best API con categorías. /nsfw solo canal NSFW con nekobot.xyz.
9. APIs: opentdb, open-meteo, jokeapi, pokeapi, meme-api.com.
10. MÚSICA/RADIO: @discordjs/voice + play-dl YouTube; radio streams Icecast.
11. JUEGOS: coinflip, rps, 8ball, dice, slots con economía.
12. MODERACIÓN: kick, ban, timeout, clear.

Stack: Node 18+, discord.js v14, dotenv, @discordjs/voice, play-dl, libsodium-wrappers.
SlashCommandBuilder de "discord.js". fetch nativo. Persistencia utils/db.js load/save JSON.
index.js: intents Guilds, GuildVoiceStates, GuildMessages, MessageContent.
`;

export function getNekotinaFileHint(filePath: string): string {
  const hints: Record<string, string> = {
    'package.json': 'discord.js ^14, dotenv, @discordjs/voice, play-dl, libsodium-wrappers. scripts start/deploy/check.',
    'config/shop.js': 'module.exports = array de animales {id,name,price,rarity,emoji,bonusMine,bonusWork}. 8+ animales.',
    'config/mines.js': 'module.exports = minerales {id,name,emoji,value,weight,min,max}.',
    'config/jobs.js': 'module.exports = trabajos {id,name,emoji,payMin,payMax,cooldown,desc}.',
    'services/userService.js': 'getUser, mutateUser, petBonus, getLeaderboard. data/users.json balance,pets,inventory,stats.',
    'services/shopService.js': 'buyPet, setActivePet, listShop usando config/shop.',
    'services/miningService.js': 'mine con cooldown, rollOre, sellOre, sellAll.',
    'services/jobService.js': 'work(jobId) con cooldown por trabajo.',
    'commands/shop.js': 'subcomandos list, buy, active. SlashCommandBuilder.',
    'commands/mine.js': 'subcomandos mine, sell, sellall, inventory.',
    'commands/work.js': 'subcomandos list, do (elegir trabajo).',
    'commands/profile.js': 'embed con balance, nivel, mascotas, inventario.',
    'commands/pets.js': 'listar mascotas del usuario con emojis.',
    'commands/anime.js': 'fetch nekos.best/api/v2/{cat} User-Agent header, EmbedBuilder.',
    'musica/player.js': 'VoicePlayer class play-dl YouTube + playStream radio.',
    'events/messageCreate.js': 'XP cada 60s con levelsService.',
  };
  return hints[filePath] ?? 'Código completo ejecutable discord.js v14.';
}

export function getNekotinaMinExpected(): number {
  return NEKOTINA_FULL_FILES.length - 2; // README + validate no cuentan igual
}