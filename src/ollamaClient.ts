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
import { execSync } from 'child_process';
import * as vscode from 'vscode';
import { getHardwareProfile, type HardwareProfile } from './hardwareProfile';
import { searchNpmPackages } from './npmRegistry';
import {
  findInstalledModel,
  modelInstalled,
  pickTaskModels,
  resolveTaskModel,
  type TaskKind,
  type TaskModels,
} from './modelRouter';
import { detectApiRecommendations } from './apiGuidance';
import type { ProjectBlueprint } from './projectBlueprints';
import { prioritizeGitHubHits } from './referenceLearner';

/** Resultado de la comprobación de conexión con el proveedor activo. */
export interface OllamaConnectionResult {
  ok: boolean;
  models: string[];
  provider: string;
  effectiveProvider?: string;
  autoMode?: boolean;
  browserName?: string;
  message?: string;
}

/** Mensaje del historial de chat compatible con la API de los proveedores. */
export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ProviderName =
  | 'auto'
  | 'ollama'
  | 'duckduckgo'
  | 'gemini'
  | 'openrouter'
  | 'groq'
  | 'cohere'
  | 'together'
  | 'cerebras'
  | 'huggingface';

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
  private autoResolvedProvider: ProviderName = 'ollama';
  private cachedBrowserName?: string;
  private cachedModelList:     string[] = [];
  private modelListCacheTime  = 0;
  private connectionCache:     OllamaConnectionResult | null = null;
  private connectionCacheTime = 0;
  private prefetchDone        = false;
  private resolvedBaseUrl?:   string;
  private static readonly MODEL_LIST_CACHE_MS = 120_000;
  private static readonly CONNECTION_CACHE_MS = 10_000;

  // ── Timeouts ────────────────────────────────────────────────────────────────
  private static readonly TIMEOUT_GET_MS       = 8_000;
  private static readonly TIMEOUT_POST_MS      = 30_000;
  /** generateCompletion / pasos previos del agente (14b puede tardar >30s en cargar). */
  private static readonly TIMEOUT_AGENT_MS     = 300_000;
  /** Streaming agente: sin límite duro (keep_alive 4h en payload). */
  private static readonly TIMEOUT_AGENT_STREAM = 4 * 3600_000;

  constructor() {
    this.baseUrl = this.getConfig('ollamaUrl', 'http://localhost:11434');
    this.provider = this.getConfig<ProviderName>('provider', 'auto');
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

  /** Opciones Ollama para chat rápido (menos contexto = menos latencia). */
  private getOllamaChatPayload(model: string, messages: OllamaChatMessage[], agent = false): string {
    const temperature = agent
      ? 0.05
      : this.getConfig('ollamaTemperature', 0.35);
    const numPredict = agent
      ? 12_288
      : this.getConfig('ollamaNumPredict', 4096);

    return JSON.stringify({
      model,
      messages,
      stream: true,
      keep_alive: agent
        ? (this.getConfig('agentKeepAlive', '4h') as string)
        : this.getConfig('ollamaKeepAlive', '30m'),
      options: {
        temperature,
        num_ctx: this.getConfig('ollamaNumCtx', 8192),
        num_predict: numPredict,
        top_p: agent ? 0.85 : 0.9,
        repeat_penalty: agent ? 1.15 : 1.1,
        stop: agent ? ['<<FIN>>\n\n<<FIN>>'] : undefined,
      },
    });
  }

  /**
   * Precalienta el modelo en RAM para que el primer mensaje no tarde.
   * Se ejecuta en segundo plano al abrir el chat.
   */
  async warmupModel(model?: string): Promise<void> {
    if (!this.getConfig('ollamaWarmup', true)) {
      return;
    }
    this.refreshConfig();
    await this.resolveAutoProvider();
    if (this.getEffectiveProvider() !== 'ollama') {
      return;
    }

    const useModel = this.resolveInstalledModelName(model ?? this.getModelForTask('chat'));
    try {
      await this.httpPost(
        '/api/generate',
        JSON.stringify({
          model: useModel,
          prompt: 'ok',
          stream: false,
          keep_alive: this.getConfig('ollamaKeepAlive', '30m'),
          options: { num_predict: 1, num_ctx: 512 },
        })
      );
    } catch {
      // El warmup es opcional; no bloquea el chat.
    }
  }

  /** Refresca la configuración desde el usuario (por si cambió la API o el proveedor). */
  refreshConfig(): void {
    this.baseUrl = this.getConfig('ollamaUrl', 'http://localhost:11434');
    this.provider = this.getConfig<ProviderName>('provider', 'auto');
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

  /** Detecta el navegador predeterminado del sistema (Brave, Firefox, Chrome…). */
  getBrowserName(): string {
    if (this.cachedBrowserName) {
      return this.cachedBrowserName;
    }

    const configured = this.getConfig<string>('browserName', '');
    if (configured) {
      this.cachedBrowserName = configured;
      return configured;
    }

    try {
      const desktop = execSync('xdg-settings get default-web-browser 2>/dev/null', {
        encoding: 'utf8',
        timeout: 2000,
      }).trim().toLowerCase();

      if (desktop.includes('brave')) { this.cachedBrowserName = 'Brave'; }
      else if (desktop.includes('firefox')) { this.cachedBrowserName = 'Firefox'; }
      else if (desktop.includes('chrome')) { this.cachedBrowserName = 'Chrome'; }
      else if (desktop.includes('chromium')) { this.cachedBrowserName = 'Chromium'; }
      else if (desktop.includes('edge')) { this.cachedBrowserName = 'Edge'; }
      else { this.cachedBrowserName = 'tu navegador'; }
    } catch {
      this.cachedBrowserName = 'tu navegador';
    }

    return this.cachedBrowserName;
  }

  private static readonly INTERNET_PROVIDERS: ProviderName[] = [
    'groq', 'cerebras', 'gemini', 'together', 'cohere', 'huggingface', 'openrouter',
  ];

  private hasApiKeyFor(provider: ProviderName): boolean {
    switch (provider) {
      case 'groq':         return !!this.groqApiKey;
      case 'cerebras':     return !!this.cerebrasApiKey;
      case 'gemini':       return !!this.geminiApiKey;
      case 'together':     return !!this.togetherApiKey;
      case 'cohere':       return !!this.cohereApiKey;
      case 'huggingface':  return !!this.huggingfaceApiKey;
      case 'openrouter':   return !!this.openRouterApiKey;
      default:             return false;
    }
  }

  /** Primera API de internet con clave configurada (para modo Auto + Internet). */
  pickFirstConfiguredInternetProvider(): ProviderName | null {
    for (const provider of OllamaClient.INTERNET_PROVIDERS) {
      if (this.hasApiKeyFor(provider)) {
        return provider;
      }
    }
    return null;
  }

  isInternetProvider(provider: ProviderName): boolean {
    return OllamaClient.INTERNET_PROVIDERS.includes(provider);
  }

  /**
   * Resuelve el modo Auto: prioriza Ollama local si hay modelos instalados.
   * Sin Ollama y con +Internet activo → primera API con clave configurada.
   */
  async resolveAutoProvider(): Promise<ProviderName> {
    if (this.provider !== 'auto') {
      this.autoResolvedProvider = this.provider;
      return this.provider;
    }

    const installed = await this.getInstalledOllamaModels();
    if (installed.length > 0) {
      this.autoResolvedProvider = 'ollama';
      return 'ollama';
    }

    if (this.useInternet) {
      const picked = this.pickFirstConfiguredInternetProvider();
      this.autoResolvedProvider = picked ?? 'groq';
      return this.autoResolvedProvider;
    }

    this.autoResolvedProvider = 'ollama';
    return 'ollama';
  }

  getEffectiveProvider(): ProviderName {
    return this.provider === 'auto' ? this.autoResolvedProvider : this.provider;
  }

  /** Internet activo para APIs web, o búsqueda web sobre Ollama local. */
  isEffectiveInternetMode(): boolean {
    const effective = this.getEffectiveProvider();
    if (this.isInternetProvider(effective)) {
      return true;
    }
    return this.useInternet && effective === 'ollama';
  }

  usesRemoteApi(): boolean {
    return this.isInternetProvider(this.getEffectiveProvider());
  }

  getBrowserChatUrl(): string {
    if (!this.useInternet) {
      return 'https://ollama.com';
    }
    const urls: Partial<Record<ProviderName, string>> = {
      groq: 'https://console.groq.com',
      cerebras: 'https://cloud.cerebras.ai',
      gemini: 'https://aistudio.google.com',
      together: 'https://api.together.xyz',
      cohere: 'https://dashboard.cohere.com',
      huggingface: 'https://huggingface.co',
      openrouter: 'https://openrouter.ai',
    };
    return urls[this.getEffectiveProvider()] ?? 'https://ollama.com';
  }

  // ── Prefetch / bootstrap (UI instantánea) ───────────────────────────────────

  /** Precarga modelos en segundo plano al activar la extensión. */
  async prefetch(force = false): Promise<void> {
    if (this.prefetchDone && !force && this.cachedModelList.length > 0) { return; }
    await this.getInstalledOllamaModels(true);
    await this.resolveAutoProvider();
    if (this.cachedModelList.length > 0 && !this.prefetchDone) {
      await this.autoSelectBestModels();
      this.prefetchDone = true;
    } else if (this.cachedModelList.length > 0) {
      this.prefetchDone = true;
    }
    await this.checkConnection(true);
  }

  getHardwareProfile(): HardwareProfile {
    return getHardwareProfile();
  }

  getConfiguredTaskModels(): Partial<TaskModels> {
    const c = vscode.workspace.getConfiguration('local');
    return {
      chat: c.get('chatModel', ''),
      completion: c.get('completionModel', ''),
      agent: c.get('agentModel', '') || c.get('chatModel', ''),
    };
  }

  getModelForTask(task: TaskKind): string {
    const installed = this.cachedModelList;
    const picked = resolveTaskModel(installed, task, this.getConfiguredTaskModels());
    return findInstalledModel(installed, picked) ?? picked;
  }

  /** Devuelve el nombre exacto instalado en Ollama (p. ej. local-copilot-turbo → local-copilot-turbo:latest). */
  resolveInstalledModelName(model: string, installed?: string[]): string {
    const list = installed ?? this.cachedModelList;
    return findInstalledModel(list, model) ?? model;
  }

  /** Snapshot síncrono para pintar la UI sin esperar red. */
  getBootstrapSnapshot(): Record<string, unknown> {
    const config = vscode.workspace.getConfiguration('local');
    const taskModels = pickTaskModels(this.cachedModelList);
    const cached = this.connectionCache;
    return {
      ok: cached?.ok ?? this.cachedModelList.length > 0,
      models: this.cachedModelList,
      message: cached?.message,
      provider: this.provider,
      effectiveProvider: this.getEffectiveProvider(),
      internetEnabled: this.useInternet,
      currentModel: config.get('chatModel', '') || config.get('completionModel', ''),
      chatModel: config.get('chatModel', ''),
      completionModel: config.get('completionModel', ''),
      agentModel: config.get('agentModel', '') || config.get('chatModel', ''),
      taskModels,
      hardware: getHardwareProfile(),
      noModels: this.cachedModelList.length === 0 && !(cached?.ok && cached.models.length > 0),
    };
  }

  invalidateCaches(): void {
    this.connectionCache     = null;
    this.connectionCacheTime = 0;
    this.modelListCacheTime  = 0;
    this.resolvedBaseUrl     = undefined;
  }

  /** URL base que responde (localhost o 127.0.0.1). */
  getActiveBaseUrl(): string {
    return this.resolvedBaseUrl ?? this.baseUrl.replace(/\/$/, '');
  }

  // ── Estado de conexión ───────────────────────────────────────────────────────

  /**
   * Comprueba si Ollama está corriendo en local.
   * Usa caché 10s para evitar lag en la UI.
   */
  async checkConnection(force = false): Promise<OllamaConnectionResult> {
    const now = Date.now();
    if (!force && this.connectionCache &&
        now - this.connectionCacheTime < OllamaClient.CONNECTION_CACHE_MS) {
      return this.connectionCache;
    }

    this.refreshConfig();
    await this.resolveAutoProvider();

    const effective = this.getEffectiveProvider();
    const browserName = this.getBrowserName();
    const autoMode = this.provider === 'auto';
    const withMeta = (result: OllamaConnectionResult): OllamaConnectionResult => {
      const full = {
        ...result,
        provider: this.provider,
        effectiveProvider: effective,
        autoMode,
        browserName,
      };
      this.connectionCache     = full;
      this.connectionCacheTime = now;
      return full;
    };

    const installedOllamaModels = await this.getInstalledOllamaModels(force);

    if (this.isInternetProvider(effective)) {
      if (effective === 'gemini') {
        if (!this.geminiApiKey) {
          this.connected = false;
          return withMeta({
            ok: false,
            models: [],
            provider: 'gemini',
            message: 'Añade una API key de Gemini en la configuración.',
          });
        }
        this.connected = true;
        return withMeta({ ok: true, models: [this.geminiModel], provider: 'gemini' });
      }

      if (effective === 'openrouter') {
        if (!this.openRouterApiKey) {
          this.connected = false;
          return withMeta({
            ok: false,
            models: [],
            provider: 'openrouter',
            message: 'Añade una API key de OpenRouter en la configuración.',
          });
        }
        this.connected = true;
        return withMeta({ ok: true, models: [this.openRouterModel], provider: 'openrouter' });
      }

      if (effective === 'groq') {
        if (!this.groqApiKey) {
          this.connected = false;
          return withMeta({
            ok: false,
            models: [],
            provider: 'groq',
            message: 'Añade una API key de Groq (gratis en console.groq.com).',
          });
        }
        this.connected = true;
        return withMeta({ ok: true, models: [this.groqModel], provider: 'groq' });
      }

      if (effective === 'cohere') {
        if (!this.cohereApiKey) {
          this.connected = false;
          return withMeta({
            ok: false,
            models: [],
            provider: 'cohere',
            message: 'Añade una API key de Cohere (gratis en dashboard.cohere.com).',
          });
        }
        this.connected = true;
        return withMeta({ ok: true, models: [this.cohereModel], provider: 'cohere' });
      }

      if (effective === 'together') {
        if (!this.togetherApiKey) {
          this.connected = false;
          return withMeta({
            ok: false,
            models: [],
            provider: 'together',
            message: 'Añade una API key de Together AI (gratis en together.ai).',
          });
        }
        this.connected = true;
        return withMeta({ ok: true, models: [this.togetherModel], provider: 'together' });
      }

      if (effective === 'cerebras') {
        if (!this.cerebrasApiKey) {
          this.connected = false;
          return withMeta({
            ok: false,
            models: [],
            provider: 'cerebras',
            message: 'Añade una API key de Cerebras (gratis en cerebras.ai).',
          });
        }
        this.connected = true;
        return withMeta({ ok: true, models: [this.cerebrasModel], provider: 'cerebras' });
      }

      if (effective === 'huggingface') {
        if (!this.huggingfaceApiKey) {
          this.connected = false;
          return withMeta({
            ok: false,
            models: [],
            provider: 'huggingface',
            message: 'Añade un token de HuggingFace (gratis en huggingface.co/settings/tokens).',
          });
        }
        this.connected = true;
        return withMeta({ ok: true, models: [this.huggingfaceModel], provider: 'huggingface' });
      }
    }

    if (installedOllamaModels.length > 0) {
      this.connected = true;
      const webNote = this.useInternet ? ' + internet bajo demanda' : '';
      return withMeta({
        ok: true,
        models: installedOllamaModels,
        provider: 'ollama',
        message: autoMode
          ? `✓ ${installedOllamaModels.length} IA(s) · Auto → Ollama${webNote}`
          : `✓ ${installedOllamaModels.length} modelo(s) listos${webNote}`,
      });
    }

    this.connected = false;
    const hw = getHardwareProfile();
    return withMeta({
      ok: false,
      models: [],
      provider: 'ollama',
      message: installedOllamaModels.length === 0
        ? `⚠ Sin modelos IA. Ejecuta: ollama pull qwen2.5-coder:7b (PC ${hw.tier}, ${hw.ramGb}GB RAM, ${hw.osLabel})`
        : autoMode && this.useInternet
          ? 'Sin Ollama. Instala Ollama o configura una API en ⚙️.'
          : 'No se detecta Ollama. Ejecuta "ollama serve".',
    });
  }

  // Nuevo: detectar siempre las IAs instaladas localmente, incluso si usas proveedor remoto
  async getInstalledOllamaModels(force = false): Promise<string[]> {
    const now = Date.now();
    if (!force && this.cachedModelList.length > 0 &&
        now - this.modelListCacheTime < OllamaClient.MODEL_LIST_CACHE_MS) {
      return this.cachedModelList;
    }
    try {
      const data = await this.httpGet('/api/tags');
      const parsed = JSON.parse(data);
      const models = (parsed.models ?? []).map((m: { name: string }) => m.name);
      this.cachedModelList    = models;
      this.modelListCacheTime = now;
      return models;
    } catch {
      return this.cachedModelList;
    }
  }

  /**
   * Automatically select the best models from installed ones for the user's PC.
   * Prefers coder models, chooses lighter for completion, suitable for chat.
   * Updates the VS Code settings automatically.
   */
  async autoSelectBestModels(): Promise<TaskModels | null> {
    const installed = await this.getInstalledOllamaModels();
    const picked    = pickTaskModels(installed);
    if (!picked) { return null; }

    const config = vscode.workspace.getConfiguration('local');
    const cur = this.getConfiguredTaskModels();

    const chat = modelInstalled(installed, cur.chat ?? '') ? cur.chat! : picked.chat;
    const completion = modelInstalled(installed, cur.completion ?? '') ? cur.completion! : picked.completion;
    const agent = modelInstalled(installed, cur.agent ?? '') ? cur.agent! : picked.agent;

    if (chat !== cur.chat) {
      await config.update('chatModel', chat, vscode.ConfigurationTarget.Global);
    }
    if (completion !== cur.completion) {
      await config.update('completionModel', completion, vscode.ConfigurationTarget.Global);
    }
    if (agent !== cur.agent) {
      await config.update('agentModel', agent, vscode.ConfigurationTarget.Global);
    }
    this.refreshConfig();
    return { chat, completion, agent };
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
    await this.resolveAutoProvider();
    const effective = this.getEffectiveProvider();
    const useModel = this.resolveInstalledModelName(model ?? this.getModelForTask('completion'));

    if (this.isInternetProvider(effective)) {
      if (effective === 'gemini') {
        const response = await this.fetchGeminiChat(
          [{ role: 'user', content: prompt }],
          useModel,
          true
        );
        return response;
      }
      if (effective === 'openrouter') {
        const response = await this.fetchOpenRouterChat(
          [{ role: 'user', content: prompt }],
          useModel,
          true
        );
        return response;
      }
      if (effective === 'groq') {
        return await this.fetchGroqChat([{ role: 'user', content: prompt }], useModel);
      }
      if (effective === 'cohere') {
        return await this.fetchCohereChat([{ role: 'user', content: prompt }], useModel);
      }
      if (effective === 'together') {
        return await this.fetchTogetherChat([{ role: 'user', content: prompt }], useModel);
      }
      if (effective === 'cerebras') {
        return await this.fetchCerebrasChat([{ role: 'user', content: prompt }], useModel);
      }
      if (effective === 'huggingface') {
        return await this.fetchHuggingFaceChat([{ role: 'user', content: prompt }], useModel);
      }
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

    const result = await this.httpPost('/api/generate', body, OllamaClient.TIMEOUT_AGENT_MS);
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
    await this.resolveAutoProvider();
    const effective = this.getEffectiveProvider();
    const useModel = this.resolveInstalledModelName(model ?? this.getModelForTask('chat'));

    if (this.isInternetProvider(effective)) {
      let response = '';
      if (effective === 'gemini') {
        response = await this.fetchGeminiChat(messages, useModel);
      } else if (effective === 'openrouter') {
        response = await this.fetchOpenRouterChat(messages, useModel);
      } else if (effective === 'groq') {
        response = await this.fetchGroqChat(messages, useModel);
      } else if (effective === 'cohere') {
        response = await this.fetchCohereChat(messages, useModel);
      } else if (effective === 'together') {
        response = await this.fetchTogetherChat(messages, useModel);
      } else if (effective === 'cerebras') {
        response = await this.fetchCerebrasChat(messages, useModel);
      } else if (effective === 'huggingface') {
        response = await this.fetchHuggingFaceChat(messages, useModel);
      }
      this.emitChunks(response, onToken);
      return response;
    }

    let fullResponse = '';

    return new Promise((resolve, reject) => {
      const url     = new URL(`${this.getActiveBaseUrl()}/api/chat`);
      const payload = this.getOllamaChatPayload(useModel, messages, false);
      const port    = url.port || (url.protocol === 'https:' ? '443' : '80');

      const req = http.request(
        {
          hostname: url.hostname,
          port,
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

  /**
   * Chat optimizado para el modo agente: temperatura baja y más tokens de salida.
   */
  async agentChatStream(
    messages: OllamaChatMessage[],
    onToken:  (token: string) => void,
    model?:   string
  ): Promise<string> {
    this.refreshConfig();
    await this.resolveAutoProvider();
    const effective = this.getEffectiveProvider();
    const useModel = this.resolveInstalledModelName(model ?? this.getModelForTask('agent'));

    if (this.isInternetProvider(effective)) {
      return this.chatStream(messages, onToken, useModel);
    }

    let fullResponse = '';

    return new Promise((resolve, reject) => {
      const url = new URL(`${this.getActiveBaseUrl()}/api/chat`);
      const payload = this.getOllamaChatPayload(useModel, messages, true);
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');

      const req = http.request(
        {
          hostname: url.hostname,
          port,
          path:     url.pathname,
          method:   'POST',
          headers:  {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: OllamaClient.TIMEOUT_AGENT_STREAM,
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
                // Línea incompleta.
              }
            }
          });

          res.on('end', () => resolve(fullResponse));
        }
      );

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout agente (Ollama tardó demasiado)')); });
      req.write(payload);
      req.end();
    });
  }

  private emitChunks(text: string, onToken: (token: string) => void): void {
    const chunks = text.match(/.{1,12}/gs) ?? [text];
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
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    try {
      const statusResponse = await fetch('https://duckduckgo.com/duckchat/v1/status', {
        headers: { 'x-vqd-accept': '1', 'User-Agent': ua },
      });

      const vqd4   = statusResponse.headers.get('x-vqd-4');
      const vqdHash = statusResponse.headers.get('x-vqd-hash-1');
      if (!vqd4 && !vqdHash) {
        throw new Error('No se pudo conectar con DuckDuckGo AI. Usa "Abrir en navegador" en ⚙️.');
      }

      const chatMessages = messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

      const chatHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': ua,
      };
      if (vqd4) {
        chatHeaders['x-vqd-4'] = vqd4;
      } else if (vqdHash) {
        chatHeaders['x-vqd-hash-1'] = vqdHash;
      }

      const response = await fetch('https://duckduckgo.com/duckchat/v1/chat', {
        method: 'POST',
        headers: chatHeaders,
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: chatMessages }),
      });

      const text = await response.text();

      if (text.includes('ERR_CHALLENGE') || text.includes('"status":418')) {
        throw new Error(
          'DuckDuckGo pide verificación en el navegador. En ⚙️ pulsa "Abrir en navegador" o usa Ollama local.'
        );
      }

      if (!response.ok) {
        throw new Error(`DuckDuckGo error: ${response.status}`);
      }

      const lines = text.split('\n');
      let result = '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') { break; }
          try {
            const json = JSON.parse(data) as { message?: string };
            if (json.message) { result += json.message; }
          } catch { /* línea parcial */ }
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

  /** URLs base a probar (localhost ↔ 127.0.0.1). */
  private getOllamaBaseUrls(): string[] {
    const base = this.baseUrl.replace(/\/$/, '');
    const urls = [base];
    if (base.includes('localhost')) {
      urls.push(base.replace('localhost', '127.0.0.1'));
    } else if (base.includes('127.0.0.1')) {
      urls.push(base.replace('127.0.0.1', 'localhost'));
    }
    return [...new Set(urls)];
  }

  private httpGetOnce(baseUrl: string, path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(baseUrl + path);
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');
      const req = http.get(
        {
          hostname: url.hostname,
          port,
          path:     url.pathname + url.search,
          timeout:  OllamaClient.TIMEOUT_GET_MS,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            resolve(body);
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  /** Petición GET simple sobre el API de Ollama. */
  private async httpGet(path: string): Promise<string> {
    let lastErr: Error | undefined;
    const bases = this.resolvedBaseUrl
      ? [this.resolvedBaseUrl, ...this.getOllamaBaseUrls().filter((b) => b !== this.resolvedBaseUrl)]
      : this.getOllamaBaseUrls();
    for (const base of bases) {
      try {
        const body = await this.httpGetOnce(base, path);
        this.resolvedBaseUrl = base;
        return body;
      } catch (err: unknown) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastErr ?? new Error('Ollama no responde');
  }

  /** Petición POST simple (sin streaming) sobre el API de Ollama. */
  private httpPost(path: string, body: string, timeoutMs = OllamaClient.TIMEOUT_POST_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.getActiveBaseUrl() + path);
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');
      const req = http.request(
        {
          hostname: url.hostname,
          port,
          path:     url.pathname,
          method:   'POST',
          headers:  {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(body)
          },
          timeout: timeoutMs
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
  private decodeDdgRedirect(href: string): string {
    const match = href.match(/uddg=([^&]+)/);
    if (!match) { return href.startsWith('//') ? `https:${href}` : href; }
    return decodeURIComponent(match[1]);
  }

  private stripHtml(text: string): string {
    return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** API instantánea de DuckDuckGo (suele devolver vacío en consultas técnicas). */
  private async searchWebInstant(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`
      );

      if (!response.ok) { return []; }

      const data = await response.json() as {
        AbstractText?: string;
        AbstractSource?: string;
        AbstractURL?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };

      const results: { title: string; url: string; snippet: string }[] = [];

      if (data.AbstractText && data.AbstractURL) {
        results.push({
          title: data.AbstractSource || 'Resultado',
          url: data.AbstractURL,
          snippet: data.AbstractText.slice(0, 300),
        });
      }

      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, 5)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.split(' - ')[0] || 'Relacionado',
              url: topic.FirstURL,
              snippet: topic.Text.slice(0, 200),
            });
          }
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /** DuckDuckGo Lite HTML (más resultados que la API JSON). */
  private async searchWebLite(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
    try {
      const response = await fetch(
        `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          },
          signal: AbortSignal.timeout(12_000),
        }
      );

      if (!response.ok) { return []; }

      const html = await response.text();
      if (html.includes('anomaly-modal') || !html.includes('result-link')) { return []; }

      const results: { title: string; url: string; snippet: string }[] = [];
      const blockRe =
        /<a[^>]+href="([^"]+)"[^>]*class='result-link'>([^<]+)<\/a>[\s\S]*?class='result-snippet'>\s*([\s\S]*?)<\/td>/gi;

      let match: RegExpExecArray | null;
      while ((match = blockRe.exec(html)) !== null && results.length < 6) {
        const url = this.decodeDdgRedirect(match[1]);
        const title = this.stripHtml(match[2]);
        const snippet = this.stripHtml(match[3]).slice(0, 280);
        if (title && url.startsWith('http')) {
          results.push({ title, url, snippet: snippet || title });
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /** Wikipedia (gratis, fiable). */
  private async searchWikipedia(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
    try {
      const lang = /\b(español|qué|cómo|bot|servidor)\b/i.test(query) ? 'es' : 'en';
      const res = await fetch(
        `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=4&format=json`,
        { signal: AbortSignal.timeout(8_000) }
      );
      if (!res.ok) { return []; }

      const [, titles, descriptions, urls] = await res.json() as [string, string[], string[], string[]];
      return titles.map((title, i) => ({
        title,
        url: urls[i] ?? '',
        snippet: (descriptions[i] || title).slice(0, 280),
      })).filter((r) => r.url);
    } catch {
      return [];
    }
  }

  /** Documentación npm — búsqueda dinámica en registry.npmjs.org. */
  private async searchNpmDocs(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
    const hits = await searchNpmPackages(query, 4);
    return hits.map((h) => ({
      title: `npm: ${h.name}@${h.version}`,
      url: h.url,
      snippet: h.description || `Paquete ${h.name}`,
    }));
  }

  /**
   * Búsqueda web multi-fuente: DDG JSON → DDG Lite → Wikipedia → npm.
   */
  async searchWeb(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
    const sources = [
      () => this.searchWebInstant(query),
      () => this.searchWebLite(query),
      () => this.searchWikipedia(query),
      () => this.searchNpmDocs(query),
    ];

    for (const source of sources) {
      const hits = await source();
      if (hits.length > 0) { return hits; }
    }

    return [];
  }

  /** Varias búsquedas y deduplicación por URL (GitHub/repos primero). */
  async searchWebMulti(
    queries: string[],
    maxResults = 10
  ): Promise<{ title: string; url: string; snippet: string }[]> {
    const seen = new Set<string>();
    const merged: { title: string; url: string; snippet: string }[] = [];

    for (const query of queries) {
      const q = query.trim().slice(0, 120);
      if (!q) { continue; }

      for (const hit of await this.searchWeb(q)) {
        if (seen.has(hit.url)) { continue; }
        seen.add(hit.url);
        merged.push(hit);
      }
    }

    return prioritizeGitHubHits(merged).slice(0, maxResults);
  }

  /** Consultas de búsqueda derivadas de la petición del usuario/agente. */
  buildResearchQueries(prompt: string, blueprint?: ProjectBlueprint | null): string[] {
    const base = prompt.replace(/\s+/g, ' ').trim().slice(0, 100);
    const queries = new Set<string>();

    if (/\b(bot\s+discord|discord\s+bot|discord\.js)\b/i.test(prompt)) {
      queries.add('discord.js v14 slash commands guide');
      queries.add('discord.js voice music bot example');
    }
    if (/\b(telegram)\b/i.test(prompt)) {
      queries.add('telegraf bot API example');
    }
    if (/\b(trivia|quiz)\b/i.test(prompt)) {
      queries.add('Open Trivia DB API documentation');
    }
    if (/\b(clima|weather|tiempo)\b/i.test(prompt)) {
      queries.add('Open-Meteo API free weather');
    }
    if (/\b(github|octokit)\b/i.test(prompt)) {
      queries.add('octokit REST API node example');
    }
    if (/\b(api\s+rest|express|backend)\b/i.test(prompt)) {
      queries.add('express.js REST API tutorial');
    }
    if (/\b(plugin|spigot|papermc|bukkit)\b/i.test(prompt) && /\b(minecraft|mc)\b/i.test(prompt)) {
      queries.add('PaperMC plugin development plugin.yml gradle');
    }
    if (/\b(fabric|quilt)\b/i.test(prompt) && /\b(mod|minecraft)\b/i.test(prompt)) {
      queries.add('Fabric mod development fabric.mod.json loom gradle');
    }
    if (/\b(forge|neoforge)\b/i.test(prompt)) {
      queries.add('Minecraft Forge mod mods.toml gradle setup');
    }
    if (/\b(rom|lineage|aosp)\b/i.test(prompt)) {
      queries.add('LineageOS build device tree setup guide');
    }
    if (/\b(extensi[oó]n|vscode)\b/i.test(prompt)) {
      queries.add('VS Code extension API hello world typescript');
    }
    if (blueprint?.kind === 'minecraft-plugin') {
      queries.add('Paper API JavaPlugin command example');
    }
    if (blueprint?.kind === 'minecraft-mod-fabric') {
      queries.add('Fabric ModInitializer example 1.21');
    }
    if (blueprint?.kind === 'android-rom') {
      queries.add('LineageOS device tree BoardConfig.mk example');
    }

    const apis = detectApiRecommendations(prompt, blueprint);
    for (const api of apis.slice(0, 3)) {
      if (api.docs) { queries.add(`${api.name} API documentation`); }
      else { queries.add(`${api.name} npm example`); }
    }

    queries.add(base);
    if (/\b(api|sdk|lib|framework|npm|discord|react|node|python|bot)\b/i.test(prompt)) {
      queries.add(`${base} documentación oficial`);
      queries.add(`${base} ejemplo código github`);
    } else {
      queries.add(`${base} tutorial`);
    }

    return [...queries].slice(0, 5);
  }

  /**
   * Investiga en internet y devuelve contexto listo para el agente o el chat.
   * Con +Internet activo siempre busca (no solo en preguntas "qué es...").
   */
  async researchWeb(
    prompt: string,
    options: { forAgent?: boolean; blueprint?: ProjectBlueprint | null } = {}
  ): Promise<{ context: string; resultCount: number }> {
    const queries = this.buildResearchQueries(prompt, options.blueprint);
    const results = await this.searchWebMulti(queries);

    if (results.length === 0) {
      return { context: '', resultCount: 0 };
    }

    let context = options.forAgent
      ? '\n\n🌐 INVESTIGACIÓN EN INTERNET (usa esto para programar con info actualizada):\n'
      : '\n\n📚 **Información de Internet:**\n';

    for (const result of results) {
      context += options.forAgent
        ? `\n• ${result.title} (${result.url})\n  ${result.snippet}\n`
        : `\n• **${result.title}**: ${result.snippet}\n`;
    }

    if (!options.forAgent) {
      context += '\n---\n\nUsa esta información para responder:\n\n';
    } else {
      context +=
        '\nAplica lo aprendido en los archivos con bloques ACCION.\n' +
        'Usa APIs/librerías oficiales encontradas — no inventes endpoints.\n';
    }

    return { context, resultCount: results.length };
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

    let webContext = '';
    if (this.needsWebSearch(lastMessage)) {
      onToken('🔍 Investigando en internet...\n\n');
      const { context } = await this.researchWeb(lastMessage);
      webContext = context;
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
  needsWebSearch(text: string): boolean {
    const webTriggers = [
      'qué es', 'que es', 'quien es', 'quién es',
      'busca', 'buscar', 'internet', 'web', 'online',
      'actualidad', 'noticias', 'último', 'ultima', 'última versión',
      'precio', 'cotización', 'tiempo', 'clima',
      'cómo se hace', 'como se hace', 'tutorial',
      'documentación', 'documentacion', 'docs', 'documentacion oficial',
      'versión actual', 'version actual', 'latest', 'release',
      '2024', '2025', '2026', 'hoy', 'ayer',
      'reciente', 'nuevo', 'nueva', 'actualizado',
      'instalar', 'npm ', 'pip ', 'cargo ', 'api de', 'api ', 'apis ',
      'error ', 'stackoverflow', 'github.com', 'github ',
      'bot ', 'discord', 'telegram', 'crea ', 'crear ', 'creame',
      'integra', 'conecta', 'librería', 'libreria', 'sdk',
      'clona', 'clone', 'publica', 'sube a github',
      'openweather', 'trivia', 'clima', 'weather',
    ];

    const lowerText = text.toLowerCase();
    return webTriggers.some((trigger) => lowerText.includes(trigger));
  }

  /** Obtener si el modo internet está activo */
  /** Toggle +Internet del panel (búsqueda web en Ollama local). */
  isInternetEnabled(): boolean {
    return this.useInternet;
  }

  /** Obtener el proveedor configurado por el usuario */
  getProvider(): ProviderName {
    return this.provider;
  }

  /** Obtener el proveedor efectivo tras resolver el modo Auto */
  getResolvedProvider(): ProviderName {
    return this.getEffectiveProvider();
  }
}
