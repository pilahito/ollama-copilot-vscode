#!/usr/bin/env node
/**
 * MODO DIOS — no para hasta que TODO pase o se agoten los intentos.
 * Uso: node scripts/god-mode.mjs
 *      node scripts/god-mode.mjs --max 10
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = '/tmp/local-copilot-debug.log';
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const maxAttempts = parseInt(getArg('--max', '5'), 10);

const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => console.log(`  ❌ ${m}`);
const info = (m) => console.log(`  ℹ️  ${m}`);
const section = (t) => console.log(`\n${'═'.repeat(50)}\n  ${t}\n${'═'.repeat(50)}`);

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', timeout: opts.timeout ?? 120_000, ...opts });
}

function runSilent(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 120_000 });
  } catch (e) {
    return e.stdout?.toString() || e.stderr?.toString() || e.message;
  }
}

async function focusAndReload() {
  if (!process.env.DISPLAY) return;
  const wid = runSilent('xdotool search --onlyvisible --class code 2>/dev/null | tail -1').trim();
  if (!wid) return;
  runSilent(`xdotool windowactivate ${wid}`);
  await sleep(400);
  runSilent('xdotool key ctrl+shift+p');
  await sleep(600);
  runSilent('xdotool type --delay 12 "Developer: Reload Window"');
  runSilent('xdotool key Return');
  await sleep(12_000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function oneAttempt(n) {
  section(`MODO DIOS — Intento ${n}/${maxAttempts}`);
  let errors = 0;

  try {
    run('npm run compile', { silent: true });
    ok('Compilación');
  } catch {
    fail('Compilación'); errors++; return errors;
  }

  const ver = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  try {
    run(`npx --yes @vscode/vsce@2.32.0 package --no-dependencies`, { silent: true });
    run(`code --install-extension "${join(ROOT, `local-copilot-${ver}.vsix`)}" --force`, { silent: true });
    ok(`Instalado v${ver}`);
  } catch (e) {
    fail(`Empaquetado/instalación: ${e.message}`); errors++; return errors;
  }

  try {
    writeFileSync(LOG, `[god-mode] intento ${n} v${ver}\n`, { flag: 'a' });
  } catch {
    writeFileSync(LOG, `[god-mode] intento ${n} v${ver}\n`);
  }

  const webviewCheck = spawnSync('node', [join(ROOT, 'scripts/check-webview-script.mjs')], { encoding: 'utf8' });
  if (webviewCheck.status === 0) ok('Sintaxis webview');
  else { fail('Sintaxis webview'); errors++; }

  const tests = spawnSync('node', [join(ROOT, 'test_all_options.mjs')], { encoding: 'utf8', cwd: ROOT });
  if (tests.status === 0) ok('test_all_options.mjs');
  else { fail('test_all_options.mjs'); errors++; }

  const agentE2e = spawnSync('node', [join(ROOT, 'scripts/agent-e2e.mjs')], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 300_000,
  });
  if (agentE2e.status === 0) ok('agent-e2e.mjs (ACCION + disco)');
  else {
    fail('agent-e2e.mjs (ACCION + disco)');
    if (agentE2e.stdout) info(agentE2e.stdout.split('\n').slice(-4).join(' '));
    errors++;
  }

  if (process.env.DISPLAY) {
    info('Depuración visual (reload + pruebas UI)…');
    const visual = spawnSync('node', [join(ROOT, 'scripts/visual-debug.mjs')], {
      encoding: 'utf8',
      cwd: ROOT,
      timeout: 360_000,
    });
    if (visual.status === 0) ok('visual-debug.mjs');
    else { fail('visual-debug.mjs'); errors++; }
  }

  if (existsSync(LOG)) {
    const log = readFileSync(LOG, 'utf8');
    const finOk = /Fin depuración: \d+ OK, 0 fallos/.test(log);
    const pingOk = log.includes('pong OK');
    const userChat = log.includes('[userSend:chat]') && log.includes('ok=true');
    const userTeacher = log.includes('[userSend:teacher]') && log.includes('ok=true');
    const userAgent = log.includes('[userSend:agent]') && log.includes('ok=true');
    const spam = (log.match(/\[webview←\] getOllamaModels/g) || []).length;

    const prefillOk = log.includes('[prefill:chat]') && log.includes('ok=true');

    if (finOk) ok(`Log: ${log.match(/Fin depuración: [^\n]+/)?.[0]}`);
    else { fail('Log sin "Fin depuración 0 fallos"'); errors++; }

    if (pingOk) ok('Ping↔Pong');
    else { fail('Ping↔Pong'); errors++; }

    if (userChat) ok('Usuario→Chat');
    else { fail('Usuario→Chat'); errors++; }

    if (userTeacher) ok('Usuario→Profesor');
    else { fail('Usuario→Profesor'); errors++; }

    if (userAgent) ok('Usuario→Agente');
    else { fail('Usuario→Agente'); errors++; }

    if (prefillOk) ok('Prefill (Explicar código)');
    else { fail('Prefill'); errors++; }

    if (spam < 15) ok(`Sin spam modelos (${spam} peticiones)`);
    else { fail(`Spam getOllamaModels: ${spam}`); errors++; }
  } else {
    fail('Log de depuración no generado'); errors++;
  }

  return errors;
}

console.log('\n🔥 LOCAL COPILOT — MODO DIOS 🔥');
console.log(`Máximo ${maxAttempts} intentos. No para hasta TODO OK.\n`);

for (let i = 1; i <= maxAttempts; i++) {
  const errors = await oneAttempt(i);
  if (errors === 0) {
    section('✓ MODO DIOS COMPLETADO — TODO FUNCIONA');
    console.log(`  v${JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version}`);
    console.log(`  Log: ${LOG}`);
    console.log(`  Capturas: /tmp/local-copilot-screenshots/`);
    process.exit(0);
  }
  info(`${errors} fallo(s) — reintento ${i < maxAttempts ? 'en 8s' : 'agotado'}…`);
  if (i < maxAttempts) await sleep(8000);
}

section('✗ MODO DIOS — fallos tras todos los intentos');
process.exit(1);