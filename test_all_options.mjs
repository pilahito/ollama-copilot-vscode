#!/usr/bin/env node
/**
 * Test exhaustivo — todas las opciones de Local Copilot
 * Uso: node test_all_options.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import os from 'os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OLLAMA = 'http://127.0.0.1:11434';
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

let errors = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); errors++; };
const section = (t) => console.log(`\n══ ${t} ══`);

const norm = (n) => n.replace(/:latest$/i, '').trim().toLowerCase();
const findModel = (models, needle) =>
  models.find((m) => norm(m) === norm(needle) || m.startsWith(`${norm(needle)}:`));

// ── 1. Compilación ──────────────────────────────────────────────────────────
section('Compilación');
try {
  execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });
  ok('esbuild OK');
} catch (e) {
  fail(`compile: ${e.stderr?.toString() || e.message}`);
}

// ── 2. Comandos package.json ─────────────────────────────────────────────────
section('Comandos VS Code');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const cmds = (pkg.contributes?.commands || []).map((c) => c.command);
for (const cmd of [
  'local.openChat', 'local.clearChat', 'local.checkConnection', 'local.runSelfTest',
  'local.selectModel', 'local.fixError', 'local.explainCode', 'local.analyzeProject',
  'local.toggleInlineSuggestions', 'local.supportDonate',
]) {
  cmds.includes(cmd) ? ok(cmd) : fail(`falta comando ${cmd}`);
}

// ── 3. Proveedores IA ────────────────────────────────────────────────────────
section('Proveedores IA (config)');
const providers = pkg.contributes?.configuration?.properties?.['local.provider']?.enum || [];
for (const p of ['auto', 'ollama', 'groq', 'gemini', 'openrouter', 'cerebras', 'together', 'cohere', 'huggingface']) {
  providers.includes(p) ? ok(`provider: ${p}`) : fail(`falta provider ${p}`);
}
if (providers.includes('duckduckgo')) fail('duckduckgo no debe estar en enum de IAs');
else ok('duckduckgo fuera del selector de IAs');

// ── 4. UI Chat ───────────────────────────────────────────────────────────────
section('UI — Chat y modos');
const chatSrc = readFileSync(join(ROOT, 'src/chatViewProvider.ts'), 'utf8');
const uiChecks = [
  ['Modo Chat', 'data-mode="chat"'],
  ['Modo Profesor', 'data-mode="teacher"'],
  ['Modo Agente', 'data-mode="agent"'],
  ['Selector IA', 'provider-select'],
  ['Selector Ollama', 'ollama-model-select'],
  ['+Internet', 'internet-mode'],
  ['Botón enviar', 'send-btn'],
  ['Botón ajustes', 'btn-settings'],
  ['Botón recomendaciones', 'btn-recommendations'],
  ['Botón refrescar', 'btn-refresh'],
  ['Botón limpiar', 'btn-clear'],
  ['Donación footer', '>Donación</a>'],
  ['Licencia MIT footer', 'license-badge'],
  ['Recargar 🔄', 'btn-refresh'],
  ['Ping webview handler', "case 'ping'"],
  ['Ping webview', 'testWebviewPing'],
];
for (const [name, pat] of uiChecks) {
  chatSrc.includes(pat) ? ok(name) : fail(`UI: ${name}`);
}
const pkgSrc = readFileSync(join(ROOT, 'package.json'), 'utf8');
const layoutSrc = readFileSync(join(ROOT, 'src/copilotLayout.ts'), 'utf8');
pkgSrc.includes('localcopilot-chat') ? ok('Chat panel derecho') : fail('UI: Chat panel derecho');
pkgSrc.includes('local.dockView') ? ok('Dock izquierdo demonio') : fail('UI: Dock izquierdo');
pkgSrc.includes('diablo.jpg') ? ok('Logo diablo.jpg') : fail('UI: logo diablo');
layoutSrc.includes('suppressCompetingAiChats') ? ok('Suprimir Copilot/Codex') : fail('UI: Suprimir Copilot/Codex');
existsSync(join(ROOT, 'scripts/visual-debug.mjs')) ? ok('Script visual-debug.mjs') : fail('Script visual-debug.mjs');

// ── 5. Ajustes ⚙️ ────────────────────────────────────────────────────────────
section('Ajustes ⚙️ — APIs, Hardware, Prompts');
const settingsChecks = [
  ['Pestaña APIs', 'data-tab="apis"'],
  ['Pestaña IAs recomendadas', 'data-tab="models"'],
  ['Selector casos de uso', 'use-case-grid'],
  ['Catálogo modelos ES', './modelCatalog'],
  ['Aplicar perfil IA', 'applyTaskModel'],
  ['Agente IDE', 'agentIdeMode'],
  ['Auto-modificar extensión', 'agentSelfModify'],
  ['vscodeManager', 'vscodeManager.ts'],
  ['Pestaña Hardware', 'data-tab="hardware"'],
  ['Pestaña Prompts', 'data-tab="prompts"'],
  ['API Groq + modelo', 'groq-key'],
  ['API Gemini + modelo', 'gemini-model'],
  ['API OpenRouter', 'openrouter-key'],
  ['DuckDuckGo como navegador', 'Navegador (no es IA'],
  ['Usar en chat', 'btn-use-api'],
  ['Probar Ollama', 'btn-test-ollama'],
  ['Analizar hardware', 'btn-refresh-hardware'],
  ['Guardar ajustes', 'btn-save-settings'],
  ['Prompt Chat', 'prompt-chat'],
  ['Prompt Profesor', 'prompt-teacher'],
  ['Prompt Agente', 'prompt-agent'],
];
for (const [name, pat] of settingsChecks) {
  if (pat === 'vscodeManager.ts') {
    existsSync(join(ROOT, 'src/vscodeManager.ts')) ? ok(name) : fail(`Ajustes: ${name}`);
  } else if (pat === 'agentIdeMode' || pat === 'agentSelfModify') {
    (chatSrc.includes(pat) && readFileSync(join(ROOT, 'package.json'), 'utf8').includes(`"local.${pat}"`))
      ? ok(name) : fail(`Ajustes: ${name}`);
  } else {
    chatSrc.includes(pat) ? ok(name) : fail(`Ajustes: ${name}`);
  }
}

// ── 6. Código — DuckDuckGo NO es IA integrada ─────────────────────────────────
section('Código — DuckDuckGo solo navegador');
const ollamaSrc = readFileSync(join(ROOT, 'src/ollamaClient.ts'), 'utf8');
const internetBlock = ollamaSrc.match(/INTERNET_PROVIDERS[^;]+;/)?.[0] ?? '';
if (!internetBlock.includes('duckduckgo')) {
  ok('DuckDuckGo fuera de INTERNET_PROVIDERS');
} else {
  fail('DuckDuckGo sigue como proveedor IA');
}
if (!chatSrc.includes('<option value="duckduckgo">')) {
  ok('DuckDuckGo fuera del selector IA');
} else {
  fail('DuckDuckGo sigue en selector IA');
}
if (chatSrc.includes('Navegador (no es IA')) {
  ok('sección Navegador en ajustes');
} else {
  fail('falta sección Navegador');
}

// ── 7. Hardware ───────────────────────────────────────────────────────────────
section('Hardware — perfil y recomendaciones');
const hwSrc = readFileSync(join(ROOT, 'src/hardwareProfile.ts'), 'utf8');
const ramGb = Math.round(os.totalmem() / 1024 ** 3);
const tier = ramGb <= 8 ? 'basic' : ramGb <= 16 ? 'normal' : ramGb <= 32 ? 'good' : 'powerful';
ok(`RAM ${ramGb}GB → tier "${tier}"`);
for (const t of ['basic', 'normal', 'good', 'powerful']) {
  hwSrc.includes(`'${t}'`) ? ok(`tier ${t} definido`) : fail(`falta tier ${t}`);
}
hwSrc.includes('buildRecommendations') ? ok('recomendaciones por hardware') : fail('sin recomendaciones');

// ── 8. Model router ───────────────────────────────────────────────────────────
section('Model router — asignación por tarea');
const routerSrc = readFileSync(join(ROOT, 'src/modelRouter.ts'), 'utf8');
routerSrc.includes('pickTaskModels') ? ok('pickTaskModels') : fail('pickTaskModels');
routerSrc.includes('local-copilot-turbo') ? ok('prioriza local-copilot-turbo') : fail('sin turbo');

// ── 9. Autotest ───────────────────────────────────────────────────────────────
section('Autotest y monitor');
existsSync(join(ROOT, 'src/selfTest.ts')) ? ok('selfTest.ts') : fail('selfTest.ts');
const extSrc = readFileSync(join(ROOT, 'src/extension.ts'), 'utf8');
extSrc.includes('ExtensionMonitor') ? ok('monitor integrado') : fail('monitor');
extSrc.includes('local.runSelfTest') ? ok('comando runSelfTest') : fail('runSelfTest');
extSrc.includes('local.debugVisual') ? ok('comando debugVisual') : fail('debugVisual');
extSrc.includes('local.godMode') ? ok('comando godMode') : fail('godMode');
existsSync(join(ROOT, 'scripts/god-mode.mjs')) ? ok('Script god-mode.mjs') : fail('god-mode.mjs');

// ── 10. Ollama — conexión y modelos ───────────────────────────────────────────
section('Ollama — conexión');
let models = [];
try {
  const r = await fetch(`${OLLAMA}/api/tags`);
  const d = await r.json();
  models = (d.models || []).map((m) => m.name);
  ok(`${models.length} modelos`);
} catch (e) {
  fail(`Ollama no responde: ${e.message}`);
}

// ── 11. Todos los modelos responden ───────────────────────────────────────────
section('Ollama — generate por modelo');
for (const name of ['local-copilot-turbo', 'qwen2.5-coder:7b', 'llama3.2', 'qwen2.5:14b', 'qwen2.5-coder:14b']) {
  const hit = findModel(models, name);
  if (!hit) { fail(`no instalado: ${name}`); continue; }
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: hit, prompt: 'OK', stream: false, options: { num_predict: 4, temperature: 0.1 } }),
    });
    const d = await r.json();
    d.response?.trim() ? ok(`${hit}`) : fail(`${hit}: vacío`);
  } catch (e) {
    fail(`${hit}: ${e.message}`);
  }
}

// ── 12. Modos Chat / Profesor / Agente ────────────────────────────────────────
section('Modos — Chat / Profesor / Agente');
const chatM = findModel(models, 'local-copilot-turbo') || models[0];
const agentM = findModel(models, 'qwen2.5-coder:14b') || models[0];

async function testMode(label, model, system, user) {
  if (!model) { fail(`${label}: sin modelo`); return; }
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        stream: false, options: { num_predict: 30, temperature: 0.3 },
      }),
    });
    const d = await r.json();
    const text = d.message?.content?.trim();
    text ? ok(`${label}: ${text.slice(0, 50)}`) : fail(`${label}: sin respuesta`);
  } catch (e) {
    fail(`${label}: ${e.message}`);
  }
}

await testMode('Chat', chatM, 'Eres asistente de programación.', '¿Qué es una variable? 1 frase.');
await testMode('Profesor', chatM, 'Eres profesor de programación.', 'Explica let vs var en 2 líneas.');
await testMode('Agente', agentM, 'Eres agente que programa.', '2 pasos para crear HTML básico.');

// ── 13. Task models (simulación router) ───────────────────────────────────────
section('Asignación automática de modelos');
if (models.length > 0) {
  const COMPLETION_ORDER = ['local-copilot-turbo', 'qwen2.5-coder:7b'];
  const CHAT_ORDER = ['local-copilot-turbo', 'qwen2.5-coder:14b', 'qwen2.5:14b'];
  const AGENT_ORDER = ['qwen2.5-coder:14b', 'local-copilot-turbo'];
  const pick = (order) => order.map((n) => findModel(models, n)).find(Boolean) || models[0];
  ok(`Chat → ${pick(CHAT_ORDER)}`);
  ok(`Autocomplete → ${pick(COMPLETION_ORDER)}`);
  ok(`Agente → ${pick(AGENT_ORDER)}`);
}

// ── 14. Búsqueda web (+Internet usa DuckDuckGo internamente, no como IA) ─────
section('Búsqueda web — DuckDuckGo como buscador');
try {
  const r = await fetch('https://api.duckduckgo.com/?q=test&format=json&no_html=1', {
    signal: AbortSignal.timeout(10_000),
  });
  r.ok ? ok('API búsqueda DuckDuckGo (para +Internet)') : fail(`DDG search HTTP ${r.status}`);
} catch (e) {
  fail(`búsqueda DDG: ${e.message}`);
}

// ── 15. Prompts ───────────────────────────────────────────────────────────────
section('Prompts editables');
const promptSrc = readFileSync(join(ROOT, 'src/promptSettings.ts'), 'utf8');
const promptFields = { chat: 'promptChat', teacher: 'promptTeacher', teacherFix: 'promptTeacherFix', agent: 'promptAgent' };
for (const [field, key] of Object.entries(promptFields)) {
  promptSrc.includes(key) ? ok(`prompt ${field} (${key})`) : fail(`prompt ${field}`);
}

// ── 16. Empaquetar e instalar ─────────────────────────────────────────────────
section('VSIX e instalación');
try {
  execSync('npx --yes @vscode/vsce@2.32.0 package --no-dependencies', { cwd: ROOT, stdio: 'pipe' });
  ok(`VSIX v${VERSION}`);
  const vsix = join(ROOT, `local-copilot-${VERSION}.vsix`);
  if (existsSync(vsix)) {
    execSync(`code --install-extension "${vsix}" --force`, { stdio: 'pipe' });
    ok('instalado en VS Code');
  } else {
    fail(`falta ${vsix}`);
  }
} catch (e) {
  fail(`empaquetado: ${e.stderr?.toString() || e.message}`);
}

// ── Resultado ─────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
if (errors) {
  console.log(`FALLO: ${errors} error(es) en v${VERSION}`);
  process.exit(1);
}
console.log(`TODO OK — v${VERSION} — todas las opciones verificadas`);
console.log('Recarga VS Code: Ctrl+Shift+P → Reload Window');
process.exit(0);