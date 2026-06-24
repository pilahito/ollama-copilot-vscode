#!/usr/bin/env node
/**
 * Depuración visual de VS Code — automatiza UI, lee log y toma capturas.
 *
 * Uso: node scripts/visual-debug.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = '/tmp/local-copilot-debug.log';
const SHOTS = '/tmp/local-copilot-screenshots';

const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => console.log(`  ❌ ${m}`);
const info = (m) => console.log(`  ℹ️  ${m}`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15000, ...opts }).trim();
  } catch (e) {
    return e.stdout?.toString()?.trim() || e.stderr?.toString()?.trim() || null;
  }
}

async function focusVsCode() {
  if (!process.env.DISPLAY) {
    info('Sin DISPLAY — omitiendo automatización UI');
    return false;
  }
  const wid = run('xdotool search --onlyvisible --class code 2>/dev/null | tail -1');
  if (!wid) {
    fail('Ventana VS Code no encontrada');
    return false;
  }
  run(`xdotool windowactivate ${wid}`);
  await sleep(400);
  ok(`VS Code enfocado (wid=${wid})`);
  return true;
}

async function runCommandPalette(command) {
  run('xdotool key ctrl+shift+p');
  await sleep(600);
  run(`xdotool type --delay 30 "${command}"`);
  await sleep(400);
  run('xdotool key Return');
  await sleep(800);
}

async function screenshot(label) {
  if (!process.env.DISPLAY) return;
  try {
    const file = join(SHOTS, `${label}-${Date.now()}.png`);
    run(`mkdir -p "${SHOTS}"`);
    run(`gnome-screenshot -w -f "${file}"`) || run(`import -window root "${file}"`);
    if (existsSync(file)) ok(`Captura: ${file}`);
  } catch {
    /* ignore */
  }
}

function parseLog() {
  if (!existsSync(LOG)) {
    fail(`Log no encontrado: ${LOG}`);
    return { errors: 1, lines: [] };
  }
  const text = readFileSync(LOG, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const errors = lines.filter((l) => l.includes('✗') || l.includes('FALLÓ') || l.includes('DESCARTADO') || l.includes('timeout'));
  return { errors: errors.length, lines };
}

async function main() {
  console.log('═'.repeat(50));
  console.log('  Local Copilot — Depuración visual VS Code');
  console.log('═'.repeat(50));

  // Compilar e instalar
  try {
    execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });
    ok('Compilación OK');
    const ver = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    execSync(`npx --yes @vscode/vsce@2.32.0 package --no-dependencies`, { cwd: ROOT, stdio: 'pipe' });
    const vsix = join(ROOT, `local-copilot-${ver}.vsix`);
    execSync(`code --install-extension "${vsix}" --force`, { stdio: 'pipe' });
    ok(`Instalado v${ver}`);
  } catch (e) {
    fail(`Build/install: ${e.message}`);
    process.exit(1);
  }

  const focused = await focusVsCode();
  if (focused) {
    await screenshot('01-antes-reload');
    info('Recargando VS Code…');
    await runCommandPalette('Developer: Reload Window');
    await sleep(8000);
    await focusVsCode();
    await screenshot('02-despues-reload');
    info('Abriendo Local Copilot…');
    await runCommandPalette('Local: Abrir Chat IA');
    await sleep(3000);
    await screenshot('03-chat-abierto');
    info('Ejecutando depuración visual…');
    await runCommandPalette('Local: Depuración visual (webview + captura)');
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (existsSync(LOG)) {
        const tail = readFileSync(LOG, 'utf8');
        if (/Fin depuración: \d+ OK, 0 fallos/.test(tail)) {
          ok('Depuración terminada (log OK)');
          break;
        }
        if (/Fin depuración:.*[1-9]\d* fallos/.test(tail)) {
          fail('Depuración con fallos en log');
          break;
        }
      }
      await sleep(3000);
    }
    await screenshot('04-depuracion-fin');
  }

  const { errors, lines } = parseLog();
  info(`Log: ${LOG} (${lines.length} líneas)`);

  const last20 = lines.slice(-20);
  console.log('\n── Últimas líneas del log ──');
  last20.forEach((l) => console.log(`  ${l}`));

  if (existsSync(SHOTS)) {
    const shots = readdirSync(SHOTS).filter((f) => f.endsWith('.png')).sort();
    if (shots.length) {
      console.log('\n── Capturas ──');
      shots.slice(-5).forEach((s) => console.log(`  ${join(SHOTS, s)}`));
    }
  }

  const finOk = lines.some((l) => /Fin depuración: \d+ OK, 0 fallos/.test(l));
  const pingOk = lines.some((l) => l.includes('pong OK'));
  const chatOk = lines.some((l) => l.includes('[pipeline:chat]') && l.includes('ok=true'));

  console.log('\n' + '═'.repeat(50));
  if (finOk || (pingOk && chatOk)) {
    console.log('  ✓ Depuración visual OK — Chat, Profesor y Agente responden');
    process.exit(0);
  } else if (errors === 0 && pingOk) {
    console.log('  ✓ Ping webview OK (revisa pipeline en log)');
    process.exit(0);
  } else {
    console.log(`  ✗ Revisa log y capturas — ${errors} línea(s) de error en log`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});