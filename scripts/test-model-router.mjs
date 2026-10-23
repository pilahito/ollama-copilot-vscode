#!/usr/bin/env node
/**
 * Test de comportamiento del selector de modelos (src/modelRouter.ts).
 *
 * Compila el módulo con esbuild y lo ejecuta: así se comprueba la lógica real
 * (no solo que el bundle contenga ciertos símbolos).
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = mkdtempSync(join(tmpdir(), 'local-copilot-router-'));
const outfile = join(outdir, 'modelRouter.mjs');

let fails = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) { fails++; }
};

try {
  await build({
    entryPoints: [join(ROOT, 'src/modelRouter.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });

  const m = await import(pathToFileURL(outfile).href);

  console.log('\n🧪 modelRouter — modelos que razonan\n');

  ok(m.isReasoningModel('deepseek-r1:14b'), 'deepseek-r1:14b razona');
  ok(m.isReasoningModel('qwen3:8b'), 'qwen3:8b razona');
  ok(m.isReasoningModel('qwen3-local:8b'), 'alias qwen3-local:8b razona');
  ok(m.isReasoningModel('gpt-oss:20b'), 'gpt-oss:20b razona');
  ok(!m.isReasoningModel('qwen2.5-coder:7b'), 'qwen2.5-coder:7b NO razona');
  ok(!m.isReasoningModel('mistral:7b'), 'mistral:7b NO razona');

  console.log('\n🧪 modelRouter — autocompletado\n');

  const a = m.pickTaskModels(['deepseek-r1:14b', 'mistral:7b']);
  ok(a.completion === 'mistral:7b', `con r1 instalado, autocompletado = ${a.completion} (no r1)`);

  const b = m.pickTaskModels(['deepseek-r1:14b']);
  ok(b.completion === 'deepseek-r1:14b', 'si solo hay r1, se usa r1 (no se queda sin modelo)');
  ok(b.chat === 'deepseek-r1:14b', 'chat puede seguir usando r1');

  const c = m.pickTaskModels(['deepseek-r1:14b', 'qwen2.5-coder:14b']);
  ok(c.completion !== 'deepseek-r1:14b', `con coder:14b, autocompletado = ${c.completion}`);

  const hwPlan = { chat: 'deepseek-r1:14b', completion: 'deepseek-r1:14b', agent: 'deepseek-r1:14b' };
  const d = m.pickTaskModelsWithHardware(['deepseek-r1:14b', 'qwen2.5-coder:7b'], hwPlan);
  ok(d.completion === 'qwen2.5-coder:7b', `plan por hardware no fuerza r1: ${d.completion}`);

  console.log('\n🧪 modelRouter — utilidades\n');
  ok(m.findInstalledModel(['qwen2.5-coder:14b'], 'qwen2.5-coder') === 'qwen2.5-coder:14b', 'findInstalledModel resuelve por prefijo');
  ok(m.modelInstalled(['qwen2.5-coder:7b'], 'qwen2.5-coder:7b') === true, 'modelInstalled detecta instalado');
  ok(m.modelInstalled(['qwen2.5-coder:7b'], 'llama3.1:8b') === false, 'modelInstalled rechaza ausente');

  console.log(fails ? `\n✗ ${fails} comprobación(es) fallida(s)\n` : '\n✅ Todas las comprobaciones OK\n');
  process.exit(fails ? 1 : 0);
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
