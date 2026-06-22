#!/usr/bin/env node
/**
 * E2E Agente — Ollama debe emitir ACCION y escribir archivos en disco.
 * Uso: node scripts/agent-e2e.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = 'http://127.0.0.1:11434';
const TEST_DIR = join('/tmp', `lc-agent-e2e-${Date.now()}`);

const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };

function parseActions(raw) {
  const actions = [];
  const re = /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n<<CONTENIDO>>([\s\S]*?)<<FIN>>/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    actions.push({
      type: m[1].toLowerCase() === 'crear' ? 'create' : 'modify',
      path: m[2].trim(),
      content: m[4].replace(/^\n/, '').replace(/\n$/, ''),
    });
  }
  return actions;
}

function applyActions(actions, root) {
  for (const a of actions) {
    const full = join(root, a.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, a.content, 'utf8');
  }
}

async function pickAgentModel() {
  const r = await fetch(`${OLLAMA}/api/tags`);
  const d = await r.json();
  const models = (d.models || []).map((x) => x.name);
  const norm = (n) => n.replace(/:latest$/i, '').toLowerCase();
  const order = ['qwen2.5-coder:14b', 'qwen2.5-coder:7b', 'local-copilot-turbo'];
  for (const want of order) {
    const hit = models.find((m) => norm(m) === norm(want) || m.startsWith(`${norm(want)}:`));
    if (hit) return hit;
  }
  return models[0];
}

const SYSTEM =
  'Eres Local Agent. PROGRAMAS en archivos con bloques ACCION.\n' +
  'FORMATO OBLIGATORIO:\n' +
  'EXPLICACION:\n<breve>\n\n' +
  'ACCION: CREAR | RUTA: public/index.html | MOTIVO: página\n' +
  '<<CONTENIDO>>\n<!DOCTYPE html>…\n<<FIN>>\n' +
  'PROHIBIDO decir "copia este código".';

const USER =
  'Crea una página web mínima: public/index.html + public/css/styles.css + public/js/main.js. ' +
  'Organiza por carpetas. Emite 3 bloques ACCION CREAR con contenido COMPLETO.';

console.log('══ Agente E2E — escritura en disco ══');
mkdirSync(TEST_DIR, { recursive: true });
writeFileSync(join(TEST_DIR, 'package.json'), '{"name":"e2e-test"}\n');

let model;
try {
  model = await pickAgentModel();
  ok(`Modelo agente: ${model}`);
} catch (e) {
  fail(`Ollama: ${e.message}`);
  process.exit(1);
}

let raw = '';
for (let attempt = 0; attempt < 3; attempt++) {
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: USER },
  ];
  if (attempt === 1) {
    messages.push({
      role: 'user',
      content: 'CORRECCIÓN: emite ACCION CREAR para public/index.html, public/css/styles.css y public/js/main.js con <<CONTENIDO>> completo.',
    });
  }
  if (attempt === 2) {
    messages.push({
      role: 'user',
      content:
        'ÚLTIMO INTENTO. Copia este formato rellenando el HTML/CSS/JS:\n' +
        'ACCION: CREAR | RUTA: public/index.html | MOTIVO: html\n<<CONTENIDO>>\n<!DOCTYPE html><html><head><link rel="stylesheet" href="css/styles.css"></head><body><h1>E2E</h1><script src="js/main.js"></script></body></html>\n<<FIN>>\n',
    });
  }

  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature: 0.15, num_predict: 4096 },
    }),
  });
  const d = await r.json();
  raw = d.message?.content || '';
  const actions = parseActions(raw);
  if (actions.length >= 1) {
    applyActions(actions, TEST_DIR);
    ok(`${actions.length} ACCION(es) parseadas (intento ${attempt + 1})`);
    for (const a of actions) {
      const full = join(TEST_DIR, a.path);
      existsSync(full) ? ok(`Escrito: ${a.path} (${readFileSync(full, 'utf8').length} bytes)`) : fail(`No existe: ${a.path}`);
    }
    const html = join(TEST_DIR, 'public/index.html');
    if (existsSync(html) && readFileSync(html, 'utf8').includes('<')) {
      ok('public/index.html válido');
    } else {
      fail('Falta public/index.html con HTML');
    }
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
    console.log('\n══ Agente E2E OK ══');
    process.exit(process.exitCode || 0);
  }
  console.log(`  ⚠️  Intento ${attempt + 1}: sin ACCION (${raw.slice(0, 120)}…)`);
}

fail('Ollama no generó bloques ACCION tras 3 intentos');
try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
process.exit(1);