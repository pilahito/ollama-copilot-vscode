/**
 * Investiga proyectos similares con +Internet, guarda patrones y reutiliza sin conexión.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProjectBlueprint, ProjectKind } from './projectBlueprints';
import { wantsWorkingImplementation } from './codeQuality';

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
}

export interface ReferenceResolveResult {
  context: string;
  source: 'internet' | 'cache' | 'builtin' | 'combined';
  saved: boolean;
  hitCount: number;
  patternCount: number;
  summary: string;
}

interface LearnedEntry {
  kind:       ProjectKind | 'generic';
  keywords:   string[];
  features:   string[];
  updatedAt:  string;
  sources:    WebHit[];
  patterns:   string[];
}

interface LearnedStore {
  version: number;
  entries: LearnedEntry[];
}

const CACHE_DIR  = path.join(os.homedir(), '.local-copilot');
const CACHE_FILE = path.join(CACHE_DIR, 'learned-references.json');
const MAX_ENTRIES = 50;
const STORE_VERSION = 2;

const FEATURE_ALIASES: Record<string, string[]> = {
  music:    ['musica', 'música', 'music', 'spotify', 'playlist', 'play', 'cancion', 'canción', 'audio', 'voice'],
  trivia:   ['trivia', 'quiz', 'preguntas', 'opentdb'],
  weather:  ['clima', 'weather', 'tiempo', 'meteo'],
  economy:  ['economia', 'economía', 'economy', 'coins', 'monedas', 'shop', 'tienda'],
  radio:    ['radio', 'emisora', 'fm', 'streaming'],
  games:    ['juegos', 'games', 'minijuegos', 'snake', 'pong'],
  telegram: ['telegram', 'telegraf'],
  moderation: ['moderacion', 'moderación', 'moderation', 'ban', 'kick', 'warn'],
};

/** Patrones de referencia offline (cuando no hay caché ni internet). */
const BUILTIN_PATTERNS: Partial<Record<ProjectKind | 'generic', string[]>> = {
  'discord-bot': [
    'Estructura típica open-source: commands/ (slash), events/ (ready, interactionCreate), utils/, index.js solo Client+login',
    'discord.js v14: REST.put(Routes.applicationCommands) o deploy-commands.js',
    'Música: @discordjs/voice + play-dl; comandos en commands/play.js delegan a musica/player.js',
    'Trivia: fetch a opentdb.com en services/triviaApi.js; comando en commands/trivia.js',
    'Economía: Map o SQLite en data/economy.js; comandos daily/balance/shop en commands/',
    'Clima: Open-Meteo sin API key en services/weatherApi.js',
    'Moderación: events/ + commands/ban.js con permisos GuildModeration',
  ],
  'minecraft-server': [
    'world/ — mundo generado (en .gitignore, no versionar)',
    'plugins/ — archivos .jar de Paper/Spigot/Bukkit',
    'config/ — YAML de plugins (LuckPerms, Essentials, etc.)',
    'logs/ — registros del servidor',
    'server.properties + eula.txt + start.sh en la raíz',
  ],
  'minecraft-plugin': [
    'Paper: build.gradle paper-api, JavaPlugin onEnable, plugin.yml con commands',
    'Un CommandExecutor por comando en commands/ o package commands',
    'jar en plugins/ tras ./gradlew build',
    'Economía: YAML o SQLite vía Vault API si aplica',
  ],
  'minecraft-mod-fabric': [
    'fabric.mod.json + ModInitializer; registra items/blocks en onInitialize',
    'Gradle fabric-loom; carpetas por feature',
  ],
  'minecraft-mod-forge': [
    'mods.toml + @Mod; DeferredRegister para items/blocks',
  ],
  'vscode-extension': [
    'package.json contributes.commands + activationEvents',
    'src/extension.ts: activate() con registerCommand y context.subscriptions',
  ],
  'android-rom': [
    'device/<codename>/ con BoardConfig.mk, device.mk, lineage_<device>.mk',
    'scripts/setup-aosp.sh + build-rom.sh; repo sync para AOSP/Lineage',
    'kernel/ separado; vendor/ para blobs propietarios',
  ],
  'api-rest': [
    'routes/ + controllers/; index.js solo app.listen y app.use(routes)',
    'middleware/ para auth; services/ para lógica de negocio',
  ],
  'web-static': [
    'public/index.html + css/ + js/; fetch a APIs públicas en main.js',
  ],
  'web-game': [
    'canvas o div grid; game loop en js/game.js; input en js/controls.js',
    'assets/ para sprites; score/state en js/state.js',
  ],
  generic: [
    'Modular: una carpeta por feature; entry point solo cablea',
    'APIs oficiales documentadas; secretos en .env',
  ],
};

const FEATURE_BUILTIN: Record<string, string> = {
  music:      'Feature música: carpeta musica/ o music/ con player.js; comando /play en commands/',
  trivia:     'Feature trivia: services/triviaApi.js (Open Trivia DB); commands/trivia.js',
  weather:    'Feature clima: services/weatherApi.js (Open-Meteo); commands/clima.js',
  economy:    'Feature economía: data/economy.js + commands/balance.js, daily.js, shop.js',
  radio:      'Feature radio: radio/stream.js + commands/radio.js',
  games:      'Feature juegos: juegos/ con un .js por minijuego; commands/juegos.js',
  telegram:   'Bot Telegram: telegraf + handlers/ por comando; index.js solo launch',
  moderation: 'Moderación: events/ + commands con check de permisos antes de ban/kick',
};

export function shouldLearnFromReferences(
  prompt: string,
  blueprint?: ProjectBlueprint | null
): boolean {
  if (blueprint && blueprint.kind !== 'generic') { return true; }
  return wantsWorkingImplementation(prompt) &&
    /\b(bot|plugin|mod\b|extensi[oó]n|api|discord|minecraft|telegram|crea|crear|hazme)\b/i.test(prompt);
}

export function extractKeywords(prompt: string): string[] {
  const words = prompt.toLowerCase()
    .replace(/[^\w\sáéíóúñ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const stop = new Set(['crea', 'crear', 'hazme', 'para', 'como', 'este', 'esta', 'quiero', 'necesito', 'bot', 'con', 'completo', 'funcional']);
  return [...new Set(words.filter((w) => !stop.has(w)))].slice(0, 10);
}

/** Features detectadas (música, trivia, economía…) para matching de caché. */
export function extractFeatureKeywords(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const found: string[] = [];
  for (const [feature, aliases] of Object.entries(FEATURE_ALIASES)) {
    if (aliases.some((a) => lower.includes(a))) {
      found.push(feature);
    }
  }
  return found;
}

/** Ordena hits poniendo GitHub repos antes que blogs/docs genéricos. */
export function prioritizeGitHubHits(hits: WebHit[]): WebHit[] {
  const score = (h: WebHit): number => {
    let s = 0;
    const url = h.url.toLowerCase();
    if (url.includes('github.com/') && !url.includes('gist.github')) { s += 100; }
    if (url.includes('gitlab.com/')) { s += 60; }
    if (/\brepo(sitory)?\b/i.test(h.title)) { s += 20; }
    if (/\bexample\b|\btemplate\b|\bstarter\b/i.test(h.title + h.snippet)) { s += 15; }
    if (url.includes('stackoverflow.com')) { s += 5; }
    if (url.includes('medium.com') || url.includes('dev.to')) { s += 3; }
    return s;
  };
  return [...hits].sort((a, b) => score(b) - score(a));
}

function parseGitHubRepoHint(url: string): string | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m || m[2] === 'topics' || m[2] === 'search') { return null; }
  const repo = m[2].replace(/\.git$/, '');
  return `Repo GitHub ${m[1]}/${repo} — revisa su árbol de carpetas (commands/, events/, src/)`;
}

export function buildSimilarProjectQueries(
  prompt: string,
  blueprint?: ProjectBlueprint | null
): string[] {
  const queries = new Set<string>();
  const kind = blueprint?.kind ?? 'generic';
  const features = extractFeatureKeywords(prompt);

  const gh = (topic: string) => {
    queries.add(`site:github.com ${topic}`);
    queries.add(`site:github.com ${topic} stars:>50`);
    queries.add(`${topic} github repository structure`);
  };

  switch (kind) {
    case 'discord-bot':
      gh('discord.js bot slash commands modular');
      gh('discord bot typescript commands events');
      queries.add('discord.js v14 bot template github README structure');
      if (features.includes('music')) {
        gh('discord.js music bot voice play-dl');
      }
      if (features.includes('trivia')) {
        gh('discord bot trivia opentdb');
      }
      if (features.includes('economy')) {
        gh('discord bot economy coins shop');
      }
      break;
    case 'minecraft-server':
      queries.add('minecraft paper server folder structure world plugins config');
      queries.add('site:github.com minecraft server setup paper spigot');
      break;
    case 'minecraft-plugin':
      gh('papermc spigot plugin java gradle');
      queries.add('site:github.com PaperMC example plugin CommandExecutor');
      break;
    case 'minecraft-mod-fabric':
      gh('fabricmc mod template gradle');
      queries.add('site:github.com FabricMC fabric-example-mod');
      break;
    case 'minecraft-mod-forge':
      gh('minecraft forge mod gradle mods.toml');
      break;
    case 'vscode-extension':
      gh('vscode extension typescript hello world');
      queries.add('site:github.com microsoft/vscode-extension-samples');
      break;
    case 'android-rom':
      queries.add('site:github.com LineageOS android_device');
      queries.add('LineageOS device tree BoardConfig.mk example github');
      break;
    case 'api-rest':
      gh('express rest api node structure');
      break;
    case 'web-static':
    case 'web-game':
      gh('vanilla javascript web app structure');
      break;
    default:
      if (/\bbot\b/i.test(prompt)) { gh('discord bot javascript modular'); }
      if (/\btelegram\b/i.test(prompt)) { gh('telegraf bot typescript'); }
      if (/\bplugin\b/i.test(prompt)) { gh('minecraft plugin open source'); }
      if (/\bmod\b/i.test(prompt)) { gh('game mod open source'); }
      break;
  }

  for (const feat of features.slice(0, 4)) {
    queries.add(`site:github.com discord bot ${feat} implementation`);
    queries.add(`${feat} bot open source github example`);
  }

  const trimmed = prompt.replace(/\s+/g, ' ').trim().slice(0, 70);
  queries.add(`site:github.com ${trimmed}`);
  queries.add(`${trimmed} similar open source project structure`);
  return [...queries].slice(0, 8);
}

function mergePatterns(
  ...groups: (string[] | undefined)[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    if (!group) { continue; }
    for (const p of group) {
      const key = p.toLowerCase();
      if (seen.has(key)) { continue; }
      seen.add(key);
      out.push(p);
    }
  }
  return out.slice(0, 16);
}

function patternsForFeatures(features: string[]): string[] {
  return features
    .map((f) => FEATURE_BUILTIN[f])
    .filter((p): p is string => Boolean(p));
}

function extractPatternsFromHits(hits: WebHit[], kind: ProjectKind | 'generic', features: string[]): string[] {
  const base = BUILTIN_PATTERNS[kind] ?? BUILTIN_PATTERNS.generic ?? [];
  const patterns = new Set<string>(mergePatterns(base, patternsForFeatures(features)));
  const blob = hits.map((h) => `${h.title} ${h.snippet}`).join(' ').toLowerCase();

  const rules: [RegExp, string][] = [
    [/\bcommands?\//, 'Usar carpeta commands/ para comandos'],
    [/\bevents?\//, 'Usar carpeta events/ para listeners'],
    [/\bhandlers?\//, 'Usar carpeta handlers/ para lógica por comando'],
    [/\bservices?\//, 'Usar carpeta services/ para APIs externas'],
    [/\butils?\//, 'Usar carpeta utils/ para helpers reutilizables'],
    [/\bslash\s+command/i, 'Registrar slash commands (discord.js v14)'],
    [/\binteractioncreate/i, 'Handler interactionCreate para slash'],
    [/\bjava\s*plugin/i, 'Clase extends JavaPlugin + plugin.yml'],
    [/\bfabric\.mod\.json/i, 'Manifiesto fabric.mod.json'],
    [/\bmods\.toml/i, 'Manifiesto mods.toml (Forge)'],
    [/\bmodinitializer/i, 'Fabric ModInitializer'],
    [/\bregistercommand/i, 'VS Code registerCommand en activate()'],
    [/\bexpress\.Router/i, 'Express Router en routes/'],
    [/\bopentdb|trivia\s+db/i, 'API Open Trivia DB para preguntas'],
    [/\bopen-meteo|weather\s+api/i, 'API Open-Meteo para clima'],
    [/\bvoice|@discordjs\/voice/i, 'Audio con @discordjs/voice'],
    [/\bplay-dl|ytdl|ytdl-core/i, 'Reproducción con play-dl o ytdl-core'],
    [/\btelegraf/i, 'Bot Telegram con Telegraf y handlers modulares'],
    [/\bmodular|folder\s+structure|project\s+structure/i, 'Arquitectura modular por carpetas'],
    [/\bdeploy-commands/i, 'Script deploy-commands.js para registrar slash'],
    [/\bsqlite|prisma|mongoose/i, 'Persistencia con SQLite/ORM si hay economía o usuarios'],
  ];

  for (const [re, label] of rules) {
    if (re.test(blob)) { patterns.add(label); }
  }

  const ghPatterns: string[] = [];
  const ranked = prioritizeGitHubHits(hits);
  for (const hit of ranked.slice(0, 5)) {
    const ghHint = parseGitHubRepoHint(hit.url);
    if (ghHint) { ghPatterns.push(ghHint); }
    else if (hit.url.includes('github.com') && !hit.url.includes('gist')) {
      ghPatterns.push(`Referencia GitHub: ${hit.title} — ${hit.url}`);
    }
  }
  for (const p of ghPatterns) { patterns.add(p); }

  const all = [...patterns];
  const ghSet = new Set(ghPatterns);
  const rest = all.filter((p) => !ghSet.has(p));
  return [...ghPatterns, ...rest].slice(0, 14);
}

function formatContext(
  hits: WebHit[],
  patterns: string[],
  source: 'internet' | 'cache' | 'builtin' | 'combined'
): string {
  const header = source === 'internet'
    ? '📎 REFERENCIAS — proyectos similares investigados (IMITA buenas prácticas, no copies licencias):'
    : source === 'cache'
      ? '📖 REFERENCIAS APRENDIDAS (sin internet — de búsquedas anteriores):'
      : source === 'combined'
        ? '📖 REFERENCIAS COMBINADAS (caché + plantilla local — sin internet):'
        : '📖 PLANTILLA DE REFERENCIA LOCAL (sin internet ni caché previa):';

  let ctx = `\n\n${header}\n`;

  if (patterns.length) {
    ctx += '\nPatrones a aplicar:\n';
    for (const p of patterns) {
      ctx += `• ${p}\n`;
    }
  }

  if (hits.length) {
    ctx += '\nFuentes:\n';
    for (const hit of prioritizeGitHubHits(hits).slice(0, 6)) {
      ctx += `• ${hit.title} (${hit.url})\n  ${hit.snippet.slice(0, 200)}\n`;
    }
  }

  ctx +=
    '\nINSTRUCCIÓN: Crea el proyecto del usuario con la MISMA calidad estructural que estos ejemplos. ' +
    'Adapta a su petición — no clones un repo entero.\n';

  return ctx;
}

function buildSummary(
  source: ReferenceResolveResult['source'],
  hitCount: number,
  patternCount: number,
  features: string[],
  saved: boolean
): string {
  const feat = features.length ? ` (${features.join(', ')})` : '';
  switch (source) {
    case 'internet':
      return saved
        ? `💾 ${hitCount} referencia(s) GitHub/docs${feat} — ${patternCount} patrones guardados para modo sin internet`
        : `📚 ${hitCount} referencia(s) de proyectos similares${feat}`;
    case 'cache':
      return `📖 Sin internet: ${patternCount} patrones aprendidos${feat} de búsquedas anteriores`;
    case 'combined':
      return `📖 Sin internet: caché + plantilla local — ${patternCount} patrones${feat}`;
    case 'builtin':
      return `📖 Sin internet: plantilla local — ${patternCount} patrones de referencia${feat}`;
    default:
      return '';
  }
}

export class ReferenceLearner {
  private store: LearnedStore | null = null;

  private loadStore(): LearnedStore {
    if (this.store) { return this.store; }
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw) as LearnedStore;
        for (const entry of parsed.entries) {
          if (!entry.features) { entry.features = []; }
        }
        parsed.version = STORE_VERSION;
        this.store = parsed;
        return this.store;
      }
    } catch { /* nueva caché */ }
    this.store = { version: STORE_VERSION, entries: [] };
    return this.store;
  }

  private saveStore(store: LearnedStore): void {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      while (store.entries.length > MAX_ENTRIES) {
        store.entries.shift();
      }
      store.version = STORE_VERSION;
      fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2), 'utf8');
      this.store = store;
    } catch { /* sin permisos */ }
  }

  private scoreEntry(entry: LearnedEntry, keywords: string[], features: string[]): number {
    let score = 1;
    for (const kw of keywords) {
      if (entry.keywords.some((k) => k.includes(kw) || kw.includes(k))) { score += 2; }
    }
    for (const feat of features) {
      if (entry.features.includes(feat)) { score += 5; }
      if (entry.keywords.includes(feat)) { score += 3; }
      if (entry.patterns.some((p) => p.toLowerCase().includes(feat))) { score += 2; }
    }
    const ageDays = (Date.now() - new Date(entry.updatedAt).getTime()) / 86_400_000;
    if (ageDays < 7) { score += 2; }
    else if (ageDays < 30) { score += 1; }
    return score;
  }

  private matchEntry(
    prompt: string,
    blueprint?: ProjectBlueprint | null
  ): { entry: LearnedEntry; score: number } | null {
    const store = this.loadStore();
    const kind = blueprint?.kind ?? 'generic';
    const keywords = extractKeywords(prompt);
    const features = extractFeatureKeywords(prompt);

    const candidates = store.entries.filter((e) => e.kind === kind || e.kind === 'generic');
    if (!candidates.length) { return null; }

    let best: LearnedEntry | null = null;
    let bestScore = 0;

    for (const entry of candidates) {
      const score = this.scoreEntry(entry, keywords, features);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    if (!best || bestScore < 2) { return null; }
    return { entry: best, score: bestScore };
  }

  private upsertEntry(
    kind: ProjectKind | 'generic',
    keywords: string[],
    features: string[],
    hits: WebHit[],
    patterns: string[]
  ): void {
    const store = this.loadStore();
    const key = `${kind}|${[...keywords, ...features].sort().join(',')}`;
    const idx = store.entries.findIndex(
      (e) => `${e.kind}|${[...e.keywords, ...e.features].sort().join(',')}` === key
        || (e.kind === kind && e.features.join() === features.join() && features.length > 0)
    );
    const entry: LearnedEntry = {
      kind,
      keywords,
      features,
      updatedAt: new Date().toISOString(),
      sources: prioritizeGitHubHits(hits).slice(0, 10),
      patterns,
    };
    if (idx >= 0) {
      store.entries[idx] = entry;
    } else {
      store.entries.push(entry);
    }
    this.saveStore(store);
  }

  private getBuiltinPatterns(blueprint?: ProjectBlueprint | null, features: string[] = []): string[] {
    const kind = blueprint?.kind ?? 'generic';
    const base = BUILTIN_PATTERNS[kind] ?? BUILTIN_PATTERNS.generic ?? [];
    const feat = patternsForFeatures(features);
    const hint = blueprint?.hint ? [blueprint.hint.slice(0, 300)] : [];
    return mergePatterns(base, feat, hint);
  }

  /** +Internet: busca proyectos similares y guarda patrones. */
  async researchSimilar(
    prompt: string,
    blueprint: ProjectBlueprint | null | undefined,
    searchMulti: (queries: string[]) => Promise<WebHit[]>
  ): Promise<ReferenceResolveResult> {
    const queries = buildSimilarProjectQueries(prompt, blueprint);
    const rawHits = await searchMulti(queries);
    const hits = prioritizeGitHubHits(rawHits);
    const kind = blueprint?.kind ?? 'generic';
    const keywords = extractKeywords(prompt);
    const features = extractFeatureKeywords(prompt);

    if (hits.length === 0) {
      return { context: '', saved: false, hitCount: 0, patternCount: 0, source: 'internet', summary: '' };
    }

    const patterns = extractPatternsFromHits(hits, kind, features);
    this.upsertEntry(kind, keywords, features, hits, patterns);

    return {
      context: formatContext(hits, patterns, 'internet'),
      saved: true,
      hitCount: hits.length,
      patternCount: patterns.length,
      source: 'internet',
      summary: buildSummary('internet', hits.length, patterns.length, features, true),
    };
  }

  /** Sin internet: carga patrones aprendidos antes. */
  loadCached(prompt: string, blueprint?: ProjectBlueprint | null): ReferenceResolveResult | null {
    const match = this.matchEntry(prompt, blueprint);
    if (!match) { return null; }
    const features = extractFeatureKeywords(prompt);
    const patterns = match.entry.patterns;
    return {
      context: formatContext(match.entry.sources, patterns, 'cache'),
      saved: false,
      hitCount: match.entry.sources.length,
      patternCount: patterns.length,
      source: 'cache',
      summary: buildSummary('cache', match.entry.sources.length, patterns.length, features, false),
    };
  }

  /** Sin internet y sin caché: plantilla local por tipo. */
  getBuiltin(blueprint?: ProjectBlueprint | null, prompt = ''): ReferenceResolveResult | null {
    const features = extractFeatureKeywords(prompt);
    const patterns = this.getBuiltinPatterns(blueprint, features);
    if (!patterns.length) { return null; }
    return {
      context: formatContext([], patterns, 'builtin'),
      saved: false,
      hitCount: 0,
      patternCount: patterns.length,
      source: 'builtin',
      summary: buildSummary('builtin', 0, patterns.length, features, false),
    };
  }

  /** Offline: combina caché (si hay) + builtin + blueprint. */
  resolveOffline(
    prompt: string,
    blueprint?: ProjectBlueprint | null
  ): ReferenceResolveResult | null {
    const features = extractFeatureKeywords(prompt);
    const cached = this.matchEntry(prompt, blueprint);
    const builtin = this.getBuiltinPatterns(blueprint, features);

    if (cached) {
      const patterns = mergePatterns(cached.entry.patterns, builtin);
      const hits = cached.entry.sources;
      const source: ReferenceResolveResult['source'] = builtin.length ? 'combined' : 'cache';
      return {
        context: formatContext(hits, patterns, source),
        saved: false,
        hitCount: hits.length,
        patternCount: patterns.length,
        source,
        summary: buildSummary(source, hits.length, patterns.length, features, false),
      };
    }

    if (builtin.length) {
      return {
        context: formatContext([], builtin, 'builtin'),
        saved: false,
        hitCount: 0,
        patternCount: builtin.length,
        source: 'builtin',
        summary: buildSummary('builtin', 0, builtin.length, features, false),
      };
    }

    return null;
  }

  /**
   * Punto de entrada unificado: online investiga y guarda; offline combina caché + plantilla.
   */
  async resolveReferences(
    prompt: string,
    blueprint: ProjectBlueprint | null | undefined,
    options: {
      internetEnabled: boolean;
      searchMulti?: (queries: string[]) => Promise<WebHit[]>;
    }
  ): Promise<ReferenceResolveResult | null> {
    if (!shouldLearnFromReferences(prompt, blueprint)) { return null; }

    if (options.internetEnabled && options.searchMulti) {
      const result = await this.researchSimilar(prompt, blueprint, options.searchMulti);
      return result.context ? result : null;
    }

    return this.resolveOffline(prompt, blueprint);
  }
}

/** Helper para Chat/Profesor: adjunta contexto de referencias al mensaje del usuario. */
export async function gatherReferenceContext(
  prompt: string,
  blueprint: ProjectBlueprint | null | undefined,
  options: {
    internetEnabled: boolean;
    searchMulti?: (queries: string[]) => Promise<WebHit[]>;
  }
): Promise<ReferenceResolveResult | null> {
  const learner = new ReferenceLearner();
  return learner.resolveReferences(prompt, blueprint, options);
}