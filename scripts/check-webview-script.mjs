#!/usr/bin/env node
/** Valida sintaxis del <script> en /tmp/local-copilot-webview.html */
import { readFileSync, existsSync } from 'fs';
import vm from 'vm';

const HTML = '/tmp/local-copilot-webview.html';

if (!existsSync(HTML)) {
  console.error('❌ No existe', HTML, '— abre el chat en VS Code primero');
  process.exit(1);
}

const html = readFileSync(HTML, 'utf8');
const s = html.indexOf('<script>');
const e = html.indexOf('</script>', s);
const script = html.slice(s + 8, e);

try {
  new vm.Script(script, { filename: 'webview.js' });
  console.log('✅ Sintaxis webview OK (' + script.length + ' chars)');
  process.exit(0);
} catch (err) {
  console.error('❌', err.message);
  const m = String(err.stack || '').match(/webview\.js:(\d+)/);
  if (m) {
    const line = Number(m[1]);
    const lines = script.split('\n');
    for (let i = Math.max(0, line - 3); i < Math.min(lines.length, line + 2); i++) {
      console.error(String(i + 1).padStart(5), lines[i]);
    }
  }
  process.exit(1);
}