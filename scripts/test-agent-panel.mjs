#!/usr/bin/env node
/** Verifica panel fijo del agente en el bundle compilado. */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist/extension.js');

execSync('npm run compile', { cwd: ROOT, stdio: 'pipe' });

if (!existsSync(DIST)) {
  console.error('❌ falta dist/extension.js');
  process.exit(1);
}

const src = readFileSync(join(ROOT, 'src/chatViewProvider.ts'), 'utf8');
const dist = readFileSync(DIST, 'utf8');
let ok = 0;
let fail = 0;
const check = (cond, msg) => {
  if (cond) { console.log(`  ✅ ${msg}`); ok++; }
  else { console.log(`  ❌ ${msg}`); fail++; }
};

console.log('══ Panel agente fijo v1.2.7 ══');
check(src.includes('id="agent-live-panel"'), 'HTML panel agente en chatViewProvider');
check(src.includes("type: 'agentSync'"), 'mensaje agentSync en extensión');
check(src.includes('syncAgentPanel'), 'syncAgentPanel en extensión');
check(src.includes('renderAgentPanel'), 'renderAgentPanel en webview');
check(dist.includes('agentSync'), 'agentSync en dist compilado');
check(dist.includes('agent-live-panel'), 'agent-live-panel en dist compilado');

console.log(`\n${fail === 0 ? '🎉' : '⚠'} ${ok} OK, ${fail} fallos`);
process.exit(fail > 0 ? 1 : 0);