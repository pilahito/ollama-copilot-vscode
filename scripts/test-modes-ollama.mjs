#!/usr/bin/env node
/**
 * Prueba en vivo: Chat, Profesor y Agente contra Ollama.
 * Verifica defensa anti-rechazo y que el agente emite ACCION al pedir "créame".
 */
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = process.env.OLLAMA_HOST?.replace(/\/$/, '') || 'http://127.0.0.1:11434';
const require = createRequire(import.meta.url);

let errors = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); errors++; };
const section = (t) => console.log(`\n══ ${t} ══`);

execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });

const {
  buildOllamaDefenseBlock,
  AGENT_SELF_TEST_SYSTEM_PROMPT,
  looksLikeRefusal,
  hasAgentCreationOutput,
  hasValidAccionBlock,
  looksLikeCreationResponse,
} = require(join(ROOT, 'dist/ollamaDefense.js'));

async function ollamaChat(model, system, user, agent = false) {
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
      options: {
        temperature: agent ? 0.05 : 0.2,
        num_predict: agent ? 2500 : 1500,
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).message?.content?.trim() || '';
}

section('1. Ollama — conexión');
let model = 'qwen2.5-coder:14b';
try {
  const tags = await (await fetch(`${OLLAMA}/api/tags`)).json();
  const found =
    tags.models?.find((m) => m.name === 'qwen2.5-coder:14b')?.name ||
    tags.models?.find((m) => m.name.includes('qwen2.5-coder'))?.name ||
    tags.models?.[0]?.name;
  if (!found) {
    fail('sin modelos en Ollama');
    process.exit(1);
  }
  model = found;
  ok(`${tags.models.length} modelo(s) — usando ${model}`);
} catch (e) {
  fail(`Ollama no responde en ${OLLAMA}: ${e.message}`);
  process.exit(1);
}

const tests = [
  {
    label: 'Chat — defensa + código',
    system:
      buildOllamaDefenseBlock('chat') +
      'Eres Local Copilot en modo Chat. Respondes en español con código ejecutable.',
    user:
      'Créame un comando Discord /ping con discord.js v14. Código en bloque ```javascript, breve.',
    check: (raw) => {
      if (looksLikeRefusal(raw)) return 'rechazo detectado';
      if (!looksLikeCreationResponse(raw)) return 'sin código útil';
      return null;
    },
  },
  {
    label: 'Profesor — enseñar a crear',
    system:
      buildOllamaDefenseBlock('teacher') +
      'Eres Profesor experto. Enseñas con pasos y código ejecutable en español.',
    user: 'Enséñame a crear suma.js con function suma(a,b){ return a+b }. Corto.',
    check: (raw) => {
      if (looksLikeRefusal(raw)) return 'rechazo detectado';
      if (!/suma|function|return/i.test(raw)) return 'no enseña suma';
      return null;
    },
  },
  {
    label: 'Agente — créame con ACCION',
    system: AGENT_SELF_TEST_SYSTEM_PROMPT,
    user:
      'Créame el archivo selftest-demo.js con function suma(a,b){ return a+b } y module.exports = { suma }.',
    agent: true,
    check: (raw) => {
      if (looksLikeRefusal(raw)) return 'rechazo detectado';
      if (!hasAgentCreationOutput(raw)) return 'sin ACCION ni código';
      if (!/suma|module\.exports/i.test(raw)) return 'ACCION sin suma';
      if (!hasValidAccionBlock(raw)) {
        console.log('  ℹ️  ACCION con markdown — la extensión lo parsea pero prefiere <<CONTENIDO>>');
      }
      return null;
    },
  },
];

for (const t of tests) {
  section(t.label);
  try {
    const raw = await ollamaChat(model, t.system, t.user, t.agent);
    const err = t.check(raw);
    if (err) {
      fail(err);
      console.log(`  ↳ ${raw.slice(0, 280).replace(/\n/g, ' ')}…`);
    } else {
      ok('OK — Ollama defiende y responde útil');
    }
  } catch (e) {
    fail(e.message);
  }
}

section('Resumen');
if (errors === 0) {
  console.log('  🎉 Chat, Profesor y Agente OK con Ollama');
  process.exit(0);
}
console.log(`  ⚠️  ${errors} fallo(s) — revisa prompts o modelo`);
process.exit(1);