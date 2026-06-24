#!/usr/bin/env node
/**
 * Prueba: API REST Express (distinto a Nekotina).
 * Flujo extensión v1.0.46: Ollama 1-archivo → scaffold si falla → validar → borrar si OK.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = 'http://127.0.0.1:11434';
const TEST_DIR = '/home/david/test-agent-api-rest-temp';

const USER_PROMPT =
  'Crea una API REST con Express: CRUD tareas en memoria. ' +
  'package.json, server.js, routes/tareas.js, README.md. Implementa ya.';

const FILES = ['package.json', 'routes/tareas.js', 'server.js', 'README.md'];

const SCAFFOLDS = {
  'package.json': `{
  "name": "api-rest",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "^4.21.0" }
}`,
  'server.js': `const express = require('express');
const tareasRouter = require('./routes/tareas');
const app = express();
app.use(express.json());
app.use('/api/tareas', tareasRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.listen(3000, () => console.log('API :3000'));
`,
  'routes/tareas.js': `const express = require('express');
const router = express.Router();
let tareas = [], nextId = 1;
router.get('/', (_req, res) => res.json(tareas));
router.post('/', (req, res) => {
  const t = { id: nextId++, titulo: req.body.titulo, hecha: false };
  tareas.push(t); res.status(201).json(t);
});
router.delete('/:id', (req, res) => {
  const i = tareas.findIndex((x) => x.id === Number(req.params.id));
  if (i < 0) return res.status(404).json({ error: 'No encontrada' });
  tareas.splice(i, 1); res.status(204).end();
});
module.exports = router;
`,
  'README.md': '# API REST\n\n`npm install && npm start`\n',
};

const STRICT_ONE =
  'SOLO UN bloque ACCION:\nACCION: CREAR | RUTA: x | MOTIVO: y\n<<CONTENIDO>>\ncódigo\n<<FIN>>';

const HINTS = {
  'package.json': 'JSON con express dependency',
  'server.js': 'Express app, /api/tareas, /api/health',
  'routes/tareas.js': 'Router CRUD memoria',
};

let errors = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); errors++; };
const info = (m) => console.log(`  ℹ️  ${m}`);

function parseAction(raw) {
  const m = raw.match(/<<CONTENIDO>>([\s\S]*?)<<FIN>>/);
  if (!m) {
    const code = raw.match(/```(?:json|javascript|js)?\s*\n([\s\S]*?)```/);
    if (code) return code[1].trim();
    return null;
  }
  let c = m[1].trim();
  if (c.startsWith('```')) c = c.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '');
  return c.length >= 10 ? c : null;
}

async function genOne(model, file) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: STRICT_ONE },
        { role: 'user', content: `ARCHIVO=${file}\n${USER_PROMPT}\n${HINTS[file] || ''}` },
      ],
      stream: false,
      options: { temperature: 0.02, num_predict: 4500 },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  return parseAction((await r.json()).message?.content || '');
}

function validateProject() {
  for (const f of ['package.json', 'server.js', 'routes/tareas.js']) {
    existsSync(join(TEST_DIR, f)) ? ok(`${f} existe`) : fail(`falta ${f}`);
  }
  try {
    execSync('node --check server.js', { cwd: TEST_DIR, stdio: 'pipe' });
    ok('sintaxis server.js');
  } catch { fail('sintaxis server.js'); }
  try {
    execSync('node --check routes/tareas.js', { cwd: TEST_DIR, stdio: 'pipe' });
    ok('sintaxis routes/tareas.js');
  } catch { fail('sintaxis routes/tareas.js'); }
  if (existsSync(join(TEST_DIR, 'package.json'))) {
    const pkg = JSON.parse(readFileSync(join(TEST_DIR, 'package.json'), 'utf8'));
    pkg.dependencies?.express ? ok('express en package.json') : fail('falta express');
  }
}

console.log('══ Prueba extensión — API REST (proyecto distinto) ══\n');
execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });
ok('compilación v1.0.46');

const tags = await (await fetch(`${OLLAMA}/api/tags`)).json();
const model = tags.models?.find((m) => m.name === 'qwen2.5-coder:14b')?.name ||
  tags.models?.find((m) => m.name.includes('qwen2.5-coder'))?.name || tags.models?.[0]?.name;
info(`Modelo: ${model}`);

if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(join(TEST_DIR, 'routes'), { recursive: true });

let ollamaOk = 0;
let scaffoldOk = 0;

console.log('\n── Modo 1-archivo + scaffold (extensión) ──');
for (const file of FILES) {
  process.stdout.write(`  📄 ${file}… `);
  let content = null;
  for (let i = 0; i < 3 && !content; i++) content = await genOne(model, file);
  if (content) {
    writeFileSync(join(TEST_DIR, file), content);
    console.log('🧠 Ollama');
    ollamaOk++;
  } else if (SCAFFOLDS[file]) {
    writeFileSync(join(TEST_DIR, file), SCAFFOLDS[file]);
    console.log('📐 scaffold');
    scaffoldOk++;
  } else {
    console.log('❌');
  }
}

info(`Ollama directo: ${ollamaOk}/${FILES.length} | Scaffold: ${scaffoldOk}`);

console.log('\n── Validación proyecto final ──');
validateProject();

const passed = errors === 0;
if (passed) {
  console.log('\n🎉 EXTENSIÓN OK — proyecto API REST válido');
  rmSync(TEST_DIR, { recursive: true, force: true });
  ok(`Carpeta borrada: ${TEST_DIR}`);
} else {
  console.log(`\n⚠️ ${errors} fallo(s) — carpeta conservada: ${TEST_DIR}`);
}

process.exit(passed ? 0 : 1);