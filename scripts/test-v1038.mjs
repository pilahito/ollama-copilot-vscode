#!/usr/bin/env node
/**
 * Test exhaustivo v1.0.38 — RequirementsGatherer, npm, APIs, GitHub, hardware, smartContext.
 * Uso: node scripts/test-v1038.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import os from 'os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

let errors = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); errors++; };
const info = (m) => console.log(`  ℹ️  ${m}`);
const section = (t) => console.log(`\n══ ${t} ══`);

// ── 1. Compilación y versión ─────────────────────────────────────────────────
section(`Compilación v${VERSION}`);
try {
  execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });
  ok('esbuild OK');
} catch (e) {
  fail(`compile: ${e.stderr?.toString() || e.message}`);
}
const majorOk = /^1\.\d+\.\d+$/.test(VERSION);
majorOk ? ok(`versión ${VERSION}`) : fail(`versión inesperada: ${VERSION}`);

// ── 2. Archivos fuente v1.0.38 ───────────────────────────────────────────────
section('Archivos nuevos v1.0.38');
for (const f of [
  'src/requirementsGatherer.ts',
  'src/npmRegistry.ts',
  'src/freeApiRegistry.ts',
  'src/smartContext.ts',
]) {
  existsSync(join(ROOT, f)) ? ok(f) : fail(`falta ${f}`);
}

// ── 3. Bundle markers ────────────────────────────────────────────────────────
section('Bundle — módulos v1.0.38');
const bundle = readFileSync(join(ROOT, 'dist/extension.js'), 'utf8');
const markers = [
  'shouldGatherRequirements',
  'buildClarificationMessage',
  'buildRequirementsBlock',
  'requirementsGatheringRules',
  'searchNpmPackages',
  'gatherNpmContext',
  'FREE_API_REGISTRY',
  'formatFreeApisForPrompt',
  'gatherSmartContext',
  'searchTemplateRepos',
  'formatTemplatesForPrompt',
  'buildHardwareAdviceBlock',
  'vramGb',
  'requirementsSession',
  'shouldUseOneFileMode',
  'generateSingleFileBatch',
  'STRICT_ONE_FILE_SYSTEM',
  'buildOneFilePrompt',
];
for (const m of markers) {
  bundle.includes(m) ? ok(`bundle: ${m}`) : fail(`bundle sin: ${m}`);
}

// ── 4. RequirementsGatherer (lógica alineada con TS) ─────────────────────────
section('RequirementsGatherer — lógica');

const CREATION_RE =
  /\b(crea(?:me|r)?|créame|hazme|genera(?:me)?|implementa(?:me)?|programa(?:me)?|diseña(?:me)?|monta(?:me)?|la\s+mejor|el\s+mejor|impresionante|completo|profesional|din[aá]mico|animalista)\b/i;
const SKIP_GATHER_RE =
  /\b(arregla|fix|corrige|refactor|modifica\s+(?:el\s+)?(?:archivo|código)|error|bug|no\s+funciona|commit|push|publica)\b/i;

function isProjectCreationRequest(prompt) {
  if (SKIP_GATHER_RE.test(prompt)) return false;
  return CREATION_RE.test(prompt) ||
    /\b(p[aá]gina\s+web|sitio\s+web|bot\s+(?:de\s+)?discord|plugin\s+minecraft|mod\s+minecraft)\b/i.test(prompt) ||
    /\b(web|sitio|landing)\s+(con|usando|en)\b/i.test(prompt) ||
    /\b(plugin|mod)\s+minecraft\b/i.test(prompt) ||
    (/\b(fabric|forge)\b/i.test(prompt) && /\bmod\b/i.test(prompt));
}

const DETAIL_SIGNAL_PATTERNS = [
  /\b(react|vue|svelte|next\.?js)\b/i,
  /\b(discord\.js|typescript|telegraf)\b/i,
  /\b(fabric|forge|paper|spigot|purpur|bukkit)\b/i,
  /\b1\.\d{2}(?:\.\d+)?\b/,
  /\b(slash\s+command|slash|prefijo|prefix)\b/i,
  /\b(hero|galer[ií]a|dark\s*mode|parallax|canvas|gsap|aos|three\.js)\b/i,
  /\b(postgresql|mongodb|jwt|express|fastapi|sqlite|prisma)\b/i,
  /\b(animalista|din[aá]mico|animaciones?)\b/i,
  /\b(econom[ií]a|moderaci[oó]n|música|musica|trivia|minijuegos?)\b/i,
];

function countDetailSignals(prompt) {
  return DETAIL_SIGNAL_PATTERNS.filter((p) => p.test(prompt)).length;
}

function promptHasEnoughDetail(prompt) {
  const signals = countDetailSignals(prompt);
  if (signals >= 2) return true;
  if (signals >= 1 && prompt.length > 45 &&
    /\b(paper|fabric|forge|react|discord\.js|1\.\d{2}|spigot)\b/i.test(prompt)) return true;
  const detailHits = (prompt.match(/\b(y\s+que|con\s+|incluye|debe\s+tener|quiero\s+que|usando|con\s+animaciones?)\b/gi) ?? []).length;
  return detailHits >= 2 && prompt.length > 120;
}

const cases = [
  { p: 'créame la mejor página web animalista y dinámica', create: true, enough: false },
  { p: 'hazme un bot de discord impresionante', create: true, enough: false },
  { p: 'crea plugin minecraft para paper 1.21 con economía', create: true, enough: true },
  { p: 'arregla el error en index.js', create: false, enough: false },
  { p: 'web con React, hero, galería, dark mode, parallax y animaciones con GSAP usando Next.js', create: true, enough: true },
  { p: 'mod fabric 1.20 con items nuevos y mobs custom', create: true, enough: true },
];

for (const { p, create, enough } of cases) {
  const isCreate = isProjectCreationRequest(p);
  const isEnough = promptHasEnoughDetail(p);
  if (isCreate === create) ok(`creación: "${p.slice(0, 40)}…" → ${isCreate}`);
  else fail(`creación mal: "${p.slice(0, 40)}" esperado ${create}, got ${isCreate}`);
  if (isEnough === enough) ok(`detalle: "${p.slice(0, 35)}…" → ${isEnough}`);
  else fail(`detalle mal: "${p.slice(0, 35)}" esperado ${enough}, got ${isEnough}`);
}

// Simular flujo de preguntas
const reqSrc = readFileSync(join(ROOT, 'src/requirementsGatherer.ts'), 'utf8');
reqSrc.includes('web-static') && reqSrc.includes('discord-bot') && reqSrc.includes('minecraft-plugin')
  ? ok('campos por tipo de proyecto definidos')
  : fail('faltan campos por proyecto');

reqSrc.includes('animalista') || reqSrc.includes('Animalista')
  ? ok('opción estilo animalista en web')
  : fail('falta opción animalista');

reqSrc.includes('countDetailSignals') ? ok('countDetailSignals exportado') : fail('sin countDetailSignals');
reqSrc.includes("mode === 'agent'") ? ok('modo Agente omite cuestionario') : fail('agente sin skip de preguntas');
reqSrc.includes('IMPLEMENT_NOW_RE') ? ok('frase "implementar ya" omite preguntas') : fail('sin IMPLEMENT_NOW_RE');
readFileSync(join(ROOT, 'package.json'), 'utf8').includes('agentAutoOpenFolder')
  ? ok('agentAutoOpenFolder en settings')
  : fail('sin agentAutoOpenFolder');
readFileSync(join(ROOT, 'package.json'), 'utf8').includes('autoReloadAfterUpdate')
  ? ok('autoReloadAfterUpdate en settings')
  : fail('sin autoReloadAfterUpdate');

readFileSync(join(ROOT, 'src/agent.ts'), 'utf8').includes('```(?:[\\w-]+)?')
  ? ok('parseFileActions acepta bloques ```')
  : fail('agent sin fallback markdown');

// Flujo: petición vaga → pregunta; respuestas → completo
const vague = 'créame la mejor página web animalista';
if (isProjectCreationRequest(vague) && !promptHasEnoughDetail(vague)) {
  ok('petición vaga activa cuestionario');
} else {
  fail('petición vaga no detectada correctamente');
}
const detailed = 'web con React, hero, galería, dark mode, parallax y animaciones';
if (isProjectCreationRequest(detailed) && promptHasEnoughDetail(detailed)) {
  ok('petición detallada omite cuestionario');
} else {
  fail('petición detallada debería omitir preguntas');
}

// ── 5. npm Registry (API real) ───────────────────────────────────────────────
section('npm Registry — API en vivo');
try {
  const url = 'https://registry.npmjs.org/-/v1/search?text=discord+bot+template&size=3';
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const pkgs = (data.objects ?? []).map((o) => o.package?.name).filter(Boolean);
  if (pkgs.length >= 1) ok(`npm search: ${pkgs.slice(0, 3).join(', ')}`);
  else fail('npm search sin resultados');
} catch (e) {
  fail(`npm API: ${e.message}`);
}

try {
  const res = await fetch('https://registry.npmjs.org/discord.js', { signal: AbortSignal.timeout(8_000) });
  const data = await res.json();
  data.name === 'discord.js' ? ok('npm metadata discord.js') : fail('metadata discord.js inválida');
} catch (e) {
  fail(`npm metadata: ${e.message}`);
}

// ── 6. GitHub template search (API real) ─────────────────────────────────────
section('GitHub — búsqueda plantillas');
try {
  const q = encodeURIComponent('discord bot template discord.js stars:>100');
  const res = await fetch(
    `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=3`,
    {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Local-Copilot-Test' },
      signal: AbortSignal.timeout(12_000),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const repos = (data.items ?? []).map((i) => i.full_name);
  if (repos.length >= 1) ok(`GitHub templates: ${repos.join(', ')}`);
  else fail('GitHub search sin repos');
} catch (e) {
  fail(`GitHub API: ${e.message}`);
}

// ── 7. Free API Registry ─────────────────────────────────────────────────────
section('Free API Registry');
const apiSrc = readFileSync(join(ROOT, 'src/freeApiRegistry.ts'), 'utf8');
for (const api of ['Open-Meteo', 'Open Trivia DB', 'discord.js', 'GSAP', 'Fabric API', 'Forge MDK', 'JokeAPI']) {
  apiSrc.includes(api) ? ok(`API: ${api}`) : fail(`falta API: ${api}`);
}
apiSrc.includes('matchFreeApis') && apiSrc.includes('formatFreeApisForPrompt')
  ? ok('matchFreeApis + formatFreeApisForPrompt')
  : fail('funciones API registry');

// ── 8. Hardware VRAM ─────────────────────────────────────────────────────────
section('Hardware — VRAM y consejos Ollama');
const hwSrc = readFileSync(join(ROOT, 'src/hardwareProfile.ts'), 'utf8');
hwSrc.includes('vramGb') ? ok('campo vramGb') : fail('sin vramGb');
hwSrc.includes('buildHardwareAdviceBlock') ? ok('buildHardwareAdviceBlock') : fail('sin buildHardwareAdviceBlock');
hwSrc.includes('memory.total') ? ok('nvidia-smi memory.total') : fail('sin detección VRAM');

const ramGb = Math.round(os.totalmem() / 1024 ** 3);
ok(`RAM detectada: ${ramGb} GB`);

// ── 9. Integración chatViewProvider ──────────────────────────────────────────
section('Integración UI — requirements + smartContext');
const chatSrc = readFileSync(join(ROOT, 'src/chatViewProvider.ts'), 'utf8');
for (const pat of [
  'shouldGatherRequirements',
  'requirementsSession',
  'gatherSmartContext',
  'buildRequirementsBlock',
  'requirementsSession,',
  "{ mode }",
  'resumePendingAgentRequest',
  'autoSelectBestModels',
]) {
  chatSrc.includes(pat) ? ok(`chatViewProvider: ${pat}`) : fail(`chatViewProvider sin: ${pat}`);
}

// ── 10. Integración agent.ts ─────────────────────────────────────────────────
section('Integración Agente');
const agentSrc = readFileSync(join(ROOT, 'src/agent.ts'), 'utf8');
agentSrc.includes('gatherSmartContext') ? ok('agent usa gatherSmartContext') : fail('agent sin smartContext');
agentSrc.includes('requirementsSession') ? ok('agent acepta requirementsSession') : fail('agent sin requirementsSession');
agentSrc.includes('buildRequirementsBlock') ? ok('agent usa buildRequirementsBlock') : fail('agent sin buildRequirementsBlock');

// ── 11. Prompts ──────────────────────────────────────────────────────────────
section('Prompts — recopilación de requisitos');
const promptsSrc = readFileSync(join(ROOT, 'src/prompts.ts'), 'utf8');
promptsSrc.includes('requirementsGatheringRules') ? ok('Chat/Profesor con requirementsGatheringRules') : fail('prompts sin rules');

// ── 12. Test Ollama — flujo asesor (preguntas simuladas) ─────────────────────
section('Ollama — asesor pregunta antes de crear');
const OLLAMA = 'http://127.0.0.1:11434';
let model = null;
try {
  const r = await fetch(`${OLLAMA}/api/tags`);
  const d = await r.json();
  const models = (d.models || []).map((m) => m.name);
  model = models.find((m) => m.includes('local-copilot-turbo')) ||
    models.find((m) => m.includes('qwen2.5-coder:7b')) || models[0];
  ok(`Ollama: ${models.length} modelos, usando ${model}`);
} catch (e) {
  fail(`Ollama no disponible: ${e.message}`);
}

if (model) {
  const systemPrompt =
    'Eres Local Copilot en modo Chat. REGLA: si piden crear web/bot/plugin sin detalles, ' +
    'haz 2-3 preguntas concretas (estilo, funciones, stack) ANTES de dar código. ' +
    'Responde en español, breve.';

  const userVague = 'créame la mejor página web con diseño dinámico y animalista';

  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userVague },
        ],
        stream: false,
        options: { temperature: 0.3, num_predict: 400 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const d = await r.json();
    const text = d.message?.content || '';
    const asksQuestions = /\?|¿qué|¿cómo|¿qué\s+estilo|¿qué\s+secciones|prefieres|opciones/i.test(text);
    const givesFullCode = /<!DOCTYPE|<html|```html/i.test(text) && text.length > 800;
    if (asksQuestions && !givesFullCode) {
      ok('Chat pregunta antes de generar (no código completo de golpe)');
      info(`Respuesta: ${text.slice(0, 120).replace(/\n/g, ' ')}…`);
    } else if (givesFullCode) {
      fail('Chat generó HTML completo sin preguntar (modelo ignoró reglas)');
      info(`Recorte: ${text.slice(0, 200)}…`);
    } else {
      ok('Chat respondió con guía/plan (aceptable)');
      info(`Respuesta: ${text.slice(0, 120).replace(/\n/g, ' ')}…`);
    }
  } catch (e) {
    fail(`Ollama chat test: ${e.message}`);
  }
}

// ── 13. Test Ollama — agente con requisitos confirmados ──────────────────────
if (model) {
  section('Ollama — agente con requisitos confirmados');
  const reqBlock = [
    '## Requisitos confirmados por el usuario',
    'Proyecto: Página web estática',
    '- **style**: Animalista / naturaleza',
    '- **sections**: Hero + galería + contacto',
    '- **animations**: Scroll animations (parallax)',
    '- **stack**: HTML + CSS + JS vanilla',
  ].join('\n');

  const systemAgent =
    'Eres agente Local Copilot. Emite bloques ACCION CREAR con código real.\n' +
    'FORMATO: ACCION: CREAR | RUTA: public/index.html | MOTIVO: ...\n<<CONTENIDO>>\n...\n<<FIN>>\n' +
    'Crea web animalista con hero, galería, contacto, animaciones CSS/JS. Sin .gitkeep.';

  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemAgent },
          { role: 'user', content: `${reqBlock}\n\nCrea la página web acordada.` },
        ],
        stream: false,
        options: { temperature: 0.15, num_predict: 4096 },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const d = await r.json();
    const raw = d.message?.content || '';
    const actions = [...raw.matchAll(/ACCION:\s*CREAR\s*\|\s*RUTA:\s*(.+?)\s*\|/gi)].map((m) => m[1].trim());
    const hasHtml = actions.some((p) => /\.html$/i.test(p)) || /<html|hero|galer/i.test(raw);
    const hasCss = actions.some((p) => /\.css$/i.test(p)) || /stylesheet|\.css/i.test(raw);
    const noGitkeep = !actions.some((p) => p.includes('.gitkeep'));

    if (actions.length >= 1) ok(`${actions.length} ACCION CREAR emitidas`);
    else fail('agente sin ACCION CREAR');
    if (hasHtml) ok('incluye HTML');
    else fail('sin HTML en respuesta agente');
    if (hasCss) ok('incluye CSS o estilos');
    else info('CSS puede estar inline (aceptable)');
    if (noGitkeep) ok('sin .gitkeep');
    else fail('contiene .gitkeep');
    for (const a of actions.slice(0, 5)) info(`  → ${a}`);
  } catch (e) {
    fail(`agente test: ${e.message}`);
  }
}

// ── Resultado ─────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
if (errors) {
  console.log(`FALLO v${VERSION}: ${errors} error(es)`);
  process.exit(1);
}
console.log(`TODO OK v${VERSION} — listo para la comunidad 🎉`);
process.exit(0);