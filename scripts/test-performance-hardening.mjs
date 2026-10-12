#!/usr/bin/env node
/** Comprobaciones de regresión para rendimiento y defaults seguros. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const agent = read('src/agent.ts');
const ollama = read('src/ollamaClient.ts');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const config = pkg.contributes.configuration.properties;

assert.match(agent, /const entries = await Promise\.all\(filePaths\.map\(async \(fp\) =>/,
  'Agent file reads should overlap instead of waiting sequentially');
assert.match(agent, /get\('requireConfirmation', true\)/,
  'Runtime fallback should confirm changes by default');
assert.equal(config['local.requireConfirmation'].default, true,
  'New installations should confirm agent changes by default');
assert.equal(pkg.version, lock.version, 'package.json and package-lock.json versions must match');
assert.equal(pkg.version, '1.6.2', 'Candidate package version should be 1.6.2');
assert.match(ollama, /await this\.checkConnection\(true, false\)/,
  'Prefetch should not force a second model-list request');
assert.match(ollama, /private modelListRequest\?: Promise<string\[]>;/,
  'Concurrent model-list requests should share one in-flight request');
assert.match(ollama, /OllamaClient\.MODEL_LIST_EMPTY_CACHE_MS/,
  'A successful empty model list should be cached briefly');
assert.match(ollama, /OllamaClient\.MODEL_LIST_ERROR_CACHE_MS/,
  'Connection failures should use a short startup cooldown');
console.log('✅ Rendimiento y defaults seguros: todas las comprobaciones pasaron.');
