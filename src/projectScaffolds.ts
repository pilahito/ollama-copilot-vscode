/**
 * Plantillas de respaldo por tipo de proyecto cuando Ollama no genera un archivo.
 */

import { wantsDiscordBot, wantsRestApi, wantsWebPage } from './projectBlueprints';
import { getNekotinaScaffold, isNekotinaCriticalFile } from './nekotinaScaffold';

const EXPRESS_PACKAGE = `{
  "name": "api-rest",
  "version": "1.0.0",
  "description": "API REST Express (Local Copilot)",
  "main": "server.js",
  "scripts": { "start": "node server.js", "dev": "node --watch server.js" },
  "engines": { "node": ">=18.0.0" },
  "dependencies": { "express": "^4.21.0" }
}
`;

const EXPRESS_SERVER = `const express = require('express');
const tareasRouter = require('./routes/tareas');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api/tareas', tareasRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(\`API en http://localhost:\${PORT}\`));
`;

const EXPRESS_TAREAS = `const express = require('express');
const router = express.Router();
let tareas = [];
let nextId = 1;

router.get('/', (_req, res) => res.json(tareas));

router.get('/:id', (req, res) => {
  const t = tareas.find((x) => x.id === Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'No encontrada' });
  res.json(t);
});

router.post('/', (req, res) => {
  const { titulo, hecha = false } = req.body;
  if (!titulo) return res.status(400).json({ error: 'titulo requerido' });
  const t = { id: nextId++, titulo, hecha: Boolean(hecha) };
  tareas.push(t);
  res.status(201).json(t);
});

router.put('/:id', (req, res) => {
  const t = tareas.find((x) => x.id === Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'No encontrada' });
  if (req.body.titulo !== undefined) t.titulo = req.body.titulo;
  if (req.body.hecha !== undefined) t.hecha = Boolean(req.body.hecha);
  res.json(t);
});

router.delete('/:id', (req, res) => {
  const idx = tareas.findIndex((x) => x.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ error: 'No encontrada' });
  tareas.splice(idx, 1);
  res.status(204).end();
});

module.exports = router;
`;

const WEB_INDEX = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Proyecto Local Copilot</title>
  <link rel="stylesheet" href="css/styles.css" />
</head>
<body>
  <main><h1>Proyecto generado</h1><p id="msg">Cargando…</p></main>
  <script src="js/main.js"></script>
</body>
</html>`;

const WEB_CSS = `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:grid;place-items:center}
main{text-align:center;padding:2rem}
h1{font-size:2rem;margin-bottom:.5rem}
`;

const WEB_JS = `document.getElementById('msg').textContent = '✅ Web cargada correctamente';
`;

const GENERIC: Record<string, string> = {
  'package.json': EXPRESS_PACKAGE,
  'server.js': EXPRESS_SERVER,
  'routes/tareas.js': EXPRESS_TAREAS,
  'public/index.html': WEB_INDEX,
  'public/css/styles.css': WEB_CSS,
  'public/js/main.js': WEB_JS,
  'README.md': '# Proyecto\n\nGenerado por Local Copilot Agente.\n',
};

export function isNekotinaProject(prompt: string): boolean {
  return /\b(nekotina|impresionante|de todo|completo|flipante|bot\s+discord)\b/i.test(prompt) &&
    wantsDiscordBot(prompt);
}

export function getProjectScaffold(prompt: string, filePath: string): string | null {
  if (isNekotinaProject(prompt) && isNekotinaCriticalFile(filePath)) {
    return getNekotinaScaffold(filePath);
  }
  if (wantsRestApi(prompt) && filePath in GENERIC) {
    return GENERIC[filePath];
  }
  if (wantsWebPage(prompt) && filePath in GENERIC) {
    return GENERIC[filePath];
  }
  if (filePath === 'package.json' && /\b(node|npm|express|discord)\b/i.test(prompt)) {
    return isNekotinaProject(prompt) ? getNekotinaScaffold('package.json') : GENERIC['package.json'];
  }
  return null;
}

export function isScaffoldableFile(prompt: string, filePath: string): boolean {
  return getProjectScaffold(prompt, filePath) !== null;
}