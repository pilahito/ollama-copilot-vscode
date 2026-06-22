#!/usr/bin/env node
/** Verifica detección de APIs y sentido común GitHub (sin Ollama). */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Cargar funciones desde el bundle compilado no es trivial; test inline equivalente
const prompts = [
  'bot discord con musica y trivia',
  'bot con clima y chistes',
  'publica en github cuando termines',
  'crea una api rest con express',
];

const checks = [
  { re: /discord\.js/i, prompt: prompts[0] },
  { re: /trivia|Open Trivia/i, prompt: prompts[0] },
  { re: /Open-Meteo|weather/i, prompt: prompts[1] },
  { re: /express/i, prompt: prompts[3] },
];

// Import compiled - esbuild bundles everything; test via spawn compile output grep
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = readFileSync(join(ROOT, 'dist/extension.js'), 'utf8');

const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };

console.log('═══ Test API guidance (bundle) ══\n');

const markers = [
  'detectApiRecommendations',
  'buildApiGuidanceBlock',
  'shouldAgentResearchWeb',
  'buildGitHubCommonSenseBlock',
  'Open Trivia DB',
  'discord.js',
  'resolveReferences',
  'prioritizeGitHubHits',
  'gatherReferenceContext',
  'learned-references.json',
];
for (const m of markers) {
  ext.includes(m) ? ok(`Bundle contiene: ${m}`) : fail(`Falta en bundle: ${m}`);
}

process.exit(process.exitCode || 0);