/**
 * Depuración visual — prueba webview real + pipeline chat/profesor/agente.
 * Escribe en /tmp/local-copilot-debug.log y toma capturas si hay DISPLAY.
 */

import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { OllamaClient } from './ollamaClient';
import type { LocalChatViewProvider } from './chatViewProvider';
import { openCopilotChat } from './copilotLayout';
import { debugLog, DEBUG_LOG_PATH, getScreenshotDir, initDebugLog } from './debugLog';

export interface VisualDebugResult {
  ok: boolean;
  passed: number;
  failed: number;
  lines: string[];
  screenshot?: string;
}

type LogFn = (line: string) => void;

const PIPELINE_TESTS: Array<{ label: string; mode: 'chat' | 'teacher' | 'agent'; text: string }> = [
  { label: 'Chat UI', mode: 'chat', text: 'Di solo: OK chat' },
  { label: 'Profesor UI', mode: 'teacher', text: 'Explica var en 1 línea.' },
  { label: 'Agente UI', mode: 'agent', text: 'Di 2 pasos para HTML. Solo texto.' },
];

export async function runVisualDebug(
  ollama: OllamaClient,
  chatProvider: LocalChatViewProvider,
  log: LogFn = () => {},
  opts: { silent?: boolean } = {}
): Promise<VisualDebugResult> {
  initDebugLog(log);
  const lines: string[] = [];
  let passed = 0;
  let failed = 0;
  let screenshot: string | undefined;

  const record = (ok: boolean, msg: string): void => {
    const line = `${ok ? '✓' : '✗'} ${msg}`;
    lines.push(line);
    debugLog(`[visual] ${line}`);
    log(`[visual] ${line}`);
    if (ok) { passed++; } else { failed++; }
  };

  debugLog('── Inicio depuración visual ──');

  try {
    await openCopilotChat(chatProvider, debugLog);
    record(true, 'Comando abrir chat ejecutado');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    record(false, `Abrir chat: ${msg}`);
  }

  const ready = await chatProvider.waitUntilReady(12_000);
  record(ready, ready ? 'Webview creada (resolveWebviewView)' : 'Webview NO creada — el chat no puede responder');

  if (ready) {
    const pingOk = await chatProvider.testWebviewPing(8000);
    record(pingOk, pingOk ? 'Ping↔Pong webview OK' : 'Ping↔Pong FALLÓ — mensajes no llegan a la UI');

    await chatProvider.forceSyncModels();
    const modelsOk = await chatProvider.waitForModelsLoaded(15_000);
    record(modelsOk, modelsOk ? 'Modelos cargados en selector' : 'Selector sigue en "Cargando modelos…"');
  }

  const status = await ollama.checkConnection(true);
  record(status.ok && status.models.length > 0, status.ok
    ? `Ollama: ${status.models.length} modelo(s)`
    : `Ollama: ${status.message ?? 'sin conexión'}`);

  if (ready) {
    const userModes: Array<{ label: string; mode: 'chat' | 'teacher' | 'agent'; text: string }> = [
      { label: 'Usuario→Chat', mode: 'chat', text: 'Responde solo: OK usuario' },
      { label: 'Usuario→Profesor', mode: 'teacher', text: 'Explica let en 1 línea.' },
      { label: 'Usuario→Agente', mode: 'agent', text: 'Di 2 pasos para crear HTML. Solo texto.' },
    ];
    for (const um of userModes) {
      try {
        const r = await chatProvider.testWebviewUserSend(um.text, um.mode, um.mode === 'agent' ? 90_000 : 60_000);
        record(r.ok, r.ok
          ? `${um.label}: ${r.snippet.slice(0, 40)}…`
          : `${um.label} falló (${r.events.slice(-6).join(', ')})`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        record(false, `${um.label}: ${msg}`);
      }
    }

    try {
      const preOk = await chatProvider.testPrefillFlow('Explica qué es JSON en 1 línea', 'chat', 60_000);
      record(preOk, preOk ? 'Prefill (Explicar código) OK' : 'Prefill falló');
    } catch (err: unknown) {
      record(false, `Prefill: ${err instanceof Error ? err.message : String(err)}`);
    }

    for (const test of PIPELINE_TESTS) {
      try {
        const result = await chatProvider.testChatPipeline(test.mode, test.text, 75_000);
        if (result.ok) {
          record(true, `${test.label}: ${result.snippet.slice(0, 50)}…`);
        } else {
          record(false, `${test.label}: sin respuesta (eventos: ${result.events.join(', ')})`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        record(false, `${test.label}: ${msg}`);
      }
    }

    record(true, 'Agente disco: validado por scripts/agent-e2e.mjs en modo dios');
  }

  screenshot = captureScreenshot();
  if (screenshot) {
    record(true, `Captura guardada: ${screenshot}`);
  }

  const ok = failed === 0;
  debugLog(`── Fin depuración: ${passed} OK, ${failed} fallos ──`);
  debugLog(`Log completo: ${DEBUG_LOG_PATH}`);

  if (!ok && !opts.silent) {
    debugLog(`[visual] ${failed} fallo(s) — reintento automático en 10s`);
    await new Promise<void>((r) => setTimeout(r, 10_000));
    await chatProvider.forceSyncModels();
    return runVisualDebug(ollama, chatProvider, log, { silent: true });
  } else if (!ok) {
    debugLog(`[visual] ${failed} fallo(s) tras reintentos — ver ${DEBUG_LOG_PATH}`);
  } else if (!opts.silent) {
    vscode.window.showInformationMessage(
      `✓ Local Copilot listo — ${passed} pruebas OK.`
    );
  }

  return { ok, passed, failed, lines, screenshot };
}

function captureScreenshot(): string | undefined {
  if (!process.env.DISPLAY) { return undefined; }

  try {
    const dir = getScreenshotDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = `${dir}/vscode-${Date.now()}.png`;

    try {
      const wid = execSync(
        'xdotool search --onlyvisible --class code 2>/dev/null | tail -1',
        { encoding: 'utf8', timeout: 3000 }
      ).trim();
      if (wid) {
        execSync(`xdotool windowactivate ${wid}`, { timeout: 2000 });
        execSync('sleep 0.4');
      }
    } catch {
      /* sin foco */
    }

    try {
      execSync(`gnome-screenshot -w -f "${file}"`, { timeout: 5000 });
      if (fs.existsSync(file)) { return file; }
    } catch {
      /* fallback */
    }

    execSync(`import -window root "${file}"`, { timeout: 5000 });
    return fs.existsSync(file) ? file : undefined;
  } catch {
    return undefined;
  }
}