/**
 * Generación por lotes cuando Ollama responde solo con PLAN/EXPLICACION sin ACCION.
 * La extensión no se rinde: pide archivos en grupos pequeños hasta completar el proyecto.
 */

import type { FileAction } from './agent';
import {
  getFuturisticWebFileHint,
  wantsFuturisticAnimalWeb,
} from './designProfiles/futuristicWebProfile';
import { getProfessionalFileHint } from './designProfiles/professionalCapabilitiesProfile';
import { detectBlueprint, wantsRestApi, wantsWebPage, type ProjectBlueprint } from './projectBlueprints';
import { getNekotinaFileHint, getNekotinaMinExpected, NEKOTINA_FULL_FILES, NEKOTINA_FULL_SPEC } from './nekotinaFullBlueprint';
import { buildOllamaDefenseBlock } from './ollamaDefense';
import { buildUserAutonomyBlock } from './userAutonomy';

export interface BatchProjectProfile {
  stack: string[];
  hint: string;
  blueprint?: ProjectBlueprint;
}

export interface BatchGeneratorContext {
  userPrompt: string;
  rootPath: string;
  primaryEntry: string;
  profile: BatchProjectProfile;
  projectTree: string[];
  webContext?: string;
}

const BATCH_SIZE = 4;
const MAX_BATCH_ROUNDS = 24;
const MAX_ONE_FILE_ROUNDS = 40;
const ONE_FILE_MAX_ATTEMPTS = 3;

const STRICT_BATCH_SYSTEM =
  buildOllamaDefenseBlock('agent') +
  buildUserAutonomyBlock() +
  'Eres Local Agent en MODO LOTE. SOLO emites bloques ACCION — cero listas numeradas sueltas.\n' +
  'FORMATO ÚNICO por archivo:\n' +
  'ACCION: CREAR | RUTA: ruta/archivo.js | MOTIVO: breve\n<<CONTENIDO>>\n<código COMPLETO>\n<<FIN>>\n' +
  'PROHIBIDO: explicar sin ACCION, .gitkeep, TODO, "copia este código", placeholders.\n' +
  'Código REAL ejecutable. discord.js v14 usa SlashCommandBuilder de "discord.js".';

const STRICT_ONE_FILE_SYSTEM =
  buildOllamaDefenseBlock('agent') +
  buildUserAutonomyBlock() +
  'Eres un generador de archivos experto. SOLO emites UN bloque ACCION. Cero texto antes o después.\n' +
  'FORMATO OBLIGATORIO (copia la estructura):\n' +
  'ACCION: CREAR | RUTA: nombre.ext | MOTIVO: implementación\n' +
  '<<CONTENIDO>>\n' +
  '(contenido COMPLETO del archivo aquí)\n' +
  '<<FIN>>\n' +
  'PROHIBIDO: PLAN, EXPLICACION, listas numeradas, bloques ``` sueltos, placeholders, TODO.\n' +
  'package.json debe ser JSON válido. Código JS ejecutable. discord.js v14: SlashCommandBuilder de "discord.js".';

/** Usar 1 archivo por llamada Ollama (más fiable que lotes de 4 en bots grandes). */
export function shouldUseOneFileMode(
  userPrompt: string,
  profile: BatchProjectProfile,
  minExpected: number
): boolean {
  if (minExpected >= 3) { return true; }
  if (/\b(nekotina|impresionante|de todo|completo|flipante|brutal|todo gratis|implementa\s+ya)\b/i.test(userPrompt)) {
    return true;
  }
  if (wantsFullDiscordBot(userPrompt)) { return true; }
  if (wantsRestApi(userPrompt) || wantsWebPage(userPrompt)) { return true; }
  const modCount = profile.blueprint?.modulesToCreate?.length ?? 0;
  if (profile.blueprint?.kind === 'discord-bot' && modCount >= 6) { return true; }
  if (/\b(animalista|google\.com\/maps\/contrib)\b/i.test(userPrompt)) { return true; }
  return false;
}

function fileSpecificHints(filePath: string, primaryEntry: string): string {
  if (filePath === 'package.json') {
    return 'package.json válido JSON: dependencias y scripts según la petición (express o discord.js).';
  }
  if (filePath === 'server.js') {
    return 'server.js: Express, express.json(), montar routes/, GET /api/health, listen PORT.';
  }
  if (filePath.startsWith('routes/')) {
    return 'Router Express: CRUD completo en memoria (GET, POST, PUT, DELETE).';
  }
  if (filePath === primaryEntry || filePath === 'index.js') {
    return `${primaryEntry}: Client discord.js, carga dinámica commands/ y events/, login con DISCORD_TOKEN.`;
  }
  if (filePath === 'deploy-commands.js') {
    return 'deploy-commands.js: REST + Routes, registra slash commands desde commands/.';
  }
  if (filePath.startsWith('commands/')) {
    return 'Comando slash: module.exports = { data: new SlashCommandBuilder()..., async execute(interaction) {...} }.';
  }
  if (filePath.startsWith('events/')) {
    return 'Event handler: module.exports = { name, once?, async execute(client, ...args) }.';
  }
  if (filePath.startsWith('services/')) {
    return 'Service: funciones async con fetch/axios a APIs gratis (opentdb, open-meteo, jokeapi, pokeapi).';
  }
  if (filePath === 'public/css/styles.css') {
    return 'CSS completo: layout, colores, tipografía, responsive. Sin inline en HTML.';
  }
  if (filePath === 'public/js/main.js') {
    return 'JS vanilla: DOMContentLoaded, interactividad, sin frameworks. Enlazado desde index.html.';
  }
  if (filePath === 'public/js/canvas-bg.js') {
    return 'Canvas animado: requestAnimationFrame, partículas o ondas, resize listener.';
  }
  if (filePath === 'public/index.html') {
    return 'HTML5 semántico: enlaza css/styles.css y js/main.js. Contenido real, no lorem vacío.';
  }
  if (filePath === '.env.example') {
    return '.env.example: DISCORD_TOKEN=, CLIENT_ID=, GUILD_ID= (opcional).';
  }
  const futuristicHint = getFuturisticWebFileHint(filePath);
  if (futuristicHint) { return futuristicHint; }
  const proHint = getProfessionalFileHint(filePath);
  if (proHint) { return proHint; }
  if (filePath === 'scripts/validate.js') {
    return 'Script Node que valida index.js, commands/ (10+), services/, sintaxis node --check.';
  }
  return '';
}

export function buildOneFilePrompt(
  ctx: BatchGeneratorContext,
  filePath: string,
  existingPaths: Set<string>
): string {
  const apis = ctx.webContext?.includes('API') ? ctx.webContext.slice(0, 1500) : '';
  const existing = [...existingPaths].slice(0, 24).map((f) => `- ${f}`).join('\n');
  const hints = fileSpecificHints(filePath, ctx.primaryEntry) || getNekotinaFileHint(filePath);
  const nekotinaBlock = /\b(nekotina|mee6|tienda|miner[ií]a)\b/i.test(ctx.userPrompt)
    ? `\n${NEKOTINA_FULL_SPEC}\n` : '';
  return [
    '═══ MODO 1 ARCHIVO (Local Copilot — máxima fiabilidad) ═══',
    `Crea EXACTAMENTE este archivo: ${filePath}`,
    '',
    `Petición original: ${ctx.userPrompt}`,
    nekotinaBlock,
    ctx.profile.hint,
    hints ? `\nRequisitos del archivo:\n${hints}` : '',
    apis ? `\n═══ APIs gratis ═══\n${apis}` : '',
    existing ? `\nArchivos ya en el proyecto (coherencia):\n${existing}` : '',
    '',
    'Responde con UN solo bloque ACCION: CREAR usando la ruta indicada arriba.',
    'Código REAL, sin placeholders.',
  ].filter(Boolean).join('\n');
}

/** Explica por qué el agente no escribió archivos (para que Ollama/usuario entienda el fallo). */
export function diagnoseAgentFailure(raw: string, actionCount: number): string {
  if (!raw.trim()) {
    return 'Ollama devolvió respuesta vacía (timeout o error de red).';
  }
  if (actionCount > 0) {
    return `Se parsearon ${actionCount} ACCION pero insuficientes para el proyecto pedido.`;
  }
  const hasPlan = /\bPLAN\s*:/i.test(raw);
  const hasExplanation = /\bEXPLICACION\s*:/i.test(raw);
  const hasAccionKeyword = /\bACCION\s*:/i.test(raw);
  const hasMarkdownOnly = /```[\w]*\s*\n/.test(raw) && !hasAccionKeyword;
  const hasNumberedList = /^\s*\d+\.\s/m.test(raw);
  const refused = /\b(no puedo|derechos de autor|copyright|lo siento)\b/i.test(raw);

  if (refused) {
    return 'El modelo rechazó la tarea (falso positivo de copyright). Reintento con prompt estricto.';
  }
  if (hasPlan && hasExplanation && !hasAccionKeyword) {
    return 'Ollama solo escribió PLAN + EXPLICACION sin bloques ACCION — activando generación por lotes.';
  }
  if (hasAccionKeyword && actionCount === 0) {
    return 'Ollama mencionó ACCION pero el formato no era parseable (falta <<CONTENIDO>> o ruta inválida).';
  }
  if (hasMarkdownOnly) {
    return 'Ollama usó bloques ``` sin ACCION — el parser no pudo asignar archivos.';
  }
  if (hasNumberedList) {
    return 'Ollama respondió con lista numerada en lugar de ACCION — reintento por lotes.';
  }
  return 'Respuesta sin bloques ACCION reconocibles — generación por lotes automática.';
}

/** Lista de archivos a crear según blueprint + petición (Nekotina, bot completo, etc.). */
export function buildBatchFileList(ctx: BatchGeneratorContext): string[] {
  const { userPrompt, profile, primaryEntry, projectTree } = ctx;
  const hasPkg = projectTree.some((p) => p.endsWith('package.json'));
  const files = new Set<string>();

  const blueprint = profile.blueprint ?? detectBlueprint(userPrompt, profile.stack, hasPkg, true, primaryEntry);
  if (blueprint) {
    for (const m of blueprint.modulesToCreate) { files.add(m); }
    if (!hasPkg) {
      files.add('package.json');
      files.add('.env.example');
    }
    if (!projectTree.some((p) => p.endsWith('index.js'))) {
      files.add(primaryEntry);
    }
    files.add('events/ready.js');
    files.add('events/interactionCreate.js');
    files.add('deploy-commands.js');
  }

  if (/\b(nekotina|mee6|impresionante|de todo|completo|flipante|brutal|todo gratis|tienda\s+de\s+animales|miner[ií]a)\b/i.test(userPrompt) ||
      wantsFullDiscordBot(userPrompt)) {
    for (const f of NEKOTINA_FULL_FILES) {
      files.add(f === 'index.js' ? primaryEntry : f);
    }
  }

  if (wantsRestApi(userPrompt)) {
    ['package.json', 'server.js', 'routes/tareas.js', 'README.md'].forEach((f) => files.add(f));
  }

  if (wantsWebPage(userPrompt) || /\b(animalista|p[aá]gina\s+web)\b/i.test(userPrompt)) {
    const webFiles = wantsFuturisticAnimalWeb(userPrompt)
      ? ['public/index.html', 'public/css/styles.css', 'public/js/canvas-bg.js', 'public/js/main.js', 'README.md']
      : ['public/index.html', 'public/css/styles.css', 'public/js/main.js', 'README.md'];
    webFiles.forEach((f) => files.add(f));
  }

  if (files.size < 4 && /\b(discord|bot)\b/i.test(userPrompt)) {
    ['package.json', primaryEntry, 'commands/ping.js', 'events/ready.js', 'events/interactionCreate.js']
      .forEach((f) => files.add(f));
  }

  return sortBatchFileList([...files].filter((f) => !f.endsWith('.gitkeep')));
}

/** Orden de generación: dependencias primero, index.js al final. */
export function sortBatchFileList(files: string[]): string[] {
  const priority = (f: string): number => {
    if (f === 'package.json' || f === '.env.example') return 0;
    if (f.startsWith('utils/') || f.startsWith('data/')) return 1;
    if (f.startsWith('services/')) return 2;
    if (f.startsWith('admin/') || f.startsWith('musica/')) return 3;
    if (f.startsWith('commands/')) return 4;
    if (f.startsWith('events/')) return 5;
    if (f === 'deploy-commands.js' || f.startsWith('scripts/')) return 6;
    if (f === 'index.js') return 8;
    if (f.endsWith('.html') || f.endsWith('.css')) return 2;
    if (f.endsWith('.js') && f.startsWith('public/')) return 3;
    if (f === 'README.md') return 9;
    return 7;
  };
  return [...files].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
}

function wantsFullDiscordBot(prompt: string): boolean {
  return /\b(bot\s+(?:de\s+)?discord|discord\s+bot)\b/i.test(prompt) &&
    (/\b(música|musica|trivia|econom[ií]a|moderaci[oó]n|clima|memes?|niveles?|radio|juegos?)\b/i.test(prompt) ||
     (prompt.match(/\b(y|con|\+|incluye)\b/gi) ?? []).length >= 3);
}

export function chunkFiles(files: string[], size = BATCH_SIZE): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < files.length; i += size) {
    batches.push(files.slice(i, i + size));
  }
  return batches;
}

export function getMinExpectedFiles(userPrompt: string, profile: BatchProjectProfile): number {
  if (/\b(nekotina|mee6|tienda|miner[ií]a|impresionante|de todo|completo|flipante)\b/i.test(userPrompt)) {
    return getNekotinaMinExpected();
  }
  if (profile.blueprint?.kind === 'discord-bot') { return 10; }
  if (/\b(bot\s+discord|discord\s+bot)\b/i.test(userPrompt)) { return 6; }
  if (/\b(animalista|p[aá]gina\s+web)\b/i.test(userPrompt)) { return 3; }
  if (/\b(web|p[aá]gina|sitio)\b/i.test(userPrompt)) { return 3; }
  return 1;
}

export function buildBatchUserMessage(
  ctx: BatchGeneratorContext,
  batchFiles: string[],
  existingPaths: Set<string>
): string {
  const missing = batchFiles.filter((f) => !existingPaths.has(f));
  const apis = ctx.webContext?.includes('API') ? ctx.webContext.slice(0, 2000) : '';
  return [
    '═══ MODO LOTE (extensión Local Copilot) ═══',
    `Petición original: ${ctx.userPrompt}`,
    '',
    ctx.profile.hint,
    '',
    apis ? `═══ APIs gratis ═══\n${apis}\n` : '',
    `Crea EXACTAMENTE estos ${missing.length} archivo(s) con código REAL:`,
    missing.map((f) => `- ${f}`).join('\n'),
    '',
    'Un bloque ACCION: CREAR por archivo. discord.js v14, APIs gratis (opentdb, open-meteo, jokeapi, pokeapi).',
    'index.js solo carga commands/ y events/ — la lógica va en cada módulo.',
  ].join('\n');
}

export function mergeBatchActions(
  accumulated: FileAction[],
  newActions: FileAction[],
  parseFilePath: (p: string) => string
): FileAction[] {
  const byPath = new Map<string, FileAction>();
  for (const a of accumulated) {
    byPath.set(parseFilePath(a.filePath), a);
  }
  for (const a of newActions) {
    const key = parseFilePath(a.filePath);
    if (key && a.content.length >= 10) {
      byPath.set(key, { ...a, filePath: key });
    }
  }
  return [...byPath.values()];
}

export {
  BATCH_SIZE,
  MAX_BATCH_ROUNDS,
  MAX_ONE_FILE_ROUNDS,
  ONE_FILE_MAX_ATTEMPTS,
  STRICT_BATCH_SYSTEM,
  STRICT_ONE_FILE_SYSTEM,
};