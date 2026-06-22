#!/usr/bin/env node
/**
 * Monitor E2E — Local Copilot
 * Bucle que prueba Ollama y modos hasta que todo responda o se agote el tiempo.
 *
 * Uso:
 *   node scripts/e2e-monitor.mjs
 *   node scripts/e2e-monitor.mjs --max-attempts 10 --interval 5
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = 'http://127.0.0.1:11434';

const args = process.argv.slice(2);
const maxAttempts = parseInt(getArg('--max-attempts', '8'), 10);
const intervalSec = parseInt(getArg('--interval', '6'), 10);
const autoFix = !args.includes('--no-fix');

function getArg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => console.log(`  ❌ ${m}`);
const info = (m) => console.log(`  ℹ️  ${m}`);
const section = (t) => console.log(`\n── ${t} ──`);

let totalErrors = 0;

const norm = (n) => n.replace(/:latest$/i, '').trim().toLowerCase();
const findModel = (models, needle) =>
  models.find((m) => norm(m) === norm(needle) || m.startsWith(`${norm(needle)}:`));

async function fetchModels() {
  const r = await fetch(`${OLLAMA}/api/tags`);
  const d = await r.json();
  return (d.models || []).map((m) => m.name);
}

async function testGenerate(model) {
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: 'Responde solo: OK',
      stream: false,
      options: { num_predict: 6, temperature: 0.1 },
    }),
  });
  const d = await r.json();
  return d.response?.trim() || null;
}

async function testChatMode(label, model, system, user) {
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
      options: { num_predict: 32, temperature: 0.3 },
    }),
  });
  const d = await r.json();
  const text = d.message?.content?.trim();
  if (text) {
    ok(`${label} (${model}): ${text.slice(0, 50)}`);
    return true;
  }
  fail(`${label}: sin respuesta (${d.error || 'vacío'})`);
  return false;
}

async function runOneAttempt(attempt) {
  section(`Intento ${attempt}/${maxAttempts}`);
  let errors = 0;

  // Compilación
  try {
    execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });
    ok('compilación OK');
  } catch (e) {
    fail(`compilación: ${e.stderr?.toString() || e.message}`);
    errors++;
    return errors;
  }

  // Archivos críticos
  for (const f of ['dist/extension.js', 'src/selfTest.ts', 'scripts/e2e-monitor.mjs']) {
    if (!existsSync(join(ROOT, f))) {
      fail(`falta ${f}`);
      errors++;
    }
  }
  if (errors === 0) ok('archivos autotest presentes');

  // Ollama
  let models = [];
  try {
    models = await fetchModels();
    ok(`Ollama — ${models.length} modelos`);
  } catch (e) {
    fail(`Ollama no responde: ${e.message}`);
    info('Ejecuta: ollama serve');
    return errors + 1;
  }

  const required = [
    'local-copilot-turbo',
    'qwen2.5-coder:7b',
    'llama3.2',
    'qwen2.5:14b',
    'qwen2.5-coder:14b',
  ];

  for (const name of required) {
    const hit = findModel(models, name);
    if (!hit) {
      fail(`modelo no instalado: ${name}`);
      errors++;
      continue;
    }
    try {
      const resp = await testGenerate(hit);
      if (resp) ok(`${hit}: ${resp.slice(0, 20)}`);
      else { fail(`${hit}: sin respuesta`); errors++; }
    } catch (e) {
      fail(`${hit}: ${e.message}`);
      errors++;
    }
  }

  const chatModel = findModel(models, 'local-copilot-turbo') || findModel(models, 'qwen2.5-coder:14b') || models[0];
  const agentModel = findModel(models, 'qwen2.5-coder:14b') || findModel(models, 'qwen2.5-coder:7b') || models[0];

  const modes = [
    ['Chat', chatModel, 'Eres un asistente de programación.', '¿Qué es una función? 1 frase.'],
    ['Profesor', chatModel, 'Eres un profesor de programación.', 'Explica console.log en 1 línea.'],
    ['Agente', agentModel, 'Eres un agente que programa.', 'Lista 2 pasos para crear HTML.'],
  ];

  for (const [label, model, system, user] of modes) {
    if (!model) { fail(`${label}: sin modelo`); errors++; continue; }
    const pass = await testChatMode(label, model, system, user);
    if (!pass) errors++;
  }

  // UI checks
  const extSrc = readFileSync(join(ROOT, 'src/extension.ts'), 'utf8');
  const chatSrc = readFileSync(join(ROOT, 'src/chatViewProvider.ts'), 'utf8');
  if (!extSrc.includes('runSelfTest') || !extSrc.includes('ExtensionMonitor')) {
    fail('extension.ts sin autotest integrado');
    errors++;
  } else ok('autotest integrado en extensión');
  if (!chatSrc.includes('forceSyncModels') || !chatSrc.includes('waitForModelsLoaded')) {
    fail('chatViewProvider sin métodos de monitor');
    errors++;
  } else ok('monitor webview en chatViewProvider');

  // Empaquetar e instalar si todo OK o autoFix
  const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  if (errors === 0 || autoFix) {
    try {
      execSync('npx --yes @vscode/vsce@2.32.0 package --no-dependencies', { cwd: ROOT, stdio: 'pipe' });
      ok(`VSIX v${VERSION} generado`);
      const vsix = join(ROOT, `local-copilot-${VERSION}.vsix`);
      if (existsSync(vsix)) {
        execSync(`code --install-extension "${vsix}" --force`, { stdio: 'pipe' });
        ok('extensión instalada en VS Code');
      }
    } catch (e) {
      fail(`empaquetado/instalación: ${e.stderr?.toString() || e.message}`);
      errors++;
    }
  }

  return errors;
}

console.log('═'.repeat(50));
console.log('  Local Copilot — Monitor E2E');
console.log(`  Máx intentos: ${maxAttempts} | Intervalo: ${intervalSec}s`);
console.log('═'.repeat(50));

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const errors = await runOneAttempt(attempt);
  totalErrors = errors;

  if (errors === 0) {
    console.log('\n' + '═'.repeat(50));
    console.log('  ✓ TODO OK — Chat, Profesor y Agente responden');
    console.log('  Recarga VS Code: Ctrl+Shift+P → Reload Window');
    console.log('  El autotest interno se ejecutará al activar.');
    console.log('═'.repeat(50));
    process.exit(0);
  }

  if (attempt < maxAttempts) {
    info(`Reintento en ${intervalSec}s (${errors} fallo(s))…`);
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

console.log('\n' + '═'.repeat(50));
console.log(`  ✗ Monitor terminó con ${totalErrors} fallo(s) tras ${maxAttempts} intentos`);
console.log('  Revisa: ollama serve | salida "Local Copilot" en VS Code');
console.log('═'.repeat(50));
process.exit(1);