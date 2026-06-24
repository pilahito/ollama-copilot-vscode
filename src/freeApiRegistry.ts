/**
 * Registro amplio de APIs y servicios gratuitos para bots, webs y juegos.
 */

export interface FreeApiEntry {
  id: string;
  name: string;
  category: string;
  role: string;
  url: string;
  auth: 'none' | 'free-key' | 'oauth';
  envVars?: string[];
  npm?: string;
  pip?: string;
  example?: string;
  note?: string;
}

export const FREE_API_REGISTRY: FreeApiEntry[] = [
  { id: 'discord-api', name: 'Discord API', category: 'bots', role: 'Gateway bots, slash commands', url: 'https://discord.com/developers/docs', auth: 'free-key', envVars: ['DISCORD_TOKEN'], npm: 'discord.js' },
  { id: 'open-meteo', name: 'Open-Meteo', category: 'weather', role: 'Clima sin API key', url: 'https://open-meteo.com/en/docs', auth: 'none', example: 'GET https://api.open-meteo.com/v1/forecast?latitude=40.4&longitude=-3.7&current=temperature_2m' },
  { id: 'open-trivia', name: 'Open Trivia DB', category: 'games', role: 'Preguntas trivia', url: 'https://opentdb.com/api_config.php', auth: 'none', example: 'GET https://opentdb.com/api.php?amount=10' },
  { id: 'jokeapi', name: 'JokeAPI', category: 'fun', role: 'Chistes HTTP', url: 'https://v2.jokeapi.dev/', auth: 'none' },
  { id: 'giphy', name: 'Giphy', category: 'media', role: 'GIFs', url: 'https://developers.giphy.com/docs/api', auth: 'free-key', envVars: ['GIPHY_API_KEY'] },
  { id: 'restcountries', name: 'REST Countries', category: 'data', role: 'Datos de países', url: 'https://restcountries.com/', auth: 'none' },
  { id: 'pokeapi', name: 'PokéAPI', category: 'games', role: 'Datos Pokémon', url: 'https://pokeapi.co/docs/v2', auth: 'none' },
  { id: 'meme-api', name: 'meme-api.com', category: 'fun', role: 'Memes aleatorios sin key', url: 'https://meme-api.com/gimme', auth: 'none', example: 'GET https://meme-api.com/gimme' },
  { id: 'nekos-best', name: 'nekos.best', category: 'media', role: 'Imágenes anime SFW', url: 'https://nekos.best/api/docs', auth: 'none', example: 'GET https://nekos.best/api/v2/neko' },
  { id: 'nekobot', name: 'nekobot.xyz', category: 'media', role: 'Imágenes NSFW (solo canales +18)', url: 'https://nekobot.xyz/api', auth: 'none', note: 'Verificar interaction.channel.nsfw antes de responder' },
  { id: 'unsplash', name: 'Unsplash API', category: 'media', role: 'Fotos HD', url: 'https://unsplash.com/developers', auth: 'free-key', envVars: ['UNSPLASH_ACCESS_KEY'] },
  { id: 'telegraf', name: 'Telegram Bot API', category: 'bots', role: 'Bots Telegram', url: 'https://core.telegram.org/bots/api', auth: 'free-key', envVars: ['TELEGRAM_BOT_TOKEN'], npm: 'telegraf' },
  { id: 'paper-docs', name: 'PaperMC API', category: 'minecraft', role: 'Plugins Paper/Spigot', url: 'https://docs.papermc.io/paper/dev/getting-started/', auth: 'none' },
  { id: 'fabric-docs', name: 'Fabric API', category: 'minecraft', role: 'Mods Fabric', url: 'https://fabricmc.net/wiki/tutorial:setup', auth: 'none' },
  { id: 'forge-docs', name: 'Forge MDK', category: 'minecraft', role: 'Mods Forge', url: 'https://docs.minecraftforge.net/', auth: 'none' },
  { id: 'jsonplaceholder', name: 'JSONPlaceholder', category: 'dev', role: 'API REST fake para prototipos', url: 'https://jsonplaceholder.typicode.com/', auth: 'none' },
  { id: 'supabase', name: 'Supabase', category: 'backend', role: 'Auth + Postgres gratis', url: 'https://supabase.com/docs', auth: 'free-key', envVars: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] },
  { id: 'resend', name: 'Resend', category: 'email', role: 'Emails transaccionales (tier gratis)', url: 'https://resend.com/docs', auth: 'free-key', envVars: ['RESEND_API_KEY'] },
  { id: 'gsap', name: 'GSAP', category: 'web-animation', role: 'Animaciones web profesionales', url: 'https://gsap.com/docs/v3/', auth: 'none', npm: 'gsap' },
  { id: 'aos', name: 'AOS', category: 'web-animation', role: 'Animaciones al scroll', url: 'https://michalsnik.github.io/aos/', auth: 'none', npm: 'aos' },
  { id: 'three', name: 'Three.js', category: 'web-3d', role: 'Gráficos 3D en web', url: 'https://threejs.org/docs/', auth: 'none', npm: 'three' },
];

const PROMPT_CATEGORY_MAP: { re: RegExp; categories: string[] }[] = [
  { re: /\b(discord|slash|bot|nekotina)\b/i, categories: ['bots', 'fun', 'games', 'media'] },
  { re: /\b(meme|nsfw|anime|neko)\b/i, categories: ['fun', 'media'] },
  { re: /\b(telegram)\b/i, categories: ['bots'] },
  { re: /\b(clima|weather|tiempo)\b/i, categories: ['weather'] },
  { re: /\b(trivia|quiz|juego|game|pokemon)\b/i, categories: ['games', 'fun'] },
  { re: /\b(minecraft|paper|spigot|fabric|forge|plugin|mod\b)\b/i, categories: ['minecraft'] },
  { re: /\b(animaci[oó]n|din[aá]mico|parallax|scroll|web|p[aá]gina|landing)\b/i, categories: ['web-animation', 'web-3d', 'media'] },
  { re: /\b(api|rest|backend|express|fastapi)\b/i, categories: ['dev', 'backend', 'data'] },
  { re: /\b(email|correo|smtp)\b/i, categories: ['email'] },
  { re: /\b(imagen|foto|gif|galer[ií]a|animal)\b/i, categories: ['media'] },
];

export function matchFreeApis(prompt: string, limit = 8): FreeApiEntry[] {
  const categories = new Set<string>();
  for (const { re, categories: cats } of PROMPT_CATEGORY_MAP) {
    if (re.test(prompt)) {
      cats.forEach((c) => categories.add(c));
    }
  }

  if (!categories.size) {
    return FREE_API_REGISTRY.slice(0, limit);
  }

  return FREE_API_REGISTRY
    .filter((e) => categories.has(e.category))
    .slice(0, limit);
}

export function formatFreeApisForPrompt(prompt: string): string {
  const apis = matchFreeApis(prompt);
  if (!apis.length) { return ''; }

  const lines = ['## APIs y servicios gratuitos relevantes', ''];
  for (const api of apis) {
    const auth = api.auth === 'none' ? 'sin key' : api.auth === 'free-key' ? 'key gratis' : 'OAuth';
    lines.push(`- **${api.name}** (${auth}): ${api.role}`);
    lines.push(`  Docs: ${api.url}`);
    if (api.npm) { lines.push(`  npm: \`${api.npm}\``); }
    if (api.envVars?.length) { lines.push(`  .env: ${api.envVars.join(', ')}`); }
    if (api.example) { lines.push(`  Ejemplo: \`${api.example}\``); }
    if (api.note) { lines.push(`  _${api.note}_`); }
  }
  return lines.join('\n');
}