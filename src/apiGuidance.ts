/**
 * Recomienda APIs y librerías existentes con sentido común según la tarea.
 */

import type { ProjectBlueprint } from './projectBlueprints';
import {
  wantsDiscordBot,
  wantsRestApi,
  wantsWebPage,
  wantsMinecraftPlugin,
  wantsMinecraftModFabric,
  wantsMinecraftModForge,
  wantsAndroidRom,
  wantsVscodeExtension,
} from './projectBlueprints';

export interface ApiRecommendation {
  name: string;
  role: string;
  npm?: string;
  pip?: string;
  docs?: string;
  envVars?: string[];
  free: boolean;
  note?: string;
}

const DISCORD_CORE: ApiRecommendation[] = [
  {
    name: 'Discord API',
    role: 'Gateway del bot (slash commands, eventos)',
    npm: 'discord.js',
    docs: 'https://discord.js.org/docs',
    envVars: ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'],
    free: true,
    note: 'Token en Developer Portal → Bot → Token. Nunca hardcodear.',
  },
  {
    name: 'dotenv',
    role: 'Variables de entorno (.env)',
    npm: 'dotenv',
    free: true,
  },
];

const FEATURE_APIS: { re: RegExp; apis: ApiRecommendation[] }[] = [
  {
    re: /\b(musica|música|music|play|reproducir|youtube|spotify|cola)\b/i,
    apis: [
      {
        name: '@discordjs/voice',
        role: 'Audio en canales de voz Discord',
        npm: '@discordjs/voice @discordjs/opus',
        docs: 'https://discordjs.guide/voice/',
        free: true,
      },
      {
        name: 'play-dl',
        role: 'Extraer audio de URLs (YouTube, etc.)',
        npm: 'play-dl',
        docs: 'https://www.npmjs.com/package/play-dl',
        free: true,
        note: 'Respeta ToS de las plataformas; para producción valora APIs oficiales.',
      },
    ],
  },
  {
    re: /\b(trivia|quiz|preguntas?)\b/i,
    apis: [
      {
        name: 'Open Trivia DB',
        role: 'Preguntas de trivia gratis (REST)',
        docs: 'https://opentdb.com/api_config.php',
        free: true,
        note: 'GET https://opentdb.com/api.php?amount=10 — sin API key.',
      },
    ],
  },
  {
    re: /\b(clima|tiempo|weather|temperatura)\b/i,
    apis: [
      {
        name: 'Open-Meteo',
        role: 'Clima gratis sin API key',
        docs: 'https://open-meteo.com/en/docs',
        free: true,
        note: 'GET geocoding + forecast — ideal para bots.',
      },
      {
        name: 'OpenWeatherMap',
        role: 'Clima alternativo (requiere key gratis)',
        docs: 'https://openweathermap.org/api',
        envVars: ['OPENWEATHER_API_KEY'],
        free: true,
      },
    ],
  },
  {
    re: /\b(meme|chiste|joke|humor)\b/i,
    apis: [
      {
        name: 'JokeAPI',
        role: 'Chistes por HTTP',
        docs: 'https://v2.jokeapi.dev/',
        free: true,
        note: 'GET https://v2.jokeapi.dev/joke/Any — sin key.',
      },
    ],
  },
  {
    re: /\b(imagen|image|gif|meme)\b/i,
    apis: [
      {
        name: 'Giphy API',
        role: 'GIFs (key gratis en developers.giphy.com)',
        docs: 'https://developers.giphy.com/docs/api',
        envVars: ['GIPHY_API_KEY'],
        free: true,
      },
    ],
  },
  {
    re: /\b(github|repo|repositorio|commits?|issues?)\b/i,
    apis: [
      {
        name: 'GitHub REST API',
        role: 'Consultar repos, issues, usuarios',
        npm: 'octokit',
        docs: 'https://docs.github.com/en/rest',
        envVars: ['GITHUB_TOKEN'],
        free: true,
        note: 'Token fine-grained o PAT en .env.',
      },
    ],
  },
  {
    re: /\b(telegram)\b/i,
    apis: [
      {
        name: 'Telegram Bot API',
        role: 'Bot Telegram oficial',
        npm: 'telegraf',
        docs: 'https://telegraf.js.org/',
        envVars: ['TELEGRAM_BOT_TOKEN'],
        free: true,
      },
    ],
  },
  {
    re: /\b(traducir|translate|traducci[oó]n)\b/i,
    apis: [
      {
        name: 'LibreTranslate',
        role: 'Traducción open source (self-host o instancia pública)',
        docs: 'https://libretranslate.com/docs/',
        free: true,
      },
    ],
  },
  {
    re: /\b(moneda|crypto|bitcoin|ethereum|precio)\b/i,
    apis: [
      {
        name: 'CoinGecko API',
        role: 'Precios crypto gratis',
        docs: 'https://www.coingecko.com/en/api',
        free: true,
        note: 'Sin key para uso básico.',
      },
    ],
  },
];

function uniqueByName(apis: ApiRecommendation[]): ApiRecommendation[] {
  const seen = new Set<string>();
  return apis.filter((a) => {
    if (seen.has(a.name)) { return false; }
    seen.add(a.name);
    return true;
  });
}

export function detectApiRecommendations(
  prompt: string,
  blueprint?: ProjectBlueprint | null
): ApiRecommendation[] {
  const apis: ApiRecommendation[] = [];

  if (wantsDiscordBot(prompt) || blueprint?.kind === 'discord-bot') {
    apis.push(...DISCORD_CORE);
  }
  if (wantsRestApi(prompt) || blueprint?.kind === 'api-rest') {
    apis.push({
      name: 'Express',
      role: 'Servidor HTTP REST',
      npm: 'express cors dotenv',
      docs: 'https://expressjs.com/',
      free: true,
    });
  }
  if (wantsMinecraftPlugin(prompt) || blueprint?.kind === 'minecraft-plugin') {
    apis.push(
      {
        name: 'Paper API',
        role: 'API oficial plugins servidor Minecraft (PaperMC recomendado)',
        docs: 'https://docs.papermc.io/paper/dev/getting-started/paper-plugins/',
        free: true,
        note: 'build.gradle: paper-api. Alternativa: Spigot API.',
      },
      {
        name: 'plugin.yml',
        role: 'Manifiesto Bukkit/Spigot/Paper',
        docs: 'https://docs.papermc.io/paper/dev/plugin-yml/',
        free: true,
      },
    );
  }
  if (wantsMinecraftModFabric(prompt) || blueprint?.kind === 'minecraft-mod-fabric') {
    apis.push(
      {
        name: 'Fabric API',
        role: 'Mod loader + API cliente/servidor',
        docs: 'https://fabricmc.net/wiki/tutorial:setup',
        free: true,
        note: 'Gradle fabric-loom + fabric.mod.json',
      },
    );
  }
  if (wantsMinecraftModForge(prompt) || blueprint?.kind === 'minecraft-mod-forge') {
    apis.push(
      {
        name: 'Minecraft Forge / NeoForge',
        role: 'Mod loader Forge',
        docs: 'https://docs.minecraftforge.net/',
        free: true,
        note: 'mods.toml + @Mod class',
      },
    );
  }
  if (wantsVscodeExtension(prompt) || blueprint?.kind === 'vscode-extension') {
    apis.push(
      {
        name: 'VS Code Extension API',
        role: 'Extensión oficial VS Code',
        npm: '@types/vscode esbuild',
        docs: 'https://code.visualstudio.com/api',
        free: true,
      },
    );
  }
  if (wantsAndroidRom(prompt) || blueprint?.kind === 'android-rom') {
    apis.push(
      {
        name: 'AOSP / LineageOS build system',
        role: 'Compilar ROM desde fuentes',
        docs: 'https://wiki.lineageos.org/devices/',
        free: true,
        note: 'repo tool + breakfast/brunch. Requiere device tree + vendor blobs del dispositivo.',
      },
      {
        name: 'Android device tree',
        role: 'Configuración por dispositivo (BoardConfig.mk, device.mk)',
        docs: 'https://source.android.com/docs/setup/create/devices',
        free: true,
      },
    );
  }
  if (wantsWebPage(prompt) || blueprint?.kind === 'web-static') {
    apis.push({
      name: 'Fetch API / APIs públicas',
      role: 'Datos dinámicos en el front (fetch a REST públicas)',
      free: true,
      note: 'Para datos en vivo usa APIs gratuitas (Open-Meteo, REST Countries, etc.).',
    });
  }

  for (const { re, apis: featureApis } of FEATURE_APIS) {
    if (re.test(prompt)) {
      apis.push(...featureApis);
    }
  }

  if (/\b(bot|api|integraci[oó]n|conecta|llama|fetch|axios|request)\b/i.test(prompt) && apis.length === 0) {
    apis.push({
      name: 'axios / fetch',
      role: 'Cliente HTTP para consumir APIs REST',
      npm: 'axios',
      free: true,
      note: 'Busca APIs públicas gratuitas antes de inventar datos mock.',
    });
  }

  return uniqueByName(apis);
}

export function buildApiGuidanceBlock(
  prompt: string,
  blueprint?: ProjectBlueprint | null
): string {
  const apis = detectApiRecommendations(prompt, blueprint);
  if (!apis.length) { return ''; }

  const lines = [
    '═══ APIs Y LIBRERÍAS (USA LAS EXISTENTES — NO REINVENTES) ═══',
    'Prioridad: APIs oficiales o gratuitas documentadas. Secretos siempre en .env.',
    '',
  ];

  for (const api of apis) {
    lines.push(`• **${api.name}** — ${api.role}`);
    if (api.npm) { lines.push(`  npm: ${api.npm}`); }
    if (api.pip) { lines.push(`  pip: ${api.pip}`); }
    if (api.docs) { lines.push(`  docs: ${api.docs}`); }
    if (api.envVars?.length) { lines.push(`  .env: ${api.envVars.join(', ')}`); }
    if (api.note) { lines.push(`  nota: ${api.note}`); }
    lines.push('');
  }

  lines.push(
    'REGLAS API:',
    '- Implementa llamadas HTTP reales (fetch/axios/octokit) — no datos inventados si existe API.',
    '- Crea services/ o utils/api.js por integración (weather.js, trivia.js…).',
    '- COMANDO npm install <paquetes> antes del código si faltan.',
    '- Si +Internet trajo docs, sigue la API oficial de esa versión.',
    '- .env.example con las variables necesarias (sin valores secretos).',
  );

  return lines.join('\n') + '\n\n';
}

export function buildApiEnvExample(apis: ApiRecommendation[]): string {
  const vars = new Set<string>();
  for (const api of apis) {
    api.envVars?.forEach((v) => vars.add(v));
  }
  if (!vars.size) { return ''; }
  return [...vars].map((v) => `${v}=`).join('\n') + '\n';
}

/** Tareas donde el agente debe investigar en web aunque el usuario no diga "busca". */
export function shouldAgentResearchWeb(prompt: string, blueprint?: ProjectBlueprint | null): boolean {
  if (detectApiRecommendations(prompt, blueprint).length > 0) { return true; }
  if (blueprint && blueprint.kind !== 'generic') { return true; }
  return /\b(bot|discord|telegram|api|integra|conecta|npm|librer[ií]a|sdk|documentaci[oó]n|ejemplo|github\.com|minecraft|plugin|mod\b|rom\b|fabric|forge|spigot|papermc|lineage|aosp|extensi[oó]n\s+vscode)\b/i.test(prompt);
}