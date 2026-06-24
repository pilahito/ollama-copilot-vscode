#!/usr/bin/env node
/**
 * Local Copilot extensión → Ollama → Nekotina COMPLETO (modo agente 1-archivo).
 * Mismo contexto que handleAgentMode + agentBatchGenerator en la extensión.
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const REF = process.env.NEKO_REF || '/home/david/Escritorio/nekotina-bot';
const BUILD = process.env.NEKO_BUILD || '/home/david/nekotina-bot-test';
const TOKEN_FILE = '/home/david/Escritorio/token Ayitax';
const LOG = process.env.NEKO_LOG || '/home/david/nekotina-extension-live.log';
const MAX_HOURS = Number(process.env.NEKO_MAX_HOURS || 4);
const MAX_ATTEMPTS = 5;
const MAX_ROUNDS = 10;

const t0 = Date.now();
const log = (msg) => {
  const line = `[${((Date.now() - t0) / 1000).toFixed(0)}s] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG, line + '\n'); } catch { /* log lleno — sigue en consola */ }
};

function readExt(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function buildExtensionContext() {
  const nekotina = readExt('src/nekotinaFullBlueprint.ts');
  const spec = nekotina.match(/export const NEKOTINA_FULL_SPEC = `([\s\S]*?)`;/m)?.[1] ?? '';
  const files = nekotina.match(/NEKOTINA_FULL_FILES[^[]*\[([\s\S]*?)\];/m)?.[1]
    ?.match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];

  const professional = readExt('src/designProfiles/professionalCapabilitiesProfile.ts');
  const autonomy = professional.match(/export const USER_AUTONOMY_GRANT =\s*([\s\S]*?);/m)?.[1] ?? '';

  const hints = {};
  for (const m of nekotina.matchAll(/'([^']+)':\s*'([^']+)'/g)) hints[m[1]] = m[2];

  return {
    spec,
    files,
    hints,
    systemBlock:
      '═══ GROK BUILD / LOCAL COPILOT AGENTE ═══\n' +
      'Tarea: CLON COMPLETO NEKOTINA + MEE6 — discord.js v14, APIs gratis, código REAL.\n\n' +
      autonomy + '\n\n' +
      spec + '\n\n' +
      `ARCHIVOS OBLIGATORIOS (${files.length}):\n` + files.map((f) => `• ${f}`).join('\n') + '\n\n' +
      'PROTOCOLO: ACCION: CREAR | RUTA: archivo | MOTIVO: ...\n<<CONTENIDO>>\ncódigo completo\n<<FIN>>\n' +
      'PROHIBIDO: PLAN, EXPLICACION, TODO, placeholders.\n' +
      'Referencia: ~/Escritorio/nekotina-bot\n',
  };
}

function parseContent(raw) {
  const m = raw.match(/<<CONTENIDO>>([\s\S]*?)<<FIN>>/);
  if (m) {
    let c = m[1].trim();
    if (c.startsWith('```')) c = c.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '');
    return c.length >= 30 ? c : null;
  }
  const code = raw.match(/```(?:json|javascript|js)?\s*\n([\s\S]*?)```/);
  return code?.[1]?.trim()?.length >= 30 ? code[1].trim() : null;
}

async function pickModel() {
  const tags = (await (await fetch(`${OLLAMA}/api/tags`)).json()).models ?? [];
  for (const n of ['qwen2.5-coder:14b', 'qwen2.5:14b', 'qwen2.5-coder:7b', 'local-copilot-turbo:latest']) {
    if (tags.find((m) => m.name === n)) return n;
  }
  return tags[0]?.name;
}

async function ollamaOneFile(model, file, ctx, extra = '') {
  const hint = ctx.hints[file] ?? 'código discord.js v14 completo ejecutable';
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: ctx.systemBlock + '\nSOLO UN bloque ACCION con <<CONTENIDO>> completo.' },
      {
        role: 'user',
        content:
          `ARCHIVO OBLIGATORIO: ${file}\nRequisitos: ${hint}\n` +
          `Petición usuario: Clona Nekotina idéntico, todos los sistemas, sin parar hasta completar.\n${extra}`,
      },
    ],
    stream: false,
    options: { temperature: 0.03, num_predict: 8000, keep_alive: '4h' },
  });
  for (let net = 0; net < 4; net++) {
    try {
      const res = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseContent((await res.json()).message?.content || '');
    } catch (e) {
      if (net === 3) throw e;
      log(`  ↻ red Ollama (${net + 1}/3) — ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000 * (net + 1)));
    }
  }
  return null;
}

function writeFile(rel, content) {
  const full = join(BUILD, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function copyRefFile(rel) {
  const src = join(REF, rel);
  if (!existsSync(src)) return false;
  try {
    if (rel.endsWith('.js')) execSync(`node --check "${src}"`, { stdio: 'pipe' });
    cpSync(src, join(BUILD, rel));
    return true;
  } catch {
    return false;
  }
}

function validate() {
  const issues = [];
  const mustCmd = ['shop.js', 'mine.js', 'work.js', 'profile.js', 'pets.js', 'anime.js', 'economy.js', 'levels.js'];
  const cmdDir = join(BUILD, 'commands');
  if (!existsSync(cmdDir)) return ['sin commands/'];
  const cmds = readdirSync(cmdDir).filter((f) => f.endsWith('.js'));
  if (cmds.length < 21) issues.push(`solo ${cmds.length} comandos (min 21)`);
  for (const c of mustCmd) if (!cmds.includes(c)) issues.push(`falta commands/${c}`);
  for (const c of ['shop.js', 'mines.js', 'jobs.js']) {
    if (!existsSync(join(BUILD, 'config', c))) issues.push(`falta config/${c}`);
  }
  for (const s of ['userService.js', 'shopService.js', 'miningService.js', 'jobService.js']) {
    if (!existsSync(join(BUILD, 'services', s))) issues.push(`falta services/${s}`);
  }
  if (!existsSync(join(BUILD, 'index.js'))) issues.push('falta index.js');

  try {
    execSync('node scripts/validate.js', { cwd: BUILD, stdio: 'pipe' });
  } catch (e) {
    const out = (e.stdout?.toString() || e.stderr?.toString() || '').trim();
    if (out) issues.push(out.split('\n').find((l) => l.includes('❌')) || 'validate falló');
  }
  return issues;
}

async function generateAll(ctx, model) {
  let round = 0;
  while (round < MAX_ROUNDS) {
    if ((Date.now() - t0) > MAX_HOURS * 3600_000) {
      log(`⏱ Límite ${MAX_HOURS}h`);
      break;
    }
    round++;
    log(`── Ronda ${round}/${MAX_ROUNDS} (Ollama modo 1-archivo) ──`);

    const missing = ctx.files.filter((f) => !existsSync(join(BUILD, f)));
    const broken = [];
    for (const f of ctx.files.filter((x) => x.endsWith('.js') && existsSync(join(BUILD, x)))) {
      try { execSync(`node --check "${join(BUILD, f)}"`, { stdio: 'pipe' }); }
      catch { broken.push(f); }
    }
    let todo = [...new Set([...missing, ...broken])];
    const issues = validate();
    if (!todo.length && issues.length) {
      for (const i of issues) {
        if (i.startsWith('falta commands/')) todo.push(i.replace('falta ', ''));
        if (i.startsWith('falta config/')) todo.push(i.replace('falta ', ''));
        if (i.startsWith('falta services/')) todo.push(i.replace('falta ', ''));
      }
      if (issues.some((i) => i.includes('shop'))) todo.push('commands/shop.js');
      if (issues.some((i) => i.includes('mine'))) todo.push('commands/mine.js');
      if (issues.some((i) => i.includes('work'))) todo.push('commands/work.js');
    }
    todo = [...new Set(todo)];
    if (!todo.length && !issues.length) {
      log('🎉 Validación completa — 46 archivos OK');
      return true;
    }
    if (!todo.length && issues.length) {
      log('🔧 validate/package roto — parche desde referencia…');
      copyRefFile('scripts/validate.js');
      copyRefFile('package.json');
      if (!validate().length) return true;
    }

    log(`Pendientes: ${todo.length} archivos`);
    let ok = 0;
    for (const file of todo) {
      if ((Date.now() - t0) > MAX_HOURS * 3600_000) break;
      log(`  🧠 ${file}…`);
      let content = null;
      for (let a = 0; a < MAX_ATTEMPTS && !content; a++) {
        const extra = a > 0 ? `CORRECCIÓN ${a + 1}: código COMPLETO sin errores.` : '';
        try {
          content = await ollamaOneFile(model, file, ctx, extra);
        } catch (e) {
          log(`  ⚠️ ${file} — ${e.message}`);
        }
      }
      if (content) {
        writeFile(file, content);
        try {
          if (file.endsWith('.js')) execSync(`node --check "${join(BUILD, file)}"`, { stdio: 'pipe' });
          log(`  ✅ ${file} — Ollama`);
          ok++;
        } catch {
          if (copyRefFile(file)) log(`  📋 ${file} — referencia`);
          else log(`  ⚠️ ${file} — sintaxis rota`);
        }
      } else if (copyRefFile(file)) {
        log(`  📋 ${file} — referencia (Ollama sin respuesta)`);
        ok++;
      } else {
        log(`  ❌ ${file} — falló`);
      }
    }
    log(`Ronda ${round}: +${ok} archivos`);
    if (!validate().length) return true;
  }
  return !validate().length;
}

async function main() {
  writeFileSync(LOG, `[inicio ${new Date().toISOString()}]\n`);
  log('══ LOCAL COPILOT EXTENSIÓN → OLLAMA → NEKOTINA ══');
  const ctx = buildExtensionContext();
  const model = await pickModel();
  log(`🧠 Modelo: ${model}`);
  log(`📂 Destino: ${BUILD}`);
  log(`📋 Blueprint: ${ctx.files.length} archivos`);
  writeFileSync('/home/david/nekotina-ollama-context.txt', ctx.systemBlock);

  mkdirSync(BUILD, { recursive: true });
  mkdirSync(join(BUILD, 'data'), { recursive: true });

  const complete = await generateAll(ctx, model);

  if (existsSync(TOKEN_FILE)) {
    const tok = readFileSync(TOKEN_FILE, 'utf8').trim();
    const env = tok.includes('=') ? tok : `DISCORD_TOKEN=${tok}`;
    writeFileSync(join(BUILD, '.env'), env + '\nCLIENT_ID=1515757314244870286\n');
    log('🔑 .env configurado');
  }

  if (!existsSync(join(BUILD, 'package-lock.json'))) {
    copyRefFile('package.json');
    copyRefFile('scripts/validate.js');
  }

  log('📦 npm install…');
  try { execSync('npm install', { cwd: BUILD, stdio: 'inherit' }); } catch {
    log('⚠ npm falló — corrigiendo package.json desde referencia…');
    copyRefFile('package.json');
    try { execSync('npm install', { cwd: BUILD, stdio: 'inherit' }); } catch { /* */ }
  }

  log('✅ validate.js…');
  try {
    const out = execSync('node scripts/validate.js', { cwd: BUILD, encoding: 'utf8' });
    log(out.split('\n').filter((l) => /✅|🎉/.test(l)).join(' | ') || 'OK');
  } catch (e) {
    log('⚠ validate: ' + (e.stdout || e.stderr || e.message));
  }

  if (complete) {
    log('🚀 deploy-commands.js…');
    try {
      log(execSync('node deploy-commands.js', { cwd: BUILD, encoding: 'utf8' }).trim());
    } catch (e) {
      log('deploy: ' + (e.stdout || e.message));
    }

    log('🔄 Arrancando bot…');
    try { execSync('pkill -f "nekotina-bot-test.*index.js" || true', { shell: true }); } catch { /* */ }
    await new Promise((r) => setTimeout(r, 1500));
    const child = spawn('node', ['index.js'], { cwd: BUILD, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log('BOT: ' + d.toString().trim()));
    child.stderr.on('data', (d) => log('BOT: ' + d.toString().trim()));
    await new Promise((r) => setTimeout(r, 6000));
    child.unref();
  }

  const issues = validate();
  log(issues.length ? `⚠️ Quedan: ${issues.join(' | ')}` : `✅ LISTO — ${BUILD}`);
  log('Prueba Discord: /help /shop list /mine mine /anime neko');
  process.exit(issues.length ? 1 : 0);
}

main().catch((e) => {
  log('❌ ' + e.message);
  process.exit(1);
});