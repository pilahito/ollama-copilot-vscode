#!/usr/bin/env node
/**
 * Ejecuta toda la batería de tests de Local Copilot.
 */
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = [
  'scripts/test-v1038.mjs',
  'scripts/test-api-guidance.mjs',
  'scripts/test-reference-learner.mjs',
  'scripts/test-organization.mjs',
  'scripts/test-bot-intent.mjs',
];

let failed = 0;
console.log('╔══════════════════════════════════════════╗');
console.log('║  Local Copilot — Batería completa tests  ║');
console.log('╚══════════════════════════════════════════╝\n');

for (const script of scripts) {
  const path = join(ROOT, script);
  console.log(`\n▶ ${script}`);
  console.log('─'.repeat(44));
  const r = spawnSync('node', [path], { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
  if (r.status !== 0) {
    failed++;
    console.log(`\n✗ FALLÓ: ${script} (exit ${r.status ?? 'timeout'})\n`);
  } else {
    console.log(`\n✓ OK: ${script}\n`);
  }
}

console.log('═'.repeat(50));
if (failed) {
  console.log(`${failed}/${scripts.length} suites fallaron`);
  process.exit(1);
}
console.log(`Todas las suites pasaron (${scripts.length}/${scripts.length})`);
process.exit(0);