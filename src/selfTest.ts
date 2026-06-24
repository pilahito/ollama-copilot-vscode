/**
 * Autotest y monitor de salud — Local Copilot
 * Prueba Ollama, modelos y modos chat/profesor/agente hasta que respondan.
 */

import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';
import type { LocalChatViewProvider } from './chatViewProvider';
import { getEffectivePrompt } from './promptSettings';
import { openCopilotChat } from './copilotLayout';
import {
  AGENT_SELF_TEST_SYSTEM_PROMPT,
  hasAgentCreationOutput,
  hasValidAccionBlock,
  looksLikeCreationResponse,
  looksLikeRefusal,
} from './ollamaDefense';

export interface SelfTestResult {
  ok: boolean;
  passed: number;
  failed: number;
  lines: string[];
}

type LogFn = (line: string) => void;

interface ModeTest {
  label: string;
  mode: 'chat' | 'teacher' | 'agent';
  task: 'chat' | 'teacher' | 'agent';
  user: string;
  validate: (text: string) => { ok: boolean; detail: string };
}

const MODE_TESTS: ModeTest[] = [
  {
    label: 'Chat',
    mode: 'chat',
    task: 'chat',
    user:
      'Créame un mini bot Discord con /hola que responda "Hola mundo". ' +
      'Dame el código del comando en un bloque ```javascript. Responde breve.',
    validate: (text) => {
      if (looksLikeRefusal(text)) {
        return { ok: false, detail: 'rechazo detectado — Ollama debe defenderse y dar código' };
      }
      if (!looksLikeCreationResponse(text)) {
        return { ok: false, detail: 'sin código útil (falta bloque ``` o lógica)' };
      }
      return { ok: true, detail: 'código sin rechazo' };
    },
  },
  {
    label: 'Profesor',
    mode: 'teacher',
    task: 'teacher',
    user:
      'Enséñame a crear un archivo suma.js con function suma(a,b){ return a+b }. ' +
      'Paso a paso corto con ejemplo de código.',
    validate: (text) => {
      if (looksLikeRefusal(text)) {
        return { ok: false, detail: 'rechazo detectado — el profesor debe enseñar con código' };
      }
      if (!/suma|function|return/i.test(text)) {
        return { ok: false, detail: 'no explica la función suma' };
      }
      return { ok: true, detail: 'enseñanza con código' };
    },
  },
  {
    label: 'Agente (crear archivo)',
    mode: 'agent',
    task: 'agent',
    user:
      'Créame el archivo selftest-demo.js con una función suma(a, b) que devuelva a + b y module.exports = { suma }.',
    validate: (text) => {
      if (looksLikeRefusal(text)) {
        return { ok: false, detail: 'rechazo detectado — el agente debe crear con ACCION' };
      }
      if (!hasAgentCreationOutput(text)) {
        return { ok: false, detail: 'sin ACCION ni código de creación' };
      }
      const formatNote = hasValidAccionBlock(text) ? 'formato canónico' : 'ACCION+markdown (reintento recomendado)';
      if (!/suma|module\.exports/i.test(text)) {
        return { ok: false, detail: 'ACCION sin función suma' };
      }
      return { ok: true, detail: `creación con suma (${formatNote})` };
    },
  },
];

function buildAgentTestSystemPrompt(): string {
  const custom = getEffectivePrompt('agent').trim();
  return custom
    ? `${AGENT_SELF_TEST_SYSTEM_PROMPT}\n═══ INSTRUCCIONES PERSONALIZADAS ═══\n${custom}\n`
    : AGENT_SELF_TEST_SYSTEM_PROMPT;
}

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

  log('[selfTest] ── Inicio autotest (defensa Ollama + creación) ──');

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
      const system =
        test.mode === 'agent'
          ? buildAgentTestSystemPrompt()
          : getEffectivePrompt(test.mode) || 'Eres un asistente de programación.';
      const model = ollama.getModelForTask(test.task);
      const streamFn = test.mode === 'agent'
        ? ollama.agentChatStream.bind(ollama)
        : ollama.chatStream.bind(ollama);

      let tokens = 0;
      const response = await Promise.race([
        streamFn(
          [
            { role: 'system', content: system },
            { role: 'user', content: test.user },
          ],
          () => { tokens++; },
          model
        ),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('timeout 90s')), 90_000);
        }),
      ]);

      const text = response?.trim() ?? '';
      const check = test.validate(text);
      if (text.length > 3 && check.ok) {
        record(true, `${test.label} (${model}): ${check.detail} — ${text.slice(0, 50)}…`);
      } else if (text.length > 3) {
        record(false, `${test.label}: ${check.detail}`);
        log(`[selfTest] Respuesta agente/chat (300 chars): ${text.slice(0, 300)}`);
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
              'Local Copilot: Ollama OK — Chat, Profesor y Agente defienden y crean (ACCION).'
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