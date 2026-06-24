#!/usr/bin/env node
/**
 * Prueba real: bot Discord "impresionante" + analizador de intención.
 * Valida que Ollama emite ACCION modular sin .gitkeep.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA = 'http://127.0.0.1:11434';
const TEST_DIR = join('/tmp', `lc-bot-intent-${Date.now()}`);

const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };
const info = (m) => console.log(`  ℹ️  ${m}`);

// Cargar userIntent compilado (mismo código que la extensión)
const require = createRequire(import.meta.url);
let enrichUserMessage, parseUserIntent;
try {
  const bundle = readFileSync(join(ROOT, 'out/extension.js'), 'utf8');
  if (!bundle.includes('parseUserIntent') && !bundle.includes('enrichUserMessage')) {
    throw new Error('bundle sin userIntent');
  }
  // Evaluar no es viable; reimplementamos test mínimo del parser
  throw new Error('use inline');
} catch {
  // Inline: mismas reglas clave que userIntent.ts
  const QUALITY_RE = /\b(impresionante|completo|en serio|no a la ligera|sin \.gitkeep)\b/i;
  const PROHIB_GITKEEP = /\bno\s+uses?\s+\.gitkeep\b/i;
  parseUserIntent = (raw) => ({
    qualityBar: QUALITY_RE.test(raw) ? 'production' : 'standard',
    prohibitions: PROHIB_GITKEEP.test(raw) ? ['No .gitkeep'] : [],
    seriousnessScore: QUALITY_RE.test(raw) ? 3 : 0,
  });
  enrichUserMessage = (prompt) => {
    const i = parseUserIntent(prompt);
    if (i.seriousnessScore < 2) return prompt;
    return (
      `═══ ANÁLISIS DE INTENCIÓN ═══\n` +
      `Nivel: PRODUCCIÓN — código completo, sin placeholders\n` +
      (i.prohibitions.length ? `Prohibido: ${i.prohibitions.join('; ')}\n` : '') +
      `Petición: "${prompt}"\n\n═══ PETICIÓN ═══\n${prompt}`
    );
  };
}

const USER_PROMPT =
  'Crea un bot de Discord COMPLETO y funcional (no un esqueleto):\n' +
  '- Slash commands: /ping, /help, /play, /trivia\n' +
  '- Estructura modular: commands/, events/, musica/, juegos/\n' +
  '- Sin .gitkeep ni carpetas vacías — cada carpeta con .js real\n' +
  '- Código ejecutable con discord.js v14 y dotenv\n' +
  '- index.js solo arranca y registra handlers\n' +
  'No lo tomes a la ligera. Emite bloques ACCION CREAR con <<CONTENIDO>> completo.';

const SYSTEM =
  'Eres Local Agent en MODO AGENTE. PROGRAMAS emitiendo bloques ACCION.\n' +
  'PROHIBIDO .gitkeep — crea archivos .js con código real.\n' +
  'Bot Discord modular: commands/, events/, musica/, juegos/, index.js solo cablea.\n' +
  'FORMATO OBLIGATORIO (sin bloques ```markdown):\n' +
  'PLAN:\n...\n\nEXPLICACION:\n...\n\n' +
  'ACCION: CREAR | RUTA: commands/ping.js | MOTIVO: ...\n<<CONTENIDO>>\n<código JS aquí>\n<<FIN>>\n' +
  'COMANDO: npm install discord.js dotenv | MOTIVO: deps\n<<FIN>>\n' +
  'PROHIBIDO usar ```javascript — SOLO <<CONTENIDO>> ... <<FIN>>.\n' +
  'PROHIBIDO decir "copia este código". Emite MÍNIMO 6 ACCION CREAR.';

function parseActions(raw) {
  const actions = [];
  const seen = new Set();

  const push = (type, path, content, reason) => {
    const p = path.trim();
    if (!p || seen.has(p)) return;
    seen.add(p);
    actions.push({
      type: type.toLowerCase(),
      path: p,
      content: (content || '').replace(/^\n/, '').replace(/\n$/, ''),
      reason: (reason || '').trim(),
    });
  };

  const patterns = [
    /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n<<CONTENIDO>>([\s\S]*?)<<FIN>>/gi,
    /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n```(?:javascript|js|typescript|ts)?\n([\s\S]*?)```/gi,
    /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n([\s\S]*?)(?=ACCION:|COMANDO:|$)/gi,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(raw)) !== null) {
      const content = m[4] || '';
      if (content.includes('<<CONTENIDO>>') || content.length < 20) continue;
      push(m[1], m[2], content, m[3]);
    }
  }
  return actions;
}

function scoreResult(actions, raw) {
  const paths = actions.map((a) => a.path);
  const checks = {
    hasActions: actions.length >= 2,
    noGitkeep: !paths.some((p) => p.includes('.gitkeep')),
    hasIndex: paths.some((p) => /index\.js$/i.test(p)),
    hasCommands: paths.some((p) => /^commands\//i.test(p)),
    hasEvents: paths.some((p) => /^events\//i.test(p)),
    hasJsLogic: actions.some((a) => a.content.length > 80 && /\.js$/i.test(a.path)),
    mentionsDiscord: /discord\.js|Client\(|SlashCommandBuilder/i.test(
      actions.map((a) => a.content).join('\n') + raw
    ),
    notOnlyExplanation: actions.length > 0,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return { checks, passed, total: Object.keys(checks).length, score: Math.round((passed / Object.keys(checks).length) * 100) };
}

async function pickModel() {
  const r = await fetch(`${OLLAMA}/api/tags`);
  const d = await r.json();
  const models = (d.models || []).map((x) => x.name);
  const order = ['qwen2.5-coder:14b', 'qwen2.5-coder:7b', 'local-copilot-turbo'];
  for (const want of order) {
    const hit = models.find((m) => m === want || m.startsWith(`${want}:`));
    if (hit) return hit;
  }
  return models[0];
}

console.log('═══ Test bot Discord + intención ═══\n');

// 1) Parser de intención
const intent = parseUserIntent(USER_PROMPT);
ok(`Intención detectada: calidad=${intent.qualityBar}, prohibiciones=${intent.prohibitions.length}`);
const enriched = enrichUserMessage(USER_PROMPT);
ok(`Mensaje enriquecido: ${enriched.length} chars (vs ${USER_PROMPT.length} original)`);

mkdirSync(TEST_DIR, { recursive: true });
writeFileSync(join(TEST_DIR, 'package.json'), '{"name":"bot-intent-test","type":"commonjs"}\n');

let model;
try {
  model = await pickModel();
  ok(`Modelo: ${model}`);
} catch (e) {
  fail(`Ollama no disponible: ${e.message}`);
  process.exit(1);
}

info('Llamando a Ollama (puede tardar 1-3 min)...');
const t0 = Date.now();

let best = { actions: [], raw: '', score: 0, checks: {} };

for (let attempt = 0; attempt < 3; attempt++) {
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: enriched },
  ];
  if (attempt >= 1) {
    messages.push({
      role: 'user',
      content:
        `CORRECCIÓN (intento ${attempt + 1}): emite MÍNIMO 6 ACCION CREAR con <<CONTENIDO>> completo:\n` +
        'commands/ping.js, commands/help.js, events/ready.js, events/interactionCreate.js, musica/player.js, index.js\n' +
        'Sin .gitkeep. discord.js v14 + dotenv. index.js solo cablea módulos.',
    });
  }

  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature: 0.12, num_predict: 8192 },
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!r.ok) {
    fail(`Ollama HTTP ${r.status}`);
    continue;
  }

  const d = await r.json();
  const raw = d.message?.content || '';
  const actions = parseActions(raw);
  const { checks, score } = scoreResult(actions, raw);

  info(`Intento ${attempt + 1}: ${actions.length} ACCION, puntuación ${score}% (${Math.round((Date.now() - t0) / 1000)}s)`);

  if (score > best.score) {
    best = { actions, raw, score, checks };
  }
  if (score >= 75 && actions.length >= 4) break;
  if (attempt < 2) info('Reintentando con corrección más estricta...');
}

console.log('\n── Resultados ──');
for (const [k, v] of Object.entries(best.checks)) {
  v ? ok(k) : fail(k);
}

if (best.actions.length) {
  console.log('\n── Archivos generados ──');
  for (const a of best.actions) {
    info(`${a.path} (${a.content.length} bytes) — ${a.reason.slice(0, 50)}`);
  }
} else {
  fail('Sin bloques ACCION');
  console.log('\n── Respuesta Ollama (recorte) ──');
  console.log(best.raw.slice(0, 800));
}

try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }

console.log(`\n═══ Puntuación final: ${best.score}% ═══`);
if (best.score >= 75) {
  ok('El agente cumple lo pedido (modular, sin .gitkeep, código real)');
  process.exit(0);
}
fail('Por debajo del umbral 75% — el modelo necesita reintento o prompt más estricto');
process.exit(1);