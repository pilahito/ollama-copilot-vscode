#!/usr/bin/env node
/**
 * Test agente EN VIVO — escribe en el chat visible de VS Code y monitoriza fallos.
 *
 * 1. Instala extensión v1.3.6+
 * 2. Abre nekotina-bot en VS Code
 * 3. Lanza "Local: Test agente en vivo (Nekotina — chat visible)"
 * 4. Muestra /tmp/local-copilot-debug.log en tiempo real
 *
 * Uso: node scripts/test-agent-chat-live.mjs
 *      node scripts/test-agent-chat-live.mjs --no-ui   (solo monitoriza log si ya lanzaste el test)
 */
import { readFileSync, existsSync, watchFile, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = '/tmp/local-copilot-debug.log';
const LIVE_FLAG = '/tmp/local-copilot-run-agent-live.flag';
const BOT = '/home/david/Escritorio/nekotina-bot';
const NO_UI = process.argv.includes('--no-ui');

const ok = (m) => console.log(`\x1b[32m  ✅ ${m}\x1b[0m`);
const fail = (m) => console.log(`\x1b[31m  ❌ ${m}\x1b[0m`);
const info = (m) => console.log(`\x1b[36m  ℹ️  ${m}\x1b[0m`);
const warn = (m) => console.log(`\x1b[33m  ⚠️  ${m}\x1b[0m`);
const section = (t) => console.log(`\n\x1b[1m══ ${t} ══\x1b[0m`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', timeout: opts.timeout ?? 120_000, ...opts });
}

async function focusVsCode() {
  if (!process.env.DISPLAY) return false;
  try {
    const wid = execSync('xdotool search --onlyvisible --class code 2>/dev/null | tail -1', { encoding: 'utf8' }).trim();
    if (!wid) return false;
    execSync(`xdotool windowactivate ${wid}`);
    await sleep(500);
    return true;
  } catch {
    return false;
  }
}

async function runPalette(cmd) {
  if (!process.env.DISPLAY) return false;
  execSync('xdotool key ctrl+shift+p');
  await sleep(700);
  execSync(`xdotool type --delay 25 "${cmd}"`);
  await sleep(500);
  execSync('xdotool key Return');
  await sleep(1000);
  return true;
}

function tailLog(fromByte = 0) {
  if (!existsSync(LOG)) return fromByte;
  const text = readFileSync(LOG, 'utf8');
  const chunk = text.slice(fromByte);
  if (!chunk) return text.length;

  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    if (/✗|FALLO|sintaxis rota|FALLO —|falló/i.test(line)) {
      fail(`LOG: ${line.trim()}`);
    } else if (/agent-live|userSend:agent|agente\]|progress\]/i.test(line)) {
      info(`LOG: ${line.trim()}`);
    } else if (/✓|OK|agentDone|terminada/i.test(line)) {
      ok(`LOG: ${line.trim()}`);
    } else if (/\[webview→\]|\[send\]/i.test(line)) {
      console.log(`     ${line.trim()}`);
    }
  }
  return text.length;
}

async function monitorLog(maxMin = 30) {
  section('Monitor en vivo — mira el chat Agente en VS Code');
  info(`Log: ${LOG}`);
  info('Busca: texto escribiéndose en el input, panel morado, mensajes rojos/verdes en el chat');
  console.log('');

  let pos = existsSync(LOG) ? statSync(LOG).size : 0;
  const deadline = Date.now() + maxMin * 60_000;
  let lastActivity = Date.now();

  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (existsSync(LOG)) {
        const newPos = tailLog(pos);
        if (newPos > pos) {
          pos = newPos;
          lastActivity = Date.now();
        }
        const tail = readFileSync(LOG, 'utf8');
        if (/AUTO — test en vivo/.test(tail) && !/Fin test agente/.test(tail)) {
          info('Test agente AUTO detectado en log — en curso…');
        }
        if (/Fin test agente en vivo:.*0 fallos/.test(tail)) {
          clearInterval(poll);
          ok('Test agente en vivo completado sin fallos');
          resolve(0);
          return;
        }
        if (/Fin test agente en vivo:.*[1-9]\d* fallos/.test(tail)) {
          clearInterval(poll);
          fail('Test agente en vivo con fallos — revisa arriba');
          resolve(1);
          return;
        }
      }
      if (Date.now() > deadline) {
        clearInterval(poll);
        warn('Timeout monitor — el test sigue en VS Code');
        resolve(2);
      }
    }, 1500);

    if (existsSync(LOG)) {
      watchFile(LOG, { interval: 800 }, () => {
        const n = tailLog(pos);
        if (n > pos) { pos = n; lastActivity = Date.now(); }
      });
    }
  });
}

async function main() {
  section('Test agente en vivo — chat visible + debug log');
  const ver = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  info(`Versión: ${ver}`);

  if (!NO_UI) {
    try {
      run('npm run compile', { silent: true });
      ok('Compilado');
      run('bash scripts/install-latest.sh', { silent: true, timeout: 60_000 });
      ok(`Instalado v${ver}`);
    } catch (e) {
      fail(`Build/install: ${e.message}`);
      process.exit(1);
    }

    if (!existsSync(BOT)) {
      fail(`Abre el bot: ${BOT}`);
      process.exit(1);
    }

    writeFileSync(LIVE_FLAG, `${Date.now()}\n`);
    ok(`Flag AUTO: ${LIVE_FLAG}`);
    info(`Abriendo ${BOT} — test arranca al cargar el chat…`);
    info('MIRA VS Code: pestaña Agente — verás escribir letra a letra + fallos en rojo en el chat');
    try {
      spawn('code', ['-n', BOT], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      ok('Ventana VS Code lanzada — espera AUTO test (~30s)…');
      for (let i = 0; i < 45; i++) {
        if (existsSync(LOG) && readFileSync(LOG, 'utf8').includes('AUTO — test en vivo')) {
          ok('AUTO test detectado en log');
          break;
        }
        await sleep(2000);
      }
      if (process.env.DISPLAY) await focusVsCode();
    } catch {
      warn('code CLI falló — ejecuta manualmente:');
      console.log(`  LOCAL_COPILOT_RUN_AGENT_LIVE=1 code -n "${BOT}"`);
      console.log('  o Ctrl+Shift+P → Local: Test agente en vivo (Nekotina — chat visible)');
    }

    if (process.env.DISPLAY) {
      await focusVsCode();
    }
  } else {
    info('Modo --no-ui: solo monitorizando log…');
  }

  const code = await monitorLog(35);
  section('Últimas líneas del log');
  if (existsSync(LOG)) {
    readFileSync(LOG, 'utf8').split('\n').filter(Boolean).slice(-25).forEach((l) => console.log(`  ${l}`));
  }

  process.exit(code === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});