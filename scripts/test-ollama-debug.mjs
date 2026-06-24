#!/usr/bin/env node
/**
 * Depuración completa: Ollama + extensión + APIs del bot Nekotina
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = 'http://127.0.0.1:11434';
const BOT = '/home/david/Escritorio/nekotina-bot';

let errors = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); errors++; };
const info = (m) => console.log(`  ℹ️  ${m}`);
const section = (t) => console.log(`\n══ ${t} ══`);

async function ollamaChat(model, prompt, system) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      stream: false,
      options: { temperature: 0.05, num_predict: 2000 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).message?.content || '';
}

function parseAccion(raw) {
  const m = raw.match(/<<CONTENIDO>>([\s\S]*?)<<FIN>>/);
  if (m) return m[1].trim();
  const code = raw.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/);
  return code?.[1]?.trim() ?? null;
}

section('1. Ollama — conexión');
try {
  const tags = await (await fetch(`${OLLAMA}/api/tags`)).json();
  ok(`${tags.models?.length ?? 0} modelos disponibles`);
  const model = tags.models?.find((m) => m.name === 'qwen2.5-coder:14b')?.name ||
    tags.models?.find((m) => m.name.includes('qwen2.5-coder'))?.name;
  if (!model) { fail('sin modelo coder'); process.exit(1); }
  info(`Modelo agente: ${model}`);

  section('2. Ollama — formato ACCION (1 archivo)');
  const sys =
    'SOLO UN bloque ACCION:\nACCION: CREAR | RUTA: x | MOTIVO: y\n<<CONTENIDO>>\ncódigo\n<<FIN>>';
  const raw = await ollamaChat(
    model,
    'ARCHIVO=commands/ping.js\nComando /ping discord.js v14 SlashCommandBuilder',
    sys
  );
  const content = parseAccion(raw);
  if (content && /SlashCommandBuilder|ping/i.test(content)) {
    ok('Ollama emite ACCION parseable para comando Discord');
  } else if (/\bACCION\s*:/i.test(raw) && !content) {
    fail('Ollama menciona ACCION pero formato no parseable');
    info(`Respuesta (200 chars): ${raw.slice(0, 200)}`);
  } else if (/\bPLAN\s*:/i.test(raw) && !/\bACCION\s*:/i.test(raw)) {
    fail('Ollama solo PLAN — extensión activará modo 1-archivo');
  } else {
    fail('Ollama sin ACCION reconocible');
    info(raw.slice(0, 300));
  }

  section('3. Extensión — bundle depuración');
  execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });
  const bundle = readFileSync(join(ROOT, 'dist/extension.js'), 'utf8');
  const markers = [
    'diagnoseAgentFailure', 'shouldUseOneFileMode', 'generateSingleFileBatch',
    'injectMissingScaffolds', 'getProjectScaffold', 'autoFixBrokenFiles',
  ];
  for (const m of markers) bundle.includes(m) ? ok(m) : fail(`falta ${m}`);

  section('4. Bot Escritorio — validación');
  if (!existsSync(BOT)) { fail('no existe ~/Escritorio/nekotina-bot'); }
  else {
    try {
      const out = execSync('node scripts/validate.js', { cwd: BOT, encoding: 'utf8' });
      out.includes('🎉') ? ok('nekotina-bot validate.js OK') : fail('validate con avisos');
    } catch (e) {
      fail('validate.js falló');
      console.log(e.stdout || e.message);
    }
  }

  section('5. APIs externas (como usa el bot)');
  const apis = [
    ['Open Trivia', 'https://opentdb.com/api.php?amount=1'],
    ['Open-Meteo', 'https://api.open-meteo.com/v1/forecast?latitude=40.4&longitude=-3.7&current=temperature_2m'],
    ['JokeAPI', 'https://v2.jokeapi.dev/joke/Any?safe-mode'],
    ['PokéAPI', 'https://pokeapi.co/api/v2/pokemon/pikachu'],
    ['meme-api', 'https://meme-api.com/gimme'],
    ['nekos.best', 'https://nekos.best/api/v2/neko'],
    ['nekobot.xyz', 'https://nekobot.xyz/api/image?type=neko'],
  ];
  for (const [name, url] of apis) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'Local-Copilot-Debug/1.0' },
      });
      r.ok ? ok(`${name} (${r.status})`) : fail(`${name} HTTP ${r.status}`);
    } catch (e) {
      fail(`${name}: ${e.message}`);
    }
  }

  section('6. Bot — arranque rápido');
  try {
    const out = execSync('timeout 6 node index.js 2>&1', { cwd: BOT, encoding: 'utf8' });
    /online|conectado|slash commands/i.test(out) ? ok('bot arranca y conecta') : fail('arranque sin confirmación');
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    /online|Ayitax|slash commands/i.test(out) ? ok('bot arranca (timeout esperado)') : fail(`arranque: ${out.slice(0, 200)}`);
  }

  section('7. Prueba API REST (extensión 1-archivo)');
  try {
    execSync('node scripts/test-agent-other.mjs', { cwd: ROOT, stdio: 'pipe', timeout: 600_000 });
    ok('test-agent-other.mjs OK');
  } catch (e) {
    fail('test-agent-other falló');
    if (e.stdout) console.log(e.stdout.toString().slice(-500));
  }

} catch (e) {
  fail(`Error general: ${e.message}`);
}

console.log(errors ? `\n⚠️ Depuración: ${errors} problema(s)` : '\n🎉 Depuración completa: Ollama + extensión + bot OK');
process.exit(errors ? 1 : 0);