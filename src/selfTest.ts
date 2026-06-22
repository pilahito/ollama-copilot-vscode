/**
 * Autotest y monitor de salud — Local Copilot
 * Prueba Ollama, modelos y modos chat/profesor/agente hasta que respondan.
 */

import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';
import type { LocalChatViewProvider } from './chatViewProvider';
import { getEffectivePrompt } from './promptSettings';
import { openCopilotChat } from './copilotLayout';

export interface SelfTestResult {
  ok: boolean;
  passed: number;
  failed: number;
  lines: string[];
}

type LogFn = (line: string) => void;

const MODE_TESTS: Array<{
  label: string;
  mode: 'chat' | 'teacher' | 'agent';
  user: string;
  task: 'chat' | 'teacher' | 'agent';
}> = [
  {
    label: 'Chat',
    mode: 'chat',
    task: 'chat',
    user: '¿Qué es una función en JavaScript? Responde en 1 frase.',
  },
  {
    label: 'Profesor',
    mode: 'teacher',
    task: 'teacher',
    user: 'Explica qué hace console.log en una línea.',
  },
  {
    label: 'Agente',
    mode: 'agent',
    task: 'agent',
    user: 'Lista 2 pasos para crear un proyecto web con HTML. Responde breve.',
  },
];

/** Ejecuta una batería de pruebas contra Ollama y los modos de la extensión. */
export async function runSelfTest(
  ollama: OllamaClient,
  chatProvider?: LocalChatViewProvider,
  log: LogFn = () => {}
): Promise<SelfTestResult> {
  const lines: string[] = [];
  let passed = 0;
  let failed = 0;

  const record = (ok: boolean, msg: string): void => {
    const line = `${ok ? '✓' : '✗'} ${msg}`;
    lines.push(line);
    log(`[selfTest] ${line}`);
    if (ok) { passed++; } else { failed++; }
  };

  log('[selfTest] ── Inicio autotest ──');

  // 1. Conexión Ollama
  try {
    const status = await ollama.checkConnection(true);
    if (status.ok && status.models.length > 0) {
      record(true, `Ollama conectado — ${status.models.length} modelo(s)`);
    } else {
      record(false, status.message ?? 'Ollama sin modelos o desconectado');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    record(false, `Conexión Ollama: ${msg}`);
  }

  // 2. Webview del chat (ping + modelos)
  if (chatProvider) {
    try {
      await openCopilotChat(chatProvider, log);
      const ready = await chatProvider.waitUntilReady(10_000);
      if (ready) {
        record(true, 'Webview del chat inicializada');
        const pingOk = await chatProvider.testWebviewPing(6000);
        record(pingOk, pingOk ? 'Ping↔Pong webview' : 'Ping↔Pong falló — UI no responde');
        await chatProvider.forceSyncModels();
        const modelsOk = await chatProvider.waitForModelsLoaded(12_000);
        record(modelsOk, modelsOk ? 'Selector de modelos cargado' : 'Selector sigue en "Cargando modelos…"');
      } else {
        record(false, 'Webview del chat no se creó (barra de actividad)');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      record(false, `Webview: ${msg}`);
    }
  }

  // 3. Modos chat / profesor / agente
  for (const test of MODE_TESTS) {
    try {
      const system = getEffectivePrompt(test.mode === 'agent' ? 'agent' : test.mode);
      const model = ollama.getModelForTask(test.task);
      const streamFn = test.mode === 'agent'
        ? ollama.agentChatStream.bind(ollama)
        : ollama.chatStream.bind(ollama);

      let tokens = 0;
      const response = await Promise.race([
        streamFn(
          [
            { role: 'system', content: system || 'Eres un asistente de programación.' },
            { role: 'user', content: test.user },
          ],
          () => { tokens++; },
          model
        ),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('timeout 45s')), 45_000);
        }),
      ]);

      const text = response?.trim();
      if (text && text.length > 3) {
        record(true, `${test.label} (${model}): ${text.slice(0, 60)}…`);
      } else {
        record(false, `${test.label}: respuesta vacía`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      record(false, `${test.label}: ${msg}`);
    }
  }

  const ok = failed === 0;
  log(`[selfTest] ── Fin: ${passed} OK, ${failed} fallos ──`);
  return { ok, passed, failed, lines };
}

export interface MonitorOptions {
  maxAttempts?: number;
  intervalMs?: number;
  /** Sin popups "Reintentar" — solo log y reintentos automáticos */
  silent?: boolean;
  onComplete?: (result: SelfTestResult) => void;
}

/**
 * Monitor en bucle: reintenta el autotest hasta que todo pase o se agoten los intentos.
 * Se ejecuta en segundo plano al activar la extensión.
 */
export class ExtensionMonitor {
  private running = false;
  private stopped = false;
  private attempt = 0;

  constructor(
    private readonly ollama: OllamaClient,
    private readonly chatProvider: LocalChatViewProvider,
    private readonly log: LogFn
  ) {}

  stop(): void {
    this.stopped = true;
  }

  async runUntilHealthy(opts: MonitorOptions = {}): Promise<SelfTestResult> {
    const maxAttempts = opts.maxAttempts ?? 5;
    const intervalMs = opts.intervalMs ?? 8_000;
    let lastResult: SelfTestResult = { ok: false, passed: 0, failed: 1, lines: [] };

    if (this.running) {
      this.log('[monitor] Ya hay un monitor en ejecución');
      return lastResult;
    }

    this.running = true;
    this.stopped = false;
    this.attempt = 0;

    try {
      while (!this.stopped && this.attempt < maxAttempts) {
        this.attempt++;
        this.log(`[monitor] Intento ${this.attempt}/${maxAttempts}`);

        lastResult = await runSelfTest(this.ollama, this.chatProvider, this.log);

        if (lastResult.ok) {
          this.log('[monitor] ✓ Todo OK — monitor detenido');
          if (!opts.silent) {
            vscode.window.showInformationMessage(
              `Local Copilot: autotest OK (${lastResult.passed} pruebas). Chat, Profesor y Agente listos.`
            );
          }
          opts.onComplete?.(lastResult);
          return lastResult;
        }

        if (this.attempt < maxAttempts) {
          this.log(`[monitor] Reintento en ${intervalMs / 1000}s…`);
          await chatProviderForceRefresh(this.chatProvider, this.log);
          await delay(intervalMs);
        }
      }

      const summary = `${lastResult.failed} fallo(s) tras ${this.attempt} intento(s)`;
      this.log(`[monitor] ✗ ${summary}`);
      if (opts.silent) {
        this.log('[monitor] Reintento automático en 15s (sin popup)…');
        await delay(15_000);
        this.attempt = 0;
        this.stopped = false;
        return this.runUntilHealthy({ ...opts, maxAttempts: 3, silent: true });
      }
      this.log('[monitor] Ver salida "Local Copilot" para detalles.');
      opts.onComplete?.(lastResult);
      return lastResult;
    } finally {
      this.running = false;
    }
  }
}

async function chatProviderForceRefresh(
  chatProvider: LocalChatViewProvider,
  log: LogFn
): Promise<void> {
  try {
    await openCopilotChat(chatProvider, log);
    await chatProvider.forceSyncModels();
  } catch {
    /* reintento en siguiente ciclo */
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));