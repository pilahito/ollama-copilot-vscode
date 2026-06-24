#!/usr/bin/env node
/**
 * Abre VS Code con nekotina-bot, instala extensión y lanza BATALLA (UI visible).
 *
 * Uso: npm run test:battle
 *      node scripts/launch-battle-test.mjs
 */
import { readFileSync, existsSync, writeFileSync, watchFile, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = '/tmp/local-copilot-debug.log';
const BATTLE_FLAG = '/tmp/local-copilot-battle-ready.flag';
const BOT = '/home/david/Escritorio/nekotina-bot';

const ok = (m) => console.log(`\x1b[32m  ✅ ${m}\x1b[0m`);
const fail = (m) => console.log(`\x1b[31m  ❌ ${m}\x1b[0m`);
const info = (m) => console.log(`\x1b[36m  ℹ️  ${m}\x1b[0m`);
const section = (t) => console.log(`\n\x1b[1m══ ${t} ══\x1b[0m`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tailLog(fromByte = 0) {
  if (!existsSync(LOG)) return fromByte;
  const text = readFileSync(LOG, 'utf8');
  const chunk = text.slice(fromByte);
  if (!chunk) return text.length;
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    if (/✗|FALLO|falló|Aún no listo/i.test(line)) fail(`LOG: ${line.trim()}`);
    else if (/battle|agent-live|escribiendo|userSend/i.test(line)) info(`LOG: ${line.trim()}`);
    else if (/✓|LISTO PARA LA BATALLA|ready=true/i.test(line)) ok(`LOG: ${line.trim()}`);
  }
  return text.length;
}

async function monitorBattle(maxMin = 90) {
  section('Monitor batalla — mira VS Code: chat Agente a la DERECHA');
  info('Verás: texto escribiéndose + panel morado + mensajes rojo/verde');
  let pos = existsSync(LOG) ? statSync(LOG).size : 0;
  const deadline = Date.now() + maxMin * 60_000;

  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (existsSync(LOG)) {
        const n = tailLog(pos);
        if (n > pos) pos = n;
        const tail = readFileSync(LOG, 'utf8');
        if (/LISTO PARA LA BATALLA|readyForBattle=true|ready=true/.test(tail)) {
          clearInterval(poll);
          ok('🏆 Batalla completada — listo para Discord');
          resolve(0);
          return;
        }
        if (/FIN BATALLA: ready=false/.test(tail)) {
          clearInterval(poll);
          fail('Batalla terminó con fallos — revisa chat rojo');
          resolve(1);
          return;
        }
      }
      if (Date.now() > deadline) {
        clearInterval(poll);
        info('Timeout monitor — el test sigue en VS Code');
        resolve(2);
      }
    }, 2000);

    if (existsSync(LOG)) {
      watchFile(LOG, { interval: 1000 }, () => {
        const n = tailLog(pos);
        if (n > pos) pos = n;
      });
    }
  });
}

async function main() {
  section('Batalla Nekotina — extensión visible + agente Ollama');
  const ver = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  info(`Versión extensión: ${ver}`);

  if (!existsSync(BOT)) {
    fail(`No existe ${BOT}`);
    process.exit(1);
  }

  try {
    execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });
    execSync('bash scripts/install-latest.sh', { cwd: ROOT, stdio: 'pipe', timeout: 90_000 });
    ok(`Instalado v${ver}`);
  } catch (e) {
    fail(`Build/install: ${e.message}`);
    process.exit(1);
  }

  info(`Abriendo VS Code con ${BOT}`);
  info('MIRA: icono demonio (izq) → chat DERECHA → pestaña Agente');

  try {
    spawn('code', ['-n', BOT], { detached: true, stdio: 'ignore' }).unref();
    ok('VS Code (ventana nueva) — espera 8s y activa batalla…');
    await sleep(8000);
    writeFileSync(BATTLE_FLAG, `${Date.now()}\n`);
    ok(`Flag batalla: ${BATTLE_FLAG} (la extensión lo detecta en ~5s)`);
  } catch {
    fail('No se pudo lanzar code CLI');
    console.log(`  Manual: code "${BOT}" y Ctrl+Shift+P → Local: Batalla Nekotina`);
    process.exit(1);
  }

  for (let i = 0; i < 40; i++) {
    if (existsSync(LOG) && readFileSync(LOG, 'utf8').includes('[battle] AUTO')) {
      ok('Batalla AUTO detectada en log');
      break;
    }
    await sleep(2000);
  }

  const code = await monitorBattle(120);
  section('Últimas líneas log');
  if (existsSync(LOG)) {
    readFileSync(LOG, 'utf8').split('\n').filter(Boolean).slice(-20).forEach((l) => console.log(`  ${l}`));
  }
  process.exit(code === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});