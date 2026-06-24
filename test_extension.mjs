#!/usr/bin/env node
/**
 * Tests — Local Copilot VS Code extension
 * Uso: node test_extension.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OLLAMA = 'http://127.0.0.1:11434';
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
let errors = 0;

const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); errors++; };
const section = (t) => console.log(`\n── ${t} ──`);

section('Compilación');
try {
  execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });
  ok('esbuild compile OK');
} catch (e) {
  fail(`compile: ${e.stderr?.toString() || e.message}`);
}

section('Archivos críticos');
for (const f of ['dist/extension.js', 'media/paypal.svg', 'media/diablo.jpg', 'media/activitybar.png', 'LICENSE', 'package.json']) {
  existsSync(join(ROOT, f)) ? ok(f) : fail(`falta ${f}`);
}

section('UI — donaciones');
const chatSrc = readFileSync(join(ROOT, 'src/chatViewProvider.ts'), 'utf8');
if (chatSrc.includes('id="btn-donate"') || chatSrc.includes('btn-paypal')) {
  fail('botón PayPal superior sigue en el header');
} else {
  ok('sin PayPal en la parte superior');
}
if (!chatSrc.includes('>Donación</a>')) fail('falta enlace inferior "Donación"');
else ok('enlace inferior "Donación" estilo GitHub');
if (chatSrc.includes('donate-link') || chatSrc.includes('paypalIconUri')) {
  fail('footer aún usa icono PayPal en lugar de texto');
} else {
  ok('sin icono PayPal en el footer');
}

section('UI — dock demonio + chat derecha');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const mediaPaths = readFileSync(join(ROOT, 'src/mediaPaths.ts'), 'utf8');
if (!mediaPaths.includes("diablo.jpg")) fail('logo dock debe ser diablo.jpg');
else ok('logo dock: diablo.jpg');
if (!pkg.contributes?.viewsContainers?.secondarySidebar) fail('falta secondarySidebar (chat derecha)');
else ok('chat en panel derecho (secondarySidebar)');
if (!pkg.contributes?.views?.['localcopilot-chat']) fail('falta vista localcopilot-chat');
else ok('vista local.chatView en barra derecha');
if (!pkg.contributes?.views?.localcopilot?.find((v) => v.id === 'local.dockView')) fail('falta dock izquierdo');
else ok('dock local.dockView en barra izquierda');

section('Chat — inicialización');
const chatProviderSrc = readFileSync(join(ROOT, 'src/chatViewProvider.ts'), 'utf8');
if (!chatProviderSrc.includes('waitUntilReady')) fail('falta waitUntilReady en chat');
else ok('chat espera a que la webview esté lista');
if (chatProviderSrc.includes('onclick=')) fail('webview usa onclick (bloqueado por VS Code)');
else ok('sin onclick en webview (botones con addEventListener)');
if (!chatProviderSrc.includes('btn-refresh')) fail('falta botón 🔄 recargar');
else ok('botón 🔄 recargar');
if (chatProviderSrc.includes('id="btn-recommend"')) fail('botón 🎯 obsoleto (id btn-recommend)');
else ok('sin botón 🎯 obsoleto');
if (!chatProviderSrc.includes('btn-recommendations')) fail('falta botón 😈 recomendaciones');
else ok('botón 😈 recomendaciones presente');
if (!chatProviderSrc.includes('link-donate')) fail('falta enlace donación con id');
else ok('donación con addEventListener');
if (!chatProviderSrc.includes('initState')) fail('falta handshake initState');
else ok('handshake initState al cargar');
if (!chatProviderSrc.includes('forceSyncModels')) fail('falta forceSyncModels');
else ok('monitor webview (forceSyncModels)');

section('Ajustes — APIs y hardware');
if (!chatSrc.includes('data-tab="hardware"')) fail('falta pestaña Hardware en ajustes');
else ok('pestaña Hardware en ⚙️');
if (!chatSrc.includes('groq-model') || !chatSrc.includes('btn-use-api')) {
  fail('ajustes sin campos de modelo API o botón Usar');
} else {
  ok('APIs con modelo y botón Usar en chat');
}
if (chatSrc.includes('data-provider="duckduckgo"')) fail('DuckDuckGo no debe estar como IA en ajustes');
else ok('DuckDuckGo solo como navegador, no como IA');
if (!chatSrc.includes('Navegador (no es IA')) fail('falta sección navegador en ajustes');
else ok('sección Navegador en ⚙️');

section('Autotest integrado');
const extSrc = readFileSync(join(ROOT, 'src/extension.ts'), 'utf8');
if (!existsSync(join(ROOT, 'src/selfTest.ts'))) fail('falta src/selfTest.ts');
else ok('selfTest.ts presente');
if (!extSrc.includes('ExtensionMonitor') || !extSrc.includes('local.runSelfTest')) {
  fail('extension sin monitor/autotest');
} else {
  ok('monitor y comando runSelfTest integrados');
}

section('Ollama — conexión');
let models = [];
try {
  const r = await fetch(`${OLLAMA}/api/tags`);
  const d = await r.json();
  models = (d.models || []).map((m) => m.name);
  ok(`${models.length} modelos detectados`);
} catch (e) {
  fail(`Ollama no responde — ejecuta: ollama serve (${e.message})`);
}

const norm = (n) => n.replace(/:latest$/i, '').trim().toLowerCase();
const findModel = (needle) => models.find((m) => norm(m) === norm(needle) || m.startsWith(`${norm(needle)}:`));

section('Ollama — todos los modelos del usuario');
for (const name of [
  'local-copilot-turbo',
  'qwen2.5-coder:7b',
  'llama3.2',
  'qwen2.5:14b',
  'qwen2.5-coder:14b',
]) {
  const hit = findModel(name);
  if (!hit) {
    fail(`modelo no instalado: ${name}`);
    continue;
  }
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: hit,
        prompt: 'Responde solo: OK',
        stream: false,
        options: { num_predict: 6, temperature: 0.1 },
      }),
    });
    const d = await r.json();
    if (d.response?.trim()) ok(`${hit}: ${d.response.trim().slice(0, 30)}`);
    else fail(`${hit}: sin respuesta (${d.error || 'vacío'})`);
  } catch (e) {
    fail(`${hit}: ${e.message}`);
  }
}

section('Modos — chat / profesor / agente (API)');
const chatModel = findModel('local-copilot-turbo') || findModel('qwen2.5-coder:14b') || models[0];
const agentModel = findModel('qwen2.5-coder:14b') || findModel('qwen2.5-coder:7b') || models[0];

async function testChatStream(label, model, system, user) {
  if (!model) { fail(`${label}: sin modelo`); return; }
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
        options: { num_predict: 24, temperature: 0.3 },
      }),
    });
    const d = await r.json();
    const text = d.message?.content?.trim();
    if (text) ok(`${label} (${model}): ${text.slice(0, 50)}`);
    else fail(`${label}: sin respuesta (${d.error || 'vacío'})`);
  } catch (e) {
    fail(`${label}: ${e.message}`);
  }
}

await testChatStream(
  'Chat',
  chatModel,
  'Eres un asistente de programación.',
  '¿Qué es una función en JavaScript? Responde en 1 frase.'
);
await testChatStream(
  'Profesor',
  chatModel,
  'Eres un profesor que explica código con claridad.',
  'Explica qué hace console.log en una línea.'
);
await testChatStream(
  'Agente',
  agentModel,
  'Eres un agente que programa. Responde brevemente.',
  'Lista 2 pasos para crear un proyecto web con HTML.'
);

section('VSIX e instalación');
const vsix = join(ROOT, `local-copilot-${VERSION}.vsix`);
try {
  execSync('npx --yes @vscode/vsce@2.32.0 package --no-dependencies', { cwd: ROOT, stdio: 'pipe' });
  ok(`VSIX ${VERSION} generado`);
} catch (e) {
  fail(`empaquetado: ${e.stderr?.toString() || e.message}`);
}

if (existsSync(vsix)) {
  try {
    execSync(`code --install-extension "${vsix}" --force`, { stdio: 'pipe' });
    ok('extensión instalada en VS Code');
  } catch (e) {
    fail(`instalación: ${e.stderr?.toString() || e.message}`);
  }
} else {
  fail(`falta ${vsix}`);
}

console.log(`\n${'='.repeat(42)}`);
if (errors) {
  console.log(`RESULTADO: ${errors} problema(s)`);
  process.exit(1);
}
console.log(`RESULTADO: v${VERSION} OK — Recarga VS Code (Ctrl+Shift+P → Reload Window)`);
process.exit(0);