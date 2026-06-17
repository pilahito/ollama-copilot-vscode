/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Local Copilot — Agente Autónomo Local
 *  (c) 2026 DavidPilahito7 · Licensed under the MIT License.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Author   : DavidPilahito7
 *  Project  : Local Copilot
 *  Module   : OllamaClient — Comunicación con el servidor Ollama local
 *  Origin   : Conil de la Frontera, Andalusia, Spain
 *  Created  : 2026
 *  Contact  : https://github.com/DavidPilahito7
 *
 *  Este software es propiedad intelectual de DavidPilahito7.
 *  Queda prohibida su redistribución, modificación o uso comercial
 *  sin el consentimiento explícito del autor, salvo los términos
 *  permitidos por la licencia MIT adjunta.
 *
 *  This software is the intellectual property of DavidPilahito7.
 *  Redistribution, modification or commercial use without explicit
 *  consent of the author is prohibited, except as permitted by
 *  the MIT License terms herein.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as http from 'http';
import * as vscode from 'vscode';

/** Resultado de la comprobación de conexión con Ollama. */
export interface OllamaConnectionResult {
  ok: boolean;
  models: string[];
}

/** Mensaje del historial de chat compatible con la API de Ollama. */
export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Cliente para comunicarse con el servidor Ollama local.
 * Detecta automáticamente si Ollama está corriendo y gestiona
 * las peticiones de autocompletado y chat.
 *
 * @author DavidPilahito7
 * @license MIT
 */
export class OllamaClient {
  private baseUrl: string;
  private connected: boolean = false;

  // ── Timeouts ────────────────────────────────────────────────────────────────
  private static readonly TIMEOUT_GET_MS  = 2_000;
  private static readonly TIMEOUT_POST_MS = 8_000;

  constructor() {
    this.baseUrl = this.getConfig('ollamaUrl', 'http://localhost:11434');
  }

  // ── Configuración ────────────────────────────────────────────────────────────

  private getConfig<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('local').get(key, fallback);
  }

  /** Refresca la URL desde la configuración (por si el usuario la cambió). */
  refreshConfig(): void {
    this.baseUrl = this.getConfig('ollamaUrl', 'http://localhost:11434');
  }

  // ── Estado de conexión ───────────────────────────────────────────────────────

  /**
   * Comprueba si Ollama está corriendo en local.
   * Permite que la extensión detecte la IA automáticamente,
   * sin que el usuario tenga que configurar nada más.
   */
  async checkConnection(): Promise<OllamaConnectionResult> {
    this.refreshConfig();
    try {
      const data   = await this.httpGet('/api/tags');
      const parsed = JSON.parse(data);
      const models = (parsed.models ?? []).map((m: { name: string }) => m.name);
      this.connected = true;
      return { ok: true, models };
    } catch {
      this.connected = false;
      return { ok: false, models: [] };
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Autocompletado ───────────────────────────────────────────────────────────

  /**
   * Genera una sugerencia de autocompletado (no-stream, rápida).
   * Usada por el proveedor de autocompletado inline.
   *
   * @param prompt  Fragmento de código a completar.
   * @param model   Modelo a usar (usa `completionModel` de config si se omite).
   */
  async generateCompletion(prompt: string, model?: string): Promise<string> {
    this.refreshConfig();
    const useModel = model ?? this.getConfig('completionModel', 'codellama:13b');
    const body = JSON.stringify({
      model:   useModel,
      prompt,
      stream:  false,
      options: {
        temperature: 0.2,
        num_predict: 128,
        stop:        ['\n\n\n']
      }
    });

    const result = await this.httpPost('/api/generate', body);
    try {
      return (JSON.parse(result) as { response?: string }).response ?? '';
    } catch {
      return '';
    }
  }

  // ── Chat con streaming ───────────────────────────────────────────────────────

  /**
   * Chat con streaming token a token, usado por la vista de chat.
   * `onToken` se invoca por cada fragmento para actualizar la UI en vivo.
   *
   * @param messages  Historial de mensajes del chat.
   * @param onToken   Callback que recibe cada token generado.
   * @param model     Modelo a usar (usa `chatModel` de config si se omite).
   * @returns         Respuesta completa concatenada.
   */
  async chatStream(
    messages: OllamaChatMessage[],
    onToken:  (token: string) => void,
    model?:   string
  ): Promise<string> {
    this.refreshConfig();
    const useModel    = model ?? this.getConfig('chatModel', 'mistral:7b');
    let   fullResponse = '';

    return new Promise((resolve, reject) => {
      const url     = new URL(`${this.baseUrl}/api/chat`);
      const payload = JSON.stringify({ model: useModel, messages, stream: true });

      const req = http.request(
        {
          hostname: url.hostname,
          port:     url.port,
          path:     url.pathname,
          method:   'POST',
          headers:  {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        },
        (res) => {
          let buffer = '';

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.trim()) { continue; }
              try {
                const json  = JSON.parse(line) as { message?: { content?: string } };
                const token = json.message?.content ?? '';
                if (token) {
                  fullResponse += token;
                  onToken(token);
                }
              } catch {
                // Línea incompleta — se acumula en buffer y se reintenta.
              }
            }
          });

          res.on('end', () => resolve(fullResponse));
        }
      );

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────────

  /** Petición GET simple sobre el API de Ollama. */
  private httpGet(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const req = http.get(
        {
          hostname: url.hostname,
          port:     url.port,
          path:     url.pathname,
          timeout:  OllamaClient.TIMEOUT_GET_MS
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk));
          res.on('end', () => resolve(body));
        }
      );

      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  /** Petición POST simple (sin streaming) sobre el API de Ollama. */
  private httpPost(path: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const req = http.request(
        {
          hostname: url.hostname,
          port:     url.port,
          path:     url.pathname,
          method:   'POST',
          headers:  {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(body)
          },
          timeout: OllamaClient.TIMEOUT_POST_MS
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk));
          res.on('end', () => resolve(data));
        }
      );

      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });
  }
}
