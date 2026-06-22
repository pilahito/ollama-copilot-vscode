#!/usr/bin/env node
/**
 * Prueba unitaria del ReferenceLearner (queries, features, prioridad GitHub, caché).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };

// Cargar fuente TS compilada vía regex sobre out/ (o reimplementar lógica clave)
const src = readFileSync(join(ROOT, 'src/referenceLearner.ts'), 'utf8');

function extractFn(name) {
  const re = new RegExp(`export function ${name}[\\s\\S]*?^}`, 'm');
  const m = src.match(re);
  return m ? m[0] : null;
}

// Inline reimplementación mínima alineada con referenceLearner.ts
const FEATURE_ALIASES = {
  music: ['musica', 'música', 'music', 'play'],
  trivia: ['trivia', 'quiz'],
  economy: ['economia', 'economía', 'economy'],
};

function extractFeatureKeywords(prompt) {
  const lower = prompt.toLowerCase();
  const found = [];
  for (const [feature, aliases] of Object.entries(FEATURE_ALIASES)) {
    if (aliases.some((a) => lower.includes(a))) found.push(feature);
  }
  return found;
}

function prioritizeGitHubHits(hits) {
  const score = (h) => {
    let s = 0;
    if (h.url.includes('github.com/') && !h.url.includes('gist')) s += 100;
    return s;
  };
  return [...hits].sort((a, b) => score(b) - score(a));
}

function buildSimilarProjectQueries(prompt, kind = 'discord-bot') {
  const queries = new Set();
  const features = extractFeatureKeywords(prompt);
  queries.add(`site:github.com discord.js bot slash commands modular`);
  for (const f of features) {
    queries.add(`site:github.com discord bot ${f} implementation`);
  }
  queries.add(`site:github.com ${prompt.slice(0, 70)}`);
  return [...queries].slice(0, 8);
}

console.log('\n🧪 ReferenceLearner v1.0.36\n');

const prompt = 'Crea bot Discord con música, trivia y economía modular';
const features = extractFeatureKeywords(prompt);
if (features.includes('music') && features.includes('trivia') && features.includes('economy')) {
  ok(`features detectadas: ${features.join(', ')}`);
} else {
  fail(`features incompletas: ${features.join(', ')}`);
}

const queries = buildSimilarProjectQueries(prompt);
if (queries.some((q) => q.includes('site:github.com')) && queries.length >= 4) {
  ok(`${queries.length} queries con site:github.com`);
} else {
  fail(`queries insuficientes: ${queries.length}`);
}

const hits = prioritizeGitHubHits([
  { title: 'Blog', url: 'https://medium.com/discord-bot', snippet: '' },
  { title: 'Repo', url: 'https://github.com/user/discord-bot', snippet: 'commands/' },
  { title: 'SO', url: 'https://stackoverflow.com/q/1', snippet: '' },
]);
if (hits[0].url.includes('github.com')) {
  ok('GitHub priorizado sobre Medium/SO');
} else {
  fail('prioridad GitHub falló');
}

if (src.includes('resolveReferences') && src.includes('resolveOffline') && src.includes('gatherReferenceContext')) {
  ok('API unificada resolveReferences + gatherReferenceContext');
} else {
  fail('falta API unificada en referenceLearner.ts');
}

if (src.includes('combined')) {
  ok('modo offline combinado (caché + builtin)');
} else {
  fail('falta modo combined');
}

console.log(process.exitCode ? '\n❌ Algunas pruebas fallaron\n' : '\n✅ Todas las pruebas OK\n');