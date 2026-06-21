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

/** Resultado de la comprobación de conexión con el proveedor activo. */
export interface OllamaConnectionResult {
  ok: boolean;
  models: string[];
  provider: string;
  message?: string;
}

/** Mensaje del historial de chat compatible con la API de los proveedores. */
export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ProviderName = 'ollama' | 'duckduckgo' | 'gemini' | 'openrouter' | 'groq' | 'cohere' | 'together' | 'cerebras' | 'huggingface';

/**
 * Cliente para comunicarse con el servidor Ollama local y proveedores de IA gratuitos.
 * Detecta automáticamente si Ollama está corriendo y gestiona
 * las peticiones de autocompletado y chat.
 *
 * @author DavidPilahito7
 * @license MIT
 */
export class OllamaClient {
  private baseUrl: string;
  private provider: ProviderName;
  private useInternet: boolean;
  private connected: boolean = false;
  private geminiApiKey: string;
  private geminiModel: string;
  private openRouterApiKey: string;
  private openRouterModel: string;
  // Nuevos proveedores gratuitos
  private groqApiKey: string;
  private groqModel: string;
  private cohereApiKey: string;
  private cohereModel: string;
  private togetherApiKey: string;
  private togetherModel: string;
  private cerebrasApiKey: string;
  private cerebrasModel: string;
  private huggingfaceApiKey: string;
  private huggingfaceModel: string;

  // ── Timeouts ────────────────────────────────────────────────────────────────
  private static readonly TIMEOUT_GET_MS  = 2_000;
  private static readonly TIMEOUT_POST_MS = 8_000;

  constructor() {
    this.baseUrl = this.getConfig('ollamaUrl', 'http://localhost:11434');
    this.provider = this.getConfig<ProviderName>('provider', 'ollama');
    this.useInternet = this.getConfig('useInternet', false);
    this.geminiApiKey = this.getConfig('geminiApiKey', '');
    this.geminiModel = this.getConfig('geminiModel', 'gemini-2.0-flash-exp');
    this.openRouterApiKey = this.getConfig('openRouterApiKey', '');
    this.openRouterModel = this.getConfig('openRouterModel', 'openai/gpt-4o-mini');
    // Nuevos proveedores gratuitos
    this.groqApiKey = this.getConfig('groqApiKey', '');
    this.groqModel = this.getConfig('groqModel', 'llama-3.3-70b-versatile');
    this.cohereApiKey = this.getConfig('cohereApiKey', '');
    this.cohereModel = this.getConfig('cohereModel', 'command-r-plus');
    this.togetherApiKey = this.getConfig('togetherApiKey', '');
    this.togetherModel = this.getConfig('togetherModel', 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free');
    this.cerebrasApiKey = this.getConfig('cerebrasApiKey', '');
    this.cerebrasModel = this.getConfig('cerebrasModel', 'llama-3.3-70b');
    this.huggingfaceApiKey = this.getConfig('huggingfaceApiKey', '');
    this.huggingfaceModel = this.getConfig('huggingfaceModel', 'meta-llama/Llama-3.2-11B-Vision-Instruct');
  }

  // ── Configuración ────────────────────────────────────────────────────────────

  private getConfig<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('local').get(key, fallback);
  }

  /** Refresca la configuración desde el usuario (por si cambió la API o el proveedor). */
  refreshConfig(): void {
    this.baseUrl = this.getConfig('ollamaUrl', 'http://localhost:11434');
    this.provider = this.getConfig<ProviderName>('provider', 'ollama');
    this.useInternet = this.getConfig('useInternet', false);
    this.geminiApiKey = this.getConfig('geminiApiKey', '');
    this.geminiModel = this.getConfig('geminiModel', 'gemini-2.0-flash-exp');
    this.openRouterApiKey = this.getConfig('openRouterApiKey', '');
    this.openRouterModel = this.getConfig('openRouterModel', 'openai/gpt-4o-mini');
    // Nuevos proveedores gratuitos
    this.groqApiKey = this.getConfig('groqApiKey', '');
    this.groqModel = this.getConfig('groqModel', 'llama-3.3-70b-versatile');
    this.cohereApiKey = this.getConfig('cohereApiKey', '');
    this.cohereModel = this.getConfig('cohereModel', 'command-r-plus');
    this.togetherApiKey = this.getConfig('togetherApiKey', '');
    this.togetherModel = this.getConfig('togetherModel', 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free');
    this.cerebrasApiKey = this.getConfig('cerebrasApiKey', '');
    this.cerebrasModel = this.getConfig('cerebrasModel', 'llama-3.3-70b');
    this.huggingfaceApiKey = this.getConfig('huggingfaceApiKey', '');
    this.huggingfaceModel = this.getConfig('huggingfaceModel', 'meta-llama/Llama-3.2-11B-Vision-Instruct');
  }

  // ── Estado de conexión ───────────────────────────────────────────────────────

  /**
   * Comprueba si Ollama está corriendo en local.
   * Permite que la extensión detecte la IA automáticamente,
   * sin que el usuario tenga que configurar nada más.
   */
  async checkConnection(): Promise<OllamaConnectionResult> {
    this.refreshConfig();

    // Siempre detectar las IAs instaladas localmente con Ollama, aunque uses proveedor internet
    let installedOllamaModels: string[] = [];
    try {
      const data = await this.httpGet('/api/tags');
      const parsed = JSON.parse(data);
      installedOllamaModels = (parsed.models ?? []).map((m: { name: string }) => m.name);
    } catch {
      // Ollama no disponible
    }

    if (this.useInternet) {
      // DuckDuckGo AI - GRATIS sin API key
      if (this.provider === 'duckduckgo') {
        this.connected = true;
        return {
          ok: true,
          models: ['gpt-4o-mini', 'claude-3-haiku', 'llama-3.3-70b', 'mixtral-8x7b'],
          provider: 'duckduckgo'
        };
      }

      if (this.provider === 'gemini') {
        if (!this.geminiApiKey) {
          this.connected = false;
          return {
            ok: false,
            models: [],
            provider: 'gemini',
            message: 'Añade una API key de Gemini en la configuración.'
          };
        }
        this.connected = true;
        return {
          ok: true,
          models: [this.geminiModel],
          provider: 'gemini'
        };
      }

      if (this.provider === 'openrouter') {
        if (!this.openRouterApiKey) {
          this.connected = false;
          return {
            ok: false,
            models: [],
            provider: 'openrouter',
            message: 'Añade una API key de OpenRouter en la configuración.'
          };
        }
        this.connected = true;
        return {
          ok: true,
          models: [this.openRouterModel],
          provider: 'openrouter'
        };
      }

      if (this.provider === 'groq') {
        if (!this.groqApiKey) {
          this.connected = false;
          return {
            ok: false,
            models: [],
            provider: 'groq',
            message: 'Añade una API key de Groq (gratis en console.groq.com).'
          };
        }
        this.connected = true;
        return { ok: true, models: [this.groqModel], provider: 'groq' };
      }

      if (this.provider === 'cohere') {
        if (!this.cohereApiKey) {
          this.connected = false;
          return {
            ok: false,
            models: [],
            provider: 'cohere',
            message: 'Añade una API key de Cohere (gratis en dashboard.cohere.com).'
          };
        }
        this.connected = true;
        return { ok: true, models: [this.cohereModel], provider: 'cohere' };
      }

      if (this.provider === 'together') {
        if (!this.togetherApiKey) {
          this.connected = false;
          return {
            ok: false,
            models: [],
            provider: 'together',
            message: 'Añade una API key de Together AI (gratis en together.ai).'
          };
        }
        this.connected = true;
        return { ok: true, models: [this.togetherModel], provider: 'together' };
      }

      if (this.provider === 'cerebras') {
        if (!this.cerebrasApiKey) {
          this.connected = false;
          return {
            ok: false,
            models: [],
            provider: 'cerebras',
            message: 'Añade una API key de Cerebras (gratis en cerebras.ai).'
          };
        }
        this.connected = true;
        return { ok: true, models: [this.cerebrasModel], provider: 'cerebras' };
      }

      if (this.provider === 'huggingface') {
        if (!this.huggingfaceApiKey) {
          this.connected = false;
          return {
            ok: false,
            models: [],
            provider: 'huggingface',
            message: 'Añade un token de HuggingFace (gratis en huggingface.co/settings/tokens).'
          };
        }
        this.connected = true;
        return { ok: true, models: [this.huggingfaceModel], provider: 'huggingface' };
      }
    }

    try {
      const data   = await this.httpGet('/api/tags');
      const parsed = JSON.parse(data);
      const models = (parsed.models ?? []).map((m: { name: string }) => m.name);
      this.connected = true;
      return { ok: true, models, provider: 'ollama' };
    } catch {
      this.connected = false;
      return {
        ok: false,
        models: [],
        provider: 'ollama',
        message: 'No se detecta Ollama en localhost:11434.'
      };
    }
  }

  // Nuevo: detectar siempre las IAs instaladas localmente, incluso si usas proveedor remoto
  async getInstalledOllamaModels(): Promise<string[]> {
    try {
      const data = await this.httpGet('/api/tags');
      const parsed = JSON.parse(data);
      return (parsed.models ?? []).map((m: { name: string }) => m.name);
    } catch {
      return [];
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

    if (this.useInternet && this.provider === 'duckduckgo') {
      return await this.fetchDuckDuckGoChat([{ role: 'user', content: prompt }]);
    }

    if (this.useInternet && this.provider === 'gemini') {
      const response = await this.fetchGeminiChat(
        [{ role: 'user', content: prompt }],
        useModel,
        true
      );
      return response;
    }

    if (this.useInternet && this.provider === 'openrouter') {
      const response = await this.fetchOpenRouterChat(
        [{ role: 'user', content: prompt }],
        useModel,
        true
      );
      return response;
    }

    if (this.useInternet && this.provider === 'groq') {
      return await this.fetchGroqChat([{ role: 'user', content: prompt }], useModel);
    }

    if (this.useInternet && this.provider === 'cohere') {
      return await this.fetchCohereChat([{ role: 'user', content: prompt }], useModel);
    }

    if (this.useInternet && this.provider === 'together') {
      return await this.fetchTogetherChat([{ role: 'user', content: prompt }], useModel);
    }

    if (this.useInternet && this.provider === 'cerebras') {
      return await this.fetchCerebrasChat([{ role: 'user', content: prompt }], useModel);
    }

    if (this.useInternet && this.provider === 'huggingface') {
      return await this.fetchHuggingFaceChat([{ role: 'user', content: prompt }], useModel);
    }

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
    const useModel = model ?? this.getConfig('chatModel', 'mistral:7b');

    if (this.useInternet && this.provider === 'duckduckgo') {
      const response = await this.fetchDuckDuckGoChat(messages);
      this.emitChunks(response, onToken);
      return response;
    }

    if (this.useInternet && this.provider === 'gemini') {
      const response = await this.fetchGeminiChat(messages, useModel);
      this.emitChunks(response, onToken);
      return response;
    }

    if (this.useInternet && this.provider === 'openrouter') {
      const response = await this.fetchOpenRouterChat(messages, useModel);
      this.emitChunks(response, onToken);
      return response;
    }

    if (this.useInternet && this.provider === 'groq') {
      const response = await this.fetchGroqChat(messages, useModel);
      this.emitChunks(response, onToken);
      return response;
    }

    if (this.useInternet && this.provider === 'cohere') {
      const response = await this.fetchCohereChat(messages, useModel);
      this.emitChunks(response, onToken);
      return response;
    }

    if (this.useInternet && this.provider === 'together') {
      const response = await this.fetchTogetherChat(messages, useModel);
      this.emitChunks(response, onToken);
      return response;
    }

    if (this.useInternet && this.provider === 'cerebras') {
      const response = await this.fetchCerebrasChat(messages, useModel);
      this.emitChunks(response, onToken);
      return response;
    }

    if (this.useInternet && this.provider === 'huggingface') {
      const response = await this.fetchHuggingFaceChat(messages, useModel);
      this.emitChunks(response, onToken);
      return response;
    }

    let fullResponse = '';

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

  private emitChunks(text: string, onToken: (token: string) => void): void {
    const chunks = text.match(/.{1,5}/gs) ?? [text];
    for (const chunk of chunks) {
      if (chunk) {
        onToken(chunk);
      }
    }
  }

  private async fetchGeminiChat(
    messages: OllamaChatMessage[],
    model: string,
    isCompletion = false
  ): Promise<string> {
    const apiKey = this.geminiApiKey;
    if (!apiKey) {
      throw new Error('Falta la API key de Gemini.');
    }

    const prompt = messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: isCompletion ? prompt : prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini error: ${response.status}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return text.trim();
  }

  private async fetchOpenRouterChat(
    messages: OllamaChatMessage[],
    model: string,
    isCompletion = false
  ): Promise<string> {
    const apiKey = this.openRouterApiKey;
    if (!apiKey) {
      throw new Error('Falta la API key de OpenRouter.');
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/pilahito/ollama-copilot-vscode',
        'X-Title': 'Local Copilot'
      },
      body: JSON.stringify({
        model,
        messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
        temperature: 0.2,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter error: ${response.status}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    return text.trim();
  }

  // ── DuckDuckGo AI (GRATIS, sin API key) ───────────────────────────────────────

  private async fetchDuckDuckGoChat(messages: OllamaChatMessage[]): Promise<string> {
    try {
      // Paso 1: Obtener el token VQD
      const statusResponse = await fetch('https://duckduckgo.com/duckchat/v1/status', {
        headers: {
          'x-vqd-accept': '1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const vqd = statusResponse.headers.get('x-vqd-4');
      if (!vqd) {
        throw new Error('No se pudo obtener token de DuckDuckGo');
      }

      // Paso 2: Enviar el mensaje
      const chatMessages = messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

      const response = await fetch('https://duckduckgo.com/duckchat/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-vqd-4': vqd,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: chatMessages
        })
      });

      if (!response.ok) {
        throw new Error(`DuckDuckGo error: ${response.status}`);
      }

      // Paso 3: Procesar la respuesta streaming
      const text = await response.text();
      const lines = text.split('\n');
      let result = '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const json = JSON.parse(data);
            if (json.message) {
              result += json.message;
            }
          } catch {
            // Ignorar líneas que no son JSON válido
          }
        }
      }
      
      return result.trim() || 'No se recibió respuesta de DuckDuckGo AI.';
    } catch (error) {
      throw new Error(`Error DuckDuckGo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── Groq (gratis, muy rápido) ────────────────────────────────────────────────

  private async fetchGroqChat(messages: OllamaChatMessage[], model: string): Promise<string> {
    const apiKey = this.groqApiKey;
    if (!apiKey) { throw new Error('Falta la API key de Groq.'); }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
        temperature: 0.2
      })
    });

    if (!response.ok) { throw new Error(`Groq error: ${response.status}`); }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  }

  // ── Cohere (gratis) ──────────────────────────────────────────────────────────

  private async fetchCohereChat(messages: OllamaChatMessage[], model: string): Promise<string> {
    const apiKey = this.cohereApiKey;
    if (!apiKey) { throw new Error('Falta la API key de Cohere.'); }

    const chatHistory = messages.slice(0, -1).map((msg) => ({
      role: msg.role === 'user' ? 'USER' : 'CHATBOT',
      message: msg.content
    }));
    const lastMessage = messages[messages.length - 1]?.content ?? '';

    const response = await fetch('https://api.cohere.ai/v1/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        message: lastMessage,
        chat_history: chatHistory,
        temperature: 0.2
      })
    });

    if (!response.ok) { throw new Error(`Cohere error: ${response.status}`); }
    const data = await response.json() as { text?: string };
    return data.text?.trim() ?? '';
  }

  // ── Together AI (gratis con créditos) ────────────────────────────────────────

  private async fetchTogetherChat(messages: OllamaChatMessage[], model: string): Promise<string> {
    const apiKey = this.togetherApiKey;
    if (!apiKey) { throw new Error('Falta la API key de Together AI.'); }

    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
        temperature: 0.2
      })
    });

    if (!response.ok) { throw new Error(`Together AI error: ${response.status}`); }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  }

  // ── Cerebras (gratis, ultra rápido) ──────────────────────────────────────────

  private async fetchCerebrasChat(messages: OllamaChatMessage[], model: string): Promise<string> {
    const apiKey = this.cerebrasApiKey;
    if (!apiKey) { throw new Error('Falta la API key de Cerebras.'); }

    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
        temperature: 0.2
      })
    });

    if (!response.ok) { throw new Error(`Cerebras error: ${response.status}`); }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  }

  // ── HuggingFace (gratis) ─────────────────────────────────────────────────────

  private async fetchHuggingFaceChat(messages: OllamaChatMessage[], model: string): Promise<string> {
    const apiKey = this.huggingfaceApiKey;
    if (!apiKey) { throw new Error('Falta el token de HuggingFace.'); }

    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

    const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { max_new_tokens: 1024, temperature: 0.2 }
      })
    });

    if (!response.ok) { throw new Error(`HuggingFace error: ${response.status}`); }
    const data = await response.json() as Array<{ generated_text?: string }> | { generated_text?: string };
    const text = Array.isArray(data) ? data[0]?.generated_text : data.generated_text;
    return text?.trim() ?? '';
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

  // ── Búsqueda Web con DuckDuckGo (para usar con Ollama local) ─────────────────

  /**
   * Realiza una búsqueda web usando DuckDuckGo y devuelve los resultados.
   * Esta función permite que Ollama local tenga acceso a información de internet.
   */
  async searchWeb(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as {
        AbstractText?: string;
        AbstractSource?: string;
        AbstractURL?: string;
        RelatedTopics?: Array<{
          Text?: string;
          FirstURL?: string;
        }>;
      };

      const results: { title: string; url: string; snippet: string }[] = [];

      // Añadir el resultado principal si existe
      if (data.AbstractText && data.AbstractURL) {
        results.push({
          title: data.AbstractSource || 'Resultado',
          url: data.AbstractURL,
          snippet: data.AbstractText.slice(0, 300)
        });
      }

      // Añadir temas relacionados
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, 5)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(' - ')[0] || 'Relacionado',
              url: topic.FirstURL,
              snippet: topic.Text.slice(0, 200)
            });
          }
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Chat con Ollama local + búsqueda web.
   * Primero busca en internet, luego envía los resultados a Ollama para que responda.
   */
  async chatWithWebSearch(
    messages: OllamaChatMessage[],
    onToken: (token: string) => void,
    model?: string
  ): Promise<string> {
    const lastMessage = messages[messages.length - 1]?.content || '';
    
    // Detectar si la pregunta necesita búsqueda web
    const needsSearch = this.needsWebSearch(lastMessage);
    
    let webContext = '';
    if (needsSearch) {
      onToken('🔍 Buscando en internet...\n\n');
      const searchResults = await this.searchWeb(lastMessage);
      
      if (searchResults.length > 0) {
        webContext = '\n\n📚 **Información de Internet:**\n';
        for (const result of searchResults) {
          webContext += `\n• **${result.title}**: ${result.snippet}\n`;
        }
        webContext += '\n---\n\nUsa esta información para responder la pregunta del usuario:\n\n';
      }
    }

    // Construir mensajes con contexto web
    const enhancedMessages: OllamaChatMessage[] = [
      ...messages.slice(0, -1),
      {
        role: 'user',
        content: webContext + lastMessage
      }
    ];

    // Usar Ollama local para responder
    return this.chatStream(enhancedMessages, onToken, model);
  }

  /**
   * Detecta si una pregunta necesita búsqueda web.
   */
  private needsWebSearch(text: string): boolean {
    const webTriggers = [
      'qué es', 'que es', 'quien es', 'quién es',
      'busca', 'buscar', 'internet', 'web',
      'actualidad', 'noticias', 'último', 'ultima',
      'precio', 'cotización', 'tiempo', 'clima',
      'cómo se hace', 'como se hace', 'tutorial',
      'documentación', 'documentacion', 'docs',
      'versión actual', 'version actual', 'latest',
      '2024', '2025', '2026', 'hoy', 'ayer',
      'reciente', 'nuevo', 'nueva'
    ];
    
    const lowerText = text.toLowerCase();
    return webTriggers.some(trigger => lowerText.includes(trigger));
  }

  /** Obtener si el modo internet está activo */
  isInternetEnabled(): boolean {
    return this.useInternet;
  }

  /** Obtener el proveedor actual */
  getProvider(): ProviderName {
    return this.provider;
  }
}
