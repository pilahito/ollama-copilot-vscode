/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ollama-copilot-vscode — Agente Autónomo Local
 *  (c) 2026 DavidPilahito7 · Licensed under the MIT License.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Author   : DavidPilahito7
 *  Project  : ollama-copilot-vscode
 *  Module   : ChatViewProvider — Vista de chat lateral y streaming con Ollama
 *  Created  : 2026
 *  Contact  : https://github.com/pilahito
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

import * as vscode from 'vscode';
import { OllamaClient, ProviderName } from './ollamaClient';
import { LocalAgent, FileAction, CommandAction } from './agent';
import { GitHubService } from './githubService';
import {
  enrichMessageWithEditor,
  getDiagnosticsBlock,
  getEditorContextForFix,
  needsEditorContext,
  resolveCodeEditor,
  wantsTeacherFix,
} from './editorContext';
import { EXPLAIN_CODE_PROMPT } from './prompts';
import { enrichUserMessage } from './userIntent';
import { detectBlueprint } from './projectBlueprints';
import { gatherReferenceContext } from './referenceLearner';
import { getEditorActionSpec, type EditorQuickAction } from './editorActions';
import {
  getEffectivePrompt,
  getEditablePrompts,
  PROMPT_DEFAULTS,
  savePrompts,
  restorePromptDefaults,
  type PromptFields,
} from './promptSettings';
import { LOGO_FILE } from './mediaPaths';
import * as fs from 'fs';
import { debugLog } from './debugLog';
import {
  MODEL_CATALOG,
  USE_CASES,
  buildUseCaseProfile,
  getUseCaseLabel,
  type UseCaseId,
} from './modelCatalog';

// ── Tipos de mensajes Webview ────────────────────────────────────────────────

type ChatMode = 'chat' | 'agent' | 'teacher';

type WebviewInMessage =
  | { type: 'send'; text: string; mode: ChatMode; includeEditor?: boolean; forceEditor?: boolean }
  | { type: 'quickAction'; action: EditorQuickAction }
  | { type: 'checkConnection' }
  | { type: 'setProvider'; provider: string }
  | { type: 'setInternetMode'; useInternet: boolean }
  | { type: 'getOllamaModels' }
  | { type: 'ready' }
  | { type: 'getRecommendations' }
  | { type: 'setModel'; model: string }
  | { type: 'openInBrowser' }
  | { type: 'openDonate'; url?: string }
  | { type: 'saveAPIKeys'; keys: Record<string, string> }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; keys: Record<string, string>; models?: Record<string, string>; prompts: PromptFields; agentIdeMode?: boolean; agentSelfModify?: boolean }
  | { type: 'setProviderFromSettings'; provider: string }
  | { type: 'restorePromptDefaults'; fields?: (keyof PromptFields)[] }
  | { type: 'clearChat' }
  | { type: 'cancel' }
  | { type: 'testOllama' }
  | { type: 'applyTaskModel'; task: 'chat' | 'completion' | 'agent' | 'profile'; model?: string; useCase?: string }
  | { type: 'pong'; id: number | string }
  | { type: 'scriptError'; message: string };

/**
 * Vista de chat en la barra lateral (como el panel de Copilot Chat).
 * El usuario escribe su petición y el agente responde, analiza el proyecto
 * y aplica los cambios directamente en disco.
 *
 * @author DavidPilahito7
 * @license MIT
 */
export class LocalChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'local.chatView';

  private view?:  vscode.WebviewView;
  private readonly ollama: OllamaClient;
  private readonly agent:  LocalAgent;
  private cachedModels:    string[] = [];
  private modelsCacheTime = 0;
  private syncModelsPromise: Promise<void> | undefined;
  private chatGeneration = 0;
  private modelsLoaded = false;
  private outputLog: (line: string) => void = () => {};
  private pingResolvers = new Map<string, () => void>();
  private webviewScriptReady = false;
  private lastModelsRequestMs = 0;
  private sendReceivedForTest = false;
  private static readonly MODELS_REQUEST_MIN_MS = 3_000;
  private static readonly MODELS_CACHE_MS = 45_000;
  private static readonly SYNC_TIMEOUT_MS = 12_000;

  constructor(
    private readonly extensionUri: vscode.Uri,
    ollama: OllamaClient,
    github?: GitHubService,
    log?: (line: string) => void
  ) {
    this.ollama = ollama;
    this.agent  = new LocalAgent(ollama, github);
    if (log) { this.outputLog = log; }
  }

  // ── API de VS Code ────────────────────────────────────────────────────────────

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.webviewScriptReady = false;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    const html = this.getHtml(webviewView.webview);
    webviewView.webview.html = html;
    try {
      fs.writeFileSync('/tmp/local-copilot-webview.html', html);
      debugLog('[webview] HTML generado → /tmp/local-copilot-webview.html');
    } catch { /* ignore */ }

    webviewView.webview.onDidReceiveMessage(async (message: WebviewInMessage) => {
      try {
        await this.handleWebviewMessage(message);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.post({ type: 'responseEnd' });
        this.post({ type: 'response', text: `⚠ Error interno: ${errMsg}`, done: true });
      }
    });

    // UI instantánea desde caché (sin esperar red)
    const snap = this.ollama.getBootstrapSnapshot();
    this.applyBootstrapToUi(snap);
    this.post({
      type: 'bootstrap',
      hardware: snap.hardware,
      taskModels: snap.taskModels,
      noModels: snap.noModels,
    });

    webviewView.onDidChangeVisibility((visible) => {
      if (visible) {
        this.postInitState();
        void this.syncOllamaModels();
      }
    });

    setTimeout(
      () => void this.ollama.warmupModel(this.ollama.getModelForTask('chat')),
      5_000
    );
  }

  private async handleWebviewMessage(message: WebviewInMessage): Promise<void> {
      this.trace(`[webview←] ${message.type}`);
      if (message.type === 'pong') {
        const key = String(message.id);
        this.pingResolvers.get(key)?.();
        this.pingResolvers.delete(key);
        return;
      }
      if (message.type === 'scriptError') {
        this.trace(`[webview] scriptError: ${message.message}`);
        vscode.window.showErrorMessage(`Local Copilot UI: ${message.message}`);
        return;
      }
      if (message.type === 'cancel') {
        this.cancelActiveGeneration();
      } else if (message.type === 'clearChat') {
        this.post({ type: 'chatCleared' });
      } else if (message.type === 'testOllama') {
        await this.runOllamaTest();
      } else if (message.type === 'send') {
        const text = message.text?.trim();
        if (!text) { return; }
        this.sendReceivedForTest = true;
        const gen = ++this.chatGeneration;
        this.post({ type: 'sendAck', gen });
        await this.handleUserMessage(
          text,
          message.mode,
          message.includeEditor === true,
          gen,
          message.forceEditor === true
        );
      } else if (message.type === 'quickAction') {
        await this.runEditorQuickAction(message.action);
      } else if (message.type === 'setProvider') {
        const config = vscode.workspace.getConfiguration('local');
        await config.update('provider', message.provider, vscode.ConfigurationTarget.Global);
        if (this.ollama.isInternetProvider(message.provider as ProviderName)) {
          await config.update('useInternet', true, vscode.ConfigurationTarget.Global);
        }
        this.ollama.refreshConfig();
        await this.ollama.resolveAutoProvider();
        const status = await this.ollama.checkConnection();
        this.post({
          type: 'connectionStatus',
          ...status,
          internetEnabled: this.ollama.isInternetEnabled(),
          currentModel: this.getCurrentModel(),
        });
      } else if (message.type === 'setInternetMode') {
        const config = vscode.workspace.getConfiguration('local');
        await config.update('useInternet', message.useInternet, vscode.ConfigurationTarget.Global);
        this.ollama.refreshConfig();
        await this.ollama.resolveAutoProvider();
        const status = await this.ollama.checkConnection();
        this.post({
          type: 'connectionStatus',
          ...status,
          internetEnabled: message.useInternet,
          currentModel: this.getCurrentModel(),
        });
      } else if (message.type === 'ready') {
        this.webviewScriptReady = true;
        this.postInitState();
        this.pushModelsToUi();
        void this.syncOllamaModels();
      } else if (message.type === 'getOllamaModels' || message.type === 'checkConnection') {
        const now = Date.now();
        if (message.type === 'getOllamaModels' && now - this.lastModelsRequestMs < LocalChatViewProvider.MODELS_REQUEST_MIN_MS) {
          this.pushModelsToUi();
          return;
        }
        this.lastModelsRequestMs = now;
        await this.syncOllamaModels();
      } else if (message.type === 'getRecommendations') {
        this.postRecommendations();
      } else if (message.type === 'openInBrowser') {
        await this.ollama.resolveAutoProvider();
        const url = this.ollama.getBrowserChatUrl();
        const browser = this.ollama.getBrowserName();
        vscode.env.openExternal(vscode.Uri.parse(url));
        vscode.window.showInformationMessage(`Abriendo en ${browser}: ${url}`);
      } else if (message.type === 'openDonate') {
        await this.openPayPalDonate(message.url);
      } else if (message.type === 'getSettings') {
        this.postSettingsData();
      } else if (message.type === 'setProviderFromSettings') {
        const config = vscode.workspace.getConfiguration('local');
        await config.update('provider', message.provider, vscode.ConfigurationTarget.Global);
        if (this.ollama.isInternetProvider(message.provider as ProviderName)) {
          await config.update('useInternet', true, vscode.ConfigurationTarget.Global);
        }
        this.ollama.refreshConfig();
        await this.ollama.resolveAutoProvider();
        const status = await this.ollama.checkConnection();
        this.post({
          type: 'connectionStatus',
          ...status,
          internetEnabled: this.ollama.isInternetEnabled(),
          currentModel: this.getCurrentModel(),
        });
        this.post({ type: 'providerChanged', provider: message.provider });
      } else if (message.type === 'saveSettings') {
        await this.saveApiKeys(message.keys);
        if (message.models) {
          await this.saveApiModels(message.models);
        }
        await savePrompts(message.prompts);
        const config = vscode.workspace.getConfiguration('local');
        if (message.agentIdeMode !== undefined) {
          await config.update('agentIdeMode', message.agentIdeMode, vscode.ConfigurationTarget.Global);
        }
        if (message.agentSelfModify !== undefined) {
          await config.update('agentSelfModify', message.agentSelfModify, vscode.ConfigurationTarget.Global);
        }
        this.ollama.refreshConfig();
        vscode.window.showInformationMessage('✓ Ajustes guardados (APIs, modelos, agente IDE y prompts).');
        this.postSettingsData();
      } else if (message.type === 'saveAPIKeys') {
        await this.saveApiKeys(message.keys);
        this.ollama.refreshConfig();
        vscode.window.showInformationMessage('✓ Claves API guardadas.');
        this.postSettingsData();
      } else if (message.type === 'restorePromptDefaults') {
        await restorePromptDefaults(message.fields);
        vscode.window.showInformationMessage('✓ Prompts restaurados por defecto.');
        this.postSettingsData();
      } else if (message.type === 'setModel') {
        const config = vscode.workspace.getConfiguration('local');
        const installed = await this.ollama.getInstalledOllamaModels(true);
        const resolved = this.ollama.resolveInstalledModelName(message.model, installed);
        await config.update('chatModel', resolved, vscode.ConfigurationTarget.Global);
        await config.update('completionModel', resolved, vscode.ConfigurationTarget.Global);
        this.ollama.refreshConfig();
        vscode.window.showInformationMessage(`✓ Modelo cambiado a: ${resolved}`);
        const status = await this.ollama.checkConnection(true);
        this.post({ type: 'connectionStatus', ...status, currentModel: resolved });
        this.post({ type: 'ollamaModels', models: installed, currentModel: resolved });
      } else if (message.type === 'applyTaskModel') {
        await this.applyTaskModel(message.task, message.model, message.useCase);
      }
  }

  private async applyTaskModel(
    task: 'chat' | 'completion' | 'agent' | 'profile',
    model?: string,
    useCase?: string
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('local');
    const installed = await this.ollama.getInstalledOllamaModels(true);
    const hw = this.ollama.getHardwareProfile();

    const applyOne = async (t: 'chat' | 'completion' | 'agent', m: string): Promise<string> => {
      const resolved = this.ollama.resolveInstalledModelName(m, installed);
      const key = t === 'chat' ? 'chatModel' : t === 'completion' ? 'completionModel' : 'agentModel';
      await config.update(key, resolved, vscode.ConfigurationTarget.Global);
      return resolved;
    };

    if (task === 'profile' && useCase) {
      const profile = buildUseCaseProfile(useCase as UseCaseId, installed, hw.tier);
      const parts: string[] = [];
      if (profile.chat) { parts.push(`💬 ${await applyOne('chat', profile.chat)}`); }
      if (profile.completion) { parts.push(`⌨️ ${await applyOne('completion', profile.completion)}`); }
      if (profile.agent) { parts.push(`🤖 ${await applyOne('agent', profile.agent)}`); }
      this.ollama.refreshConfig();
      vscode.window.showInformationMessage(
        `✓ Perfil «${getUseCaseLabel(useCase as UseCaseId)}»: ${parts.join(' · ')}`
      );
    } else if (model && task !== 'profile') {
      const resolved = await applyOne(task, model);
      this.ollama.refreshConfig();
      const labels = { chat: 'Chat', completion: 'Autocompletado', agent: 'Agente' };
      vscode.window.showInformationMessage(`✓ ${labels[task]}: ${resolved}`);
    }

    const status = await this.ollama.checkConnection(true);
    this.post({ type: 'connectionStatus', ...status });
    this.pushModelsToUi();
    this.postSettingsData();
  }

  private async saveApiKeys(keys: Record<string, string>): Promise<void> {
    const config = vscode.workspace.getConfiguration('local');
    const keyMap: Record<string, string> = {
      groq: 'groqApiKey',
      cerebras: 'cerebrasApiKey',
      together: 'togetherApiKey',
      cohere: 'cohereApiKey',
      huggingface: 'huggingfaceApiKey',
      gemini: 'geminiApiKey',
      openrouter: 'openRouterApiKey',
    };
    for (const [key, setting] of Object.entries(keyMap)) {
      const value = keys[key]?.trim();
      if (value) {
        await config.update(setting, value, vscode.ConfigurationTarget.Global);
      }
    }
  }

  private async saveApiModels(models: Record<string, string>): Promise<void> {
    const config = vscode.workspace.getConfiguration('local');
    const modelMap: Record<string, string> = {
      groq: 'groqModel',
      cerebras: 'cerebrasModel',
      together: 'togetherModel',
      cohere: 'cohereModel',
      huggingface: 'huggingfaceModel',
      gemini: 'geminiModel',
      openrouter: 'openRouterModel',
    };
    for (const [key, setting] of Object.entries(modelMap)) {
      const value = models[key]?.trim();
      if (value) {
        await config.update(setting, value, vscode.ConfigurationTarget.Global);
      }
    }
  }

  private postSettingsData(): void {
    const config = vscode.workspace.getConfiguration('local');
    const snap = this.ollama.getBootstrapSnapshot();
    this.post({
      type: 'settingsData',
      keysConfigured: {
        groq: !!config.get('groqApiKey', ''),
        cerebras: !!config.get('cerebrasApiKey', ''),
        together: !!config.get('togetherApiKey', ''),
        cohere: !!config.get('cohereApiKey', ''),
        huggingface: !!config.get('huggingfaceApiKey', ''),
        gemini: !!config.get('geminiApiKey', ''),
        openrouter: !!config.get('openRouterApiKey', ''),
      },
      apiModels: {
        groq: config.get('groqModel', ''),
        cerebras: config.get('cerebrasModel', ''),
        together: config.get('togetherModel', ''),
        cohere: config.get('cohereModel', ''),
        huggingface: config.get('huggingfaceModel', ''),
        gemini: config.get('geminiModel', ''),
        openrouter: config.get('openRouterModel', ''),
      },
      hardware: this.ollama.getHardwareProfile(),
      installed: (snap.models as string[]) ?? [],
      taskModels: snap.taskModels,
      configuredModels: {
        chat: config.get<string>('chatModel', ''),
        completion: config.get<string>('completionModel', ''),
        agent: config.get<string>('agentModel', '') || config.get<string>('chatModel', ''),
      },
      useCases: USE_CASES,
      catalog: MODEL_CATALOG,
      prompts: getEditablePrompts(),
      defaults: PROMPT_DEFAULTS,
      agentIdeMode: config.get<boolean>('agentIdeMode', false),
      agentSelfModify: config.get<boolean>('agentSelfModify', false),
    });
  }

  private async openPayPalDonate(urlFromWebview?: string): Promise<void> {
    const raw = urlFromWebview?.trim()
      || vscode.workspace.getConfiguration('local').get<string>('paypalDonateUrl', 'https://www.paypal.com/paypalme/pilahito');
    const donateUrl = raw.startsWith('http') ? raw : `https://${raw}`;
    const uri = vscode.Uri.parse(donateUrl);

    try {
      await vscode.env.openExternal(uri);
      vscode.window.showInformationMessage('¡Gracias por apoyar Local Copilot! 💙');
      return;
    } catch {
      /* fallback abajo */
    }

    const pick = await vscode.window.showInformationMessage(
      `Donación PayPal: ${donateUrl}`,
      'Abrir en navegador',
      'Copiar enlace'
    );
    if (pick === 'Abrir en navegador') {
      await vscode.env.openExternal(uri);
    } else if (pick === 'Copiar enlace') {
      await vscode.env.clipboard.writeText(donateUrl);
      vscode.window.showInformationMessage('Enlace PayPal copiado al portapapeles.');
    }
  }

  /** Envía modelos en caché al panel (respuesta instantánea). */
  public pushModelsToUi(): void {
    const snap = this.ollama.getBootstrapSnapshot();
    this.applyBootstrapToUi(snap);
  }

  /** Sincroniza selector IA / +Internet con la configuración guardada. */
  private postInitState(): void {
    const config = vscode.workspace.getConfiguration('local');
    this.post({
      type: 'initState',
      provider: config.get<string>('provider', 'auto'),
      useInternet: config.get<boolean>('useInternet', false),
    });
  }

  /** Abre el modal de recomendaciones (p. ej. desde notificación sin modelos). */
  public requestRecommendations(): void {
    void this.reveal();
    this.post({ type: 'openRecommendations' });
    this.postRecommendations();
  }

  // ── API pública ───────────────────────────────────────────────────────────────

  /**
   * Permite que comandos externos (clic derecho "explicar/arreglar")
   * empujen texto al chat y abran el panel automáticamente.
   */
  /** Espera a que VS Code cree la webview del chat (barra de actividad). */
  public async waitUntilReady(timeoutMs = 8000): Promise<boolean> {
    const start = Date.now();
    while (!this.view && Date.now() - start < timeoutMs) {
      await new Promise<void>((r) => setTimeout(r, 80));
    }
    return !!this.view;
  }

  public isReady(): boolean {
    return !!this.view;
  }

  /** Fuerza sincronización de modelos (usado por autotest/monitor). */
  public async forceSyncModels(): Promise<void> {
    this.modelsLoaded = false;
    await this.syncOllamaModels();
  }

  /** Espera a que el selector deje de mostrar "Cargando modelos…". */
  public async waitForModelsLoaded(timeoutMs = 12_000): Promise<boolean> {
    const start = Date.now();
    while (!this.modelsLoaded && Date.now() - start < timeoutMs) {
      await new Promise<void>((r) => setTimeout(r, 200));
    }
    return this.modelsLoaded;
  }

  /** Muestra el panel de chat en la barra lateral derecha. */
  public async reveal(): Promise<void> {
    await this.waitUntilReady();
    if (this.view) {
      await this.view.show?.(true);
    }
  }

  public sendExternalPrompt(text: string, mode: ChatMode = 'chat'): void {
    void this.reveal();
    this.post({ type: 'prefill', text, mode });
  }

  private pendingEditorEnrich: ReturnType<typeof enrichMessageWithEditor> | undefined;

  /** Acción rápida del editor: explicar, generar, arreglar o refactorizar. */
  public async runEditorQuickAction(action: EditorQuickAction): Promise<void> {
    const editor = resolveCodeEditor();
    if (!editor) {
      vscode.window.showWarningMessage(
        'Abre un archivo de código en el editor (o selecciona texto) y vuelve a intentarlo.'
      );
      return;
    }

    const spec = getEditorActionSpec(action);
    if (spec.mode === 'agent' && !vscode.workspace.workspaceFolders?.length) {
      vscode.window.showWarningMessage(
        'Refactorizar requiere una carpeta de proyecto abierta (Archivo → Abrir carpeta).'
      );
      return;
    }

    this.pendingEditorEnrich = enrichMessageWithEditor(spec.prompt, spec.attachEditor);
    await this.reveal();
    await this.waitUntilReady(8000);

    const gen = ++this.chatGeneration;
    this.post({ type: 'sendAck', gen });
    await this.handleUserMessage(spec.prompt, spec.mode, spec.attachEditor, gen, true);
  }

  /** Explica código del editor (captura ANTES de que el chat robe el foco). */
  public async explainFromEditor(): Promise<void> {
    await this.runEditorQuickAction('explain');
  }

  /** Limpia el historial del chat en el panel. */
  public clearChat(): void {
    this.cancelActiveGeneration();
    this.post({ type: 'chatCleared' });
  }

  /** Ping→pong para verificar que la webview recibe y responde mensajes. */
  public async testWebviewPing(timeoutMs = 6000): Promise<boolean> {
    await this.reveal();
    if (!this.view) {
      this.trace('[ping] webview no creada');
      return false;
    }
    const start = Date.now();
    while (!this.webviewScriptReady && Date.now() - start < timeoutMs) {
      await new Promise<void>((r) => setTimeout(r, 100));
    }
    if (!this.webviewScriptReady) {
      this.trace('[ping] script webview no envió ready');
      return false;
    }
    const id = String(Date.now());
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pingResolvers.delete(id);
        this.trace('[ping] timeout — webview no respondió');
        resolve(false);
      }, Math.max(2000, timeoutMs - (Date.now() - start)));
      this.pingResolvers.set(id, () => {
        clearTimeout(timer);
        this.trace('[ping] pong OK');
        resolve(true);
      });
      this.post({ type: 'ping', id });
    });
  }

  /**
   * Prueba el pipeline completo extensión→Ollama→webview (sin clic del usuario).
   * Captura mensajes enviados a la webview durante un envío simulado.
   */
  public async testChatPipeline(
    mode: ChatMode,
    text: string,
    timeoutMs = 90_000
  ): Promise<{ ok: boolean; events: string[]; snippet: string }> {
    const events: string[] = [];
    let snippet = '';
    const origPost = this.post.bind(this);
    const restore = (): void => { this.post = origPost; };

    this.post = (msg: Record<string, unknown>) => {
      const t = String(msg.type ?? '?');
      events.push(t);
      if (t === 'token' && typeof msg.text === 'string') {
        snippet += msg.text;
      } else if (t === 'response' && typeof msg.text === 'string') {
        snippet = msg.text;
      }
      origPost(msg);
    };

    try {
      await this.reveal();
      if (!this.view) {
        return { ok: false, events: ['no-view'], snippet: '' };
      }
      const gen = ++this.chatGeneration;
      this.post({ type: 'sendAck', gen });
      const done = new Promise<void>((resolve) => {
        const check = (): void => {
          if (events.includes('responseEnd') || events.includes('response')) {
            resolve();
          }
        };
        const interval = setInterval(() => {
          check();
          if (events.includes('responseEnd') || events.includes('response')) {
            clearInterval(interval);
          }
        }, 200);
        setTimeout(() => { clearInterval(interval); resolve(); }, timeoutMs);
      });

      await this.handleUserMessage(text, mode, false, gen);
      await done;

      const ok = snippet.trim().length > 3 &&
        (events.includes('responseEnd') || events.includes('response'));
      this.trace(`[pipeline:${mode}] events=${events.join(',')} ok=${ok}`);
      return { ok, events, snippet: snippet.trim().slice(0, 200) };
    } finally {
      restore();
    }
  }

  /** Prueba envío real webview→extensión→Ollama (como si el usuario pulsara Enter). */
  public async testWebviewUserSend(
    text: string,
    mode: ChatMode = 'chat',
    timeoutMs = 90_000
  ): Promise<{ ok: boolean; events: string[]; snippet: string }> {
    const events: string[] = [];
    let snippet = '';
    const origPost = this.post.bind(this);
    const restore = (): void => { this.post = origPost; };

    this.post = (msg: Record<string, unknown>) => {
      const t = String(msg.type ?? '?');
      events.push(t);
      if (t === 'token' && typeof msg.text === 'string') snippet += msg.text;
      if (t === 'response' && typeof msg.text === 'string') snippet = msg.text;
      origPost(msg);
    };

    try {
      await this.reveal();
      if (!this.view || !this.webviewScriptReady) {
        return { ok: false, events: ['not-ready'], snippet: '' };
      }
      this.sendReceivedForTest = false;
      origPost({ type: 'simulateSend', text, mode });

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (this.sendReceivedForTest &&
            (events.includes('responseEnd') || events.includes('response'))) {
          break;
        }
        await new Promise<void>((r) => setTimeout(r, 250));
      }

      const ok = this.sendReceivedForTest && snippet.trim().length > 1 &&
        (events.includes('responseEnd') || events.includes('response'));
      this.trace(`[userSend:${mode}] send=${this.sendReceivedForTest} ok=${ok}`);
      return { ok, events, snippet: snippet.trim().slice(0, 200) };
    } finally {
      restore();
    }
  }

  /** Prueba prefill (comando Explicar código / Arreglar error). */
  public async testPrefillFlow(
    text: string,
    mode: ChatMode = 'chat',
    timeoutMs = 90_000
  ): Promise<boolean> {
    const events: string[] = [];
    let snippet = '';
    const origPost = this.post.bind(this);
    const restore = (): void => { this.post = origPost; };
    this.post = (msg: Record<string, unknown>) => {
      const t = String(msg.type ?? '?');
      events.push(t);
      if (t === 'token' && typeof msg.text === 'string') snippet += msg.text;
      if (t === 'response' && typeof msg.text === 'string') snippet = msg.text;
      origPost(msg);
    };
    try {
      await this.reveal();
      if (!this.view || !this.webviewScriptReady) return false;
      this.sendReceivedForTest = false;
      origPost({ type: 'prefill', text, mode });
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (this.sendReceivedForTest && (events.includes('responseEnd') || events.includes('response'))) {
          break;
        }
        await new Promise<void>((res) => setTimeout(res, 250));
      }
      const ok = this.sendReceivedForTest && snippet.trim().length > 1;
      this.trace(`[prefill:${mode}] ok=${ok}`);
      return ok;
    } finally {
      restore();
    }
  }

  // ── Lógica de mensajes ────────────────────────────────────────────────────────

  private cancelActiveGeneration(): void {
    this.chatGeneration++;
    this.post({ type: 'generationCancelled' });
  }

  private isGenerationActive(gen: number): boolean {
    return gen === this.chatGeneration;
  }

  private async runOllamaTest(): Promise<void> {
    try {
      const status = await this.ollama.checkConnection(true);
      const models = status.models?.length
        ? status.models
        : await this.ollama.getInstalledOllamaModels(true);
      this.post({
        type: 'testResult',
        ok: status.ok && models.length > 0,
        message: status.ok
          ? `✓ Ollama OK — ${models.length} modelo(s): ${models.slice(0, 3).join(', ')}${models.length > 3 ? '…' : ''}`
          : (status.message ?? 'No se detecta Ollama. Ejecuta: ollama serve'),
      });
      if (models.length > 0) {
        await this.refreshConnectionAndModels(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.post({ type: 'testResult', ok: false, message: `⚠ Error: ${msg}` });
    }
  }

  private async handleUserMessage(
    text: string,
    mode: ChatMode,
    includeEditor = false,
    gen = this.chatGeneration,
    forceEditor = false
  ): Promise<void> {
    let enriched: ReturnType<typeof enrichMessageWithEditor>;

    if (this.pendingEditorEnrich) {
      enriched = this.pendingEditorEnrich;
      this.pendingEditorEnrich = undefined;
    } else if (mode === 'agent') {
      if (forceEditor || includeEditor) {
        enriched = enrichMessageWithEditor(text, true);
      } else {
        enriched = { text, attached: false, filePath: '', source: 'none' };
      }
    } else if (mode === 'teacher') {
      const fixIntent = wantsTeacherFix(text);
      enriched = enrichMessageWithEditor(text, fixIntent || needsEditorContext(text));
      if (fixIntent) {
        await this.handleTeacherFixMode(text, enriched, gen);
        return;
      }
    } else {
      const wantsCode = forceEditor || includeEditor || needsEditorContext(text);
      enriched = enrichMessageWithEditor(text, wantsCode);
      if (wantsCode && !enriched.attached) {
        enriched = {
          ...enriched,
          text:
            `${text}\n\n` +
            '[Nota interna: no hay código en el editor. Responde de forma útil y breve. ' +
            'Si hace falta ver el código, pídelo en una sola frase corta. ' +
            'No des pasos sobre cómo usar VS Code ni el panel del editor.]',
        };
      }
    }

    if (enriched.attached) {
      this.post({
        type: 'contextAttached',
        filePath: enriched.filePath,
        source: enriched.source,
      });
    }

    if (!this.isGenerationActive(gen)) { return; }

    if (mode === 'agent') {
      await this.handleAgentMode(enriched.text, gen);
      return;
    }
    await this.handleChatMode(enriched.text, enriched.attached, mode === 'teacher' ? 'teacher' : 'chat', gen);
  }

  /**
   * Modo agente: analiza el proyecto y aplica cambios directamente en disco.
   * El agente informa del progreso mediante callbacks en tiempo real.
   */
  private async handleAgentMode(text: string, gen: number): Promise<void> {
    try {
      if (!vscode.workspace.workspaceFolders?.length) {
        this.post({
          type: 'response',
          text:
            '⚠ **Agente necesita un proyecto abierto.**\n\n' +
            '1. **Archivo → Abrir carpeta** (tu bot, web, etc.)\n' +
            '2. Pestaña **Agente** y describe qué crear o modificar\n' +
            '3. El agente escribe archivos en disco automáticamente\n\n' +
            '_Sin carpeta abierta solo funcionan Chat y Profesor (con archivo en el editor)._',
          done: true,
        });
        return;
      }

      let status = await this.ollama.checkConnection(true);
      if (!status.ok) {
        const installed = await this.ollama.getInstalledOllamaModels(true);
        const prov = vscode.workspace.getConfiguration('local').get<string>('provider', 'auto');
        if (installed.length > 0 && (prov === 'auto' || prov === 'ollama')) {
          status = { ok: true, models: installed, provider: prov, effectiveProvider: 'ollama' };
        } else {
          this.post({
            type: 'response',
            text: `⚠ **Agente no disponible.** ${status.message ?? 'Comprueba Ollama o configura una API en ⚙️.'}`,
            done: true,
          });
          return;
        }
      }

      const agentModel = this.ollama.getModelForTask('agent');
      this.post({ type: 'responseStart' });
      this.post({ type: 'progress', text: `🧠 Agente (${agentModel}) programando — la extensión escribe en disco…` });
      const result = await this.agent.handleRequest(text, (progress) => {
        if (!this.isGenerationActive(gen)) { return; }
        this.post({ type: 'progress', text: progress });
      }, agentModel);

      if (!this.isGenerationActive(gen)) { return; }

      let summary = `${result.explanation}\n\n`;

      if (result.actions.length > 0) {
        summary += '**Archivos modificados:**\n';
        for (const action of result.actions as FileAction[]) {
          const icon = action.type === 'create' ? '🆕'
                     : action.type === 'delete' ? '🗑️'
                     : '✏️';
          summary += `${icon} \`${action.filePath}\` — ${action.reason}\n`;
        }
      }

      if (result.commands.length > 0) {
        summary += '\n**Comandos ejecutados:**\n';
        for (const cmd of result.commands as CommandAction[]) {
          summary += `▶ \`${cmd.command}\` — ${cmd.reason}\n`;
        }
      }

      if (result.githubTools.length > 0) {
        summary += '\n**GitHub:**\n';
        for (const gh of result.githubTools) {
          const label = gh.type === 'publish' ? '🌍 Publicar'
            : gh.type === 'commit_push' ? '📤 Commit + push'
              : '📋 Status';
          summary += `${label} — ${gh.reason}\n`;
        }
      }

      const hasWork = result.actions.length > 0 ||
        result.commands.length > 0 ||
        result.githubTools.length > 0;

      if (!hasWork) {
        const refused = /\b(no puedo|derechos de autor|copyright|lo siento)\b/i.test(result.explanation);
        summary += refused
          ? '_El modelo rechazó modificar código (falso positivo de copyright). Reintenta con: "Modifica directamente los archivos del proyecto" o usa un modelo coder más grande (14b)._'
          : '_El agente no generó cambios. Sé más específico: "Modifica src/archivo.ts y arregla X" o "publica en GitHub"._';
      }

      if (hasWork) {
        summary += '\n_Aplicado por **Ollama** en modo Agente (no asistente externo)._';
      }

      this.post({ type: 'response', text: summary, done: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: 'response', text: `⚠ Error: ${message}`, done: true });
    }
  }

  /**
   * Modo Profesor + corrección: diagnostica qué falla y escribe el fix en el editor.
   */
  private async handleTeacherFixMode(
    text: string,
    enriched: ReturnType<typeof enrichMessageWithEditor>,
    gen: number
  ): Promise<void> {
    const status = await this.ollama.checkConnection();
    if (!status.ok) {
      this.post({
        type: 'response',
        text: `⚠ Profesor no disponible. ${status.message ?? 'Comprueba Ollama.'}`,
        done: true,
      });
      return;
    }

    const ctx = getEditorContextForFix();
    if (!ctx.code || !ctx.filePath) {
      this.post({
        type: 'response',
        text:
          '⚠️ **Para corregir, abre el archivo con el error** en el editor izquierdo.\n\n' +
          '1. Abre el `.js`, `.ts`, `.py`, etc. que falla\n' +
          '2. (Opcional) Selecciona la parte problemática\n' +
          '3. Vuelve a Profesor y di: *"esto falla, corrígelo"* o *"arregla el error"*',
        done: true,
      });
      return;
    }

    const diags = getDiagnosticsBlock(ctx.filePath);
    if (diags) {
      this.post({
        type: 'contextAttached',
        filePath: vscode.workspace.asRelativePath(ctx.filePath),
        source: 'diagnostics',
      });
    }

    try {
      const teacherModel = this.ollama.getModelForTask('teacher');
      this.post({ type: 'responseStart' });
      this.post({ type: 'progress', text: `🎓 Profesor (${teacherModel}) — diagnostica y corrige…` });

      const result = await this.agent.handleTeacherFix(
        enriched.attached ? enriched.text : text,
        ctx.filePath,
        ctx.code,
        diags,
        (progress) => {
          if (!this.isGenerationActive(gen)) { return; }
          this.post({ type: 'progress', text: progress });
        },
        teacherModel
      );

      if (!this.isGenerationActive(gen)) { return; }

      let summary = result.explanation || 'Diagnóstico completado.';
      if (result.actions.length > 0) {
        summary += '\n\n**Archivo corregido:**\n';
        for (const a of result.actions) {
          summary += `✏️ \`${a.filePath}\` — ${a.reason}\n`;
        }
      }
      if (result.commands.length > 0) {
        summary += '\n**Comandos ejecutados:**\n';
        for (const c of result.commands) {
          summary += `▶ \`${c.command}\` — ${c.reason}\n`;
        }
      }
      if (!result.actions.length && !result.commands.length) {
        summary += '\n\n_Si el fix no se aplicó, copia la sugerencia del diagnóstico o pide más detalle._';
      } else {
        summary += '\n\n_Revisa **Problems** (Ctrl+Shift+M) para ver si quedan errores._';
      }

      this.post({ type: 'response', text: summary, done: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: 'response', text: `⚠ Error: ${message}`, done: true });
    }
  }

  /**
   * Modo chat: streaming directo con Ollama, sin tocar archivos del proyecto.
   * Si el modo internet está activo, usa búsqueda web + IA local.
   */
  private async handleChatMode(
    text: string,
    hasEditorCode = false,
    chatMode: 'chat' | 'teacher' = 'chat',
    gen = this.chatGeneration
  ): Promise<void> {
    let status = await this.ollama.checkConnection(true);
    if (!status.ok) {
      const installed = await this.ollama.getInstalledOllamaModels(true);
      const config = vscode.workspace.getConfiguration('local');
      const prov = config.get<string>('provider', 'auto');
      if (installed.length > 0 && (prov === 'auto' || prov === 'ollama')) {
        status = {
          ok: true,
          models: installed,
          provider: prov,
          effectiveProvider: 'ollama',
          message: `✓ ${installed.length} modelo(s) Ollama`,
        };
      } else {
        const providerName = status.provider === 'gemini'
          ? 'Gemini'
          : status.provider === 'openrouter'
            ? 'OpenRouter'
            : status.provider === 'groq'
              ? 'Groq'
              : 'Ollama';
        this.post({
          type: 'response',
          text: `⚠ No se pudo usar ${providerName}. ${status.message ?? 'Revisa ⚙️ APIs o cambia a Auto/Ollama.'}`,
          done: true,
        });
        return;
      }
    }

    this.post({ type: 'responseStart' });
    let streamStarted = false;
    try {
      streamStarted = true;
      let systemContent = getEffectivePrompt('chat');
      if (chatMode === 'teacher') {
        systemContent = hasEditorCode || needsEditorContext(text)
          ? `${getEffectivePrompt('teacher')}\n\n${EXPLAIN_CODE_PROMPT}`
          : getEffectivePrompt('teacher');
      } else if (hasEditorCode || needsEditorContext(text)) {
        systemContent = EXPLAIN_CODE_PROMPT;
      }

      let userContent = enrichUserMessage(text);
      const blueprint = detectBlueprint(text, [], false, false, 'index.js');

      const chatModel = chatMode === 'teacher'
        ? this.ollama.getModelForTask('teacher')
        : this.ollama.getModelForTask('chat');

      // Con código del editor no hace falta buscar en internet primero
      const skipWeb = hasEditorCode || needsEditorContext(text);

      const onToken = (token: string) => {
        if (!this.isGenerationActive(gen)) { return; }
        this.post({ type: 'token', text: token });
      };

      let referenceContext = '';
      if (!skipWeb) {
        const ref = await gatherReferenceContext(text, blueprint, {
          internetEnabled: this.ollama.isInternetEnabled(),
          searchMulti: (queries) => this.ollama.searchWebMulti(queries, 14),
        });
        if (ref?.context) {
          referenceContext = ref.context;
          if (this.isGenerationActive(gen)) {
            this.post({ type: 'token', text: `${ref.summary}\n\n` });
          }
        }
      }

      userContent = referenceContext + userContent;
      const messages = [
        { role: 'system' as const, content: systemContent },
        { role: 'user' as const,   content: userContent }
      ];

      const wantsWeb = this.ollama.isInternetEnabled() && !skipWeb && this.ollama.needsWebSearch(text);

      if (wantsWeb) {
        if (this.ollama.getResolvedProvider() === 'ollama') {
          await this.ollama.chatWithWebSearch(messages, onToken, chatModel);
        } else {
          if (this.isGenerationActive(gen)) {
            this.post({ type: 'token', text: '🔍 Investigando APIs y documentación...\n\n' });
          }
          const { context } = await this.ollama.researchWeb(text, { blueprint });
          if (!this.isGenerationActive(gen)) { return; }
          const enhanced = context
            ? [{ role: 'system' as const, content: systemContent }, { role: 'user' as const, content: context + userContent }]
            : messages;
          await this.ollama.chatStream(enhanced, onToken, chatModel);
        }
      } else {
        if (hasEditorCode && this.isGenerationActive(gen)) {
          this.post({ type: 'token', text: '📂 Analizando código del editor...\n\n' });
        }
        await this.ollama.chatStream(messages, onToken, chatModel);
      }
      if (!this.isGenerationActive(gen)) { return; }
      this.post({ type: 'responseEnd' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (streamStarted) {
        this.post({ type: 'responseEnd' });
      }
      this.post({ type: 'response', text: `⚠ Error de conexión: ${message}`, done: true });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private getCurrentModel(): string {
    const config = vscode.workspace.getConfiguration('local');
    return config.get<string>('chatModel', '') || config.get<string>('completionModel', '');
  }

  private static normalizeModelName(name: string): string {
    return name.replace(/:latest$/i, '').trim();
  }

  private static modelsMatch(a: string, b: string): boolean {
    if (!a || !b) { return false; }
    const na = LocalChatViewProvider.normalizeModelName(a);
    const nb = LocalChatViewProvider.normalizeModelName(b);
    return na === nb || a === b || a.startsWith(`${nb}:`) || b.startsWith(`${na}:`);
  }

  private postRecommendations(): void {
    const snap = this.ollama.getBootstrapSnapshot();
    const config = vscode.workspace.getConfiguration('local');
    this.post({
      type: 'recommendations',
      hardware: this.ollama.getHardwareProfile(),
      installed: snap.models as string[],
      taskModels: snap.taskModels,
      configuredModels: {
        chat: config.get<string>('chatModel', ''),
        completion: config.get<string>('completionModel', ''),
        agent: config.get<string>('agentModel', '') || config.get<string>('chatModel', ''),
      },
      useCases: USE_CASES,
      catalog: MODEL_CATALOG,
    });
  }

  private applyBootstrapToUi(snap: Record<string, unknown>): void {
    const models = (snap.models as string[]) ?? [];
    const current = (snap.currentModel as string) || this.getCurrentModel();
    if (models.length > 0) {
      this.cachedModels = models;
    }
    const statusMsg = snap.message as string | undefined;
    this.post({
      type: 'connectionStatus',
      ok: !!(snap.ok ?? models.length > 0),
      models,
      message: statusMsg,
      provider: (snap.provider as string) ?? 'auto',
      effectiveProvider: (snap.effectiveProvider as string) ?? 'ollama',
      internetEnabled: !!snap.internetEnabled,
      currentModel: current,
      noModels: !!snap.noModels,
      taskModels: snap.taskModels,
    });
    this.post({
      type: 'ollamaModels',
      models: models.length > 0 ? models : (current ? [current] : []),
      currentModel: current,
      loading: models.length === 0 && !current,
    });
  }

  /** Actualiza modelos Ollama y el selector del chat. */
  private syncOllamaModels(): Promise<void> {
    if (this.syncModelsPromise) {
      return this.syncModelsPromise;
    }
    this.syncModelsPromise = this.runSyncOllamaModels().finally(() => {
      this.syncModelsPromise = undefined;
    });
    return this.syncModelsPromise;
  }

  private async runSyncOllamaModels(): Promise<void> {
    this.post({
      type: 'ollamaModels',
      models: this.cachedModels,
      currentModel: this.getCurrentModel(),
      loading: true,
    });

    try {
      const work = this.refreshConnectionAndModels(true);
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Tiempo agotado conectando con Ollama')), LocalChatViewProvider.SYNC_TIMEOUT_MS);
      });
      await Promise.race([work, timeout]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const cached = this.ollama.getBootstrapSnapshot().models as string[];
      const current = this.getCurrentModel();
      this.post({
        type: 'connectionStatus',
        ok: false,
        models: cached,
        message: `⚠ ${msg}. ¿Está "ollama serve" en marcha?`,
        provider: 'ollama',
        effectiveProvider: 'ollama',
        internetEnabled: this.ollama.isInternetEnabled(),
        currentModel: current,
        noModels: !cached.length,
      });
      this.post({
        type: 'ollamaModels',
        models: cached.length ? cached : (current ? [current] : []),
        currentModel: current,
        loading: false,
        error: msg,
      });
    }
  }

  private async refreshConnectionAndModels(force = false): Promise<void> {
    const useInternet = this.ollama.isInternetEnabled();
    const current     = this.getCurrentModel();
    const now         = Date.now();

    if (!force && now - this.modelsCacheTime < LocalChatViewProvider.MODELS_CACHE_MS && this.cachedModels.length > 0) {
      this.post({
        type: 'connectionStatus',
        ok: true,
        models: this.cachedModels,
        provider: 'ollama',
        effectiveProvider: 'ollama',
        internetEnabled: useInternet,
        currentModel: current,
      });
      this.post({ type: 'ollamaModels', models: this.cachedModels, currentModel: current, loading: false });
      return;
    }

    const status = await this.ollama.checkConnection(force);
    const models = status.models?.length
      ? status.models
      : await this.ollama.getInstalledOllamaModels(true);

    if (models.length > 0) {
      this.cachedModels    = models;
      this.modelsCacheTime = now;
    }

    this.post({
      type: 'connectionStatus',
      ...status,
      internetEnabled: useInternet,
      currentModel: current,
      noModels: models.length === 0 && !status.ok,
      taskModels: this.ollama.getBootstrapSnapshot().taskModels,
    });
    this.post({
      type: 'ollamaModels',
      models: models.length > 0 ? models : (current ? [current] : []),
      currentModel: current,
      loading: false,
    });
  }

  private async loadOllamaModels(): Promise<void> {
    await this.refreshConnectionAndModels(true);
  }

  private trace(line: string): void {
    this.outputLog(line);
    debugLog(line);
  }

  private post(msg: Record<string, unknown>): void {
    const t = String(msg.type ?? '?');
    if (t === 'ollamaModels') {
      const loading = !!msg.loading;
      const count = Array.isArray(msg.models) ? msg.models.length : 0;
      if (!loading && count > 0) {
        this.modelsLoaded = true;
      }
      this.trace(`[webview→] ${t} loading=${loading} models=${count}`);
    } else if (t !== 'token' && t !== 'progress') {
      this.trace(`[webview→] ${t}`);
    }
    if (!this.view) {
      this.trace(`[webview→] DESCARTADO (sin vista): ${t}`);
      return;
    }
    void this.view.webview.postMessage(msg);
  }

  private getExtensionVersion(): string {
    return vscode.extensions.getExtension('pilahito.local-copilot')?.packageJSON.version ?? '0.0.0';
  }

  // ── HTML de la Webview ────────────────────────────────────────────────────────

  private getHtml(webview: vscode.Webview): string {
    const version = this.getExtensionVersion();
    const donateUrl = vscode.workspace
      .getConfiguration('local')
      .get<string>('paypalDonateUrl', 'https://www.paypal.com/paypalme/pilahito');
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', LOGO_FILE)
    ).toString();
    return /* html */ `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  
  :root {
    --primary: #8B5CF6;
    --primary-hover: #7C3AED;
    --success: #10B981;
    --warning: #F59E0B;
    --danger: #EF4444;
    --bg-dark: #0D1117;
    --bg-card: #161B22;
    --border: #30363D;
    --text: #E6EDF3;
    --text-muted: #8B949E;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    background: var(--vscode-sideBar-background, var(--bg-dark));
    color: var(--vscode-foreground, var(--text));
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     HEADER
  ═══════════════════════════════════════════════════════════════════════════ */
  
  .header {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%);
    border-bottom: 1px solid var(--vscode-panel-border, var(--border));
    padding: 12px 16px;
  }

  .header-top {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .logo {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }

  .brand-icon, .avatar-img, .welcome-icon-img, .tab-icon-img {
    object-fit: cover;
    border-radius: inherit;
  }

  .brand-icon { width: 32px; height: 32px; border-radius: 8px; }
  .avatar-img { width: 100%; height: 100%; border-radius: 50%; }
  .welcome-icon-img { width: 64px; height: 64px; border-radius: 14px; margin-bottom: 16px; }
  .tab-icon-img { width: 16px; height: 16px; border-radius: 4px; vertical-align: middle; }

  .title-section {
    flex: 1;
  }

  .title {
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground, var(--text));
  }

  .subtitle {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, var(--text-muted));
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 500;
    max-width: 160px;
    flex-shrink: 1;
  }

  #status-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-badge.online {
    background: rgba(16, 185, 129, 0.15);
    color: #34D399;
  }

  .status-badge.offline {
    background: rgba(239, 68, 68, 0.15);
    color: #F87171;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .controls {
    display: flex;
    gap: 8px;
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--vscode-input-background, var(--bg-card));
    border: 1px solid var(--vscode-input-border, var(--border));
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
  }

  .control-group label {
    color: var(--vscode-descriptionForeground, var(--text-muted));
    font-size: 11px;
  }

  .control-group select {
    background: transparent;
    border: none;
    color: var(--vscode-foreground, var(--text));
    font-size: 12px;
    cursor: pointer;
    outline: none;
  }

  .control-group select option {
    background: var(--vscode-dropdown-background, var(--bg-card));
    color: var(--vscode-foreground, var(--text));
  }

  .control-group select optgroup {
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    padding: 8px 0 4px;
  }

  .btn-icon {
    background: var(--vscode-button-secondaryBackground, var(--bg-card));
    border: 1px solid var(--vscode-button-border, var(--border));
    color: var(--vscode-foreground, var(--text));
    border-radius: 6px;
    padding: 6px 8px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  }

  .btn-icon:hover {
    background: var(--vscode-button-hoverBackground, var(--primary));
    transform: scale(1.05);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODE TABS
  ═══════════════════════════════════════════════════════════════════════════ */

  .mode-tabs {
    display: flex;
    gap: 4px;
    padding: 8px 16px;
    background: var(--vscode-sideBar-background, var(--bg-dark));
    border-bottom: 1px solid var(--vscode-panel-border, var(--border));
  }

  .mode-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 10px;
    min-width: 0;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    background: transparent;
    color: var(--vscode-descriptionForeground, var(--text-muted));
  }

  .mode-tab:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.05));
  }

  .mode-tab.active {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%);
    color: var(--vscode-foreground, var(--text));
    box-shadow: 0 0 0 1px rgba(139, 92, 246, 0.3);
  }

  .mode-tab .icon {
    font-size: 16px;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MESSAGES
  ═══════════════════════════════════════════════════════════════════════════ */

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .messages::-webkit-scrollbar {
    width: 6px;
  }

  .messages::-webkit-scrollbar-track {
    background: transparent;
  }

  .messages::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background, rgba(255,255,255,0.2));
    border-radius: 3px;
  }

  .welcome {
    text-align: center;
    padding: 40px 20px;
    color: var(--vscode-descriptionForeground, var(--text-muted));
  }

  .welcome-icon {
    display: flex;
    justify-content: center;
    margin-bottom: 4px;
  }

  .welcome h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--vscode-foreground, var(--text));
    margin-bottom: 8px;
  }

  .welcome p {
    font-size: 13px;
    line-height: 1.5;
    max-width: 280px;
    margin: 0 auto;
  }

  .welcome-tip {
    margin-top: 12px !important;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--vscode-textBlockQuote-background, rgba(127, 127, 127, 0.12));
    border-left: 3px solid var(--vscode-textLink-foreground, #3794ff);
    text-align: left;
    max-width: 320px !important;
    font-size: 12px !important;
  }

  .welcome-tip code {
    font-size: 11px;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.2));
  }

  .message {
    display: flex;
    gap: 12px;
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .message.user {
    flex-direction: row-reverse;
  }

  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
  }

  .message.user .avatar {
    background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%);
  }

  .message.ai .avatar {
    background: linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%);
  }

  .message-content {
    flex: 1;
    max-width: 85%;
  }

  .message-bubble {
    padding: 12px 16px;
    border-radius: 16px;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message.user .message-bubble {
    background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%);
    color: white;
    border-bottom-right-radius: 4px;
  }

  .message.ai .message-bubble {
    background: var(--vscode-editor-background, var(--bg-card));
    border: 1px solid var(--vscode-panel-border, var(--border));
    border-bottom-left-radius: 4px;
  }

  .message-time {
    font-size: 10px;
    color: var(--vscode-descriptionForeground, var(--text-muted));
    margin-top: 4px;
    padding: 0 4px;
  }

  .message.user .message-time {
    text-align: right;
  }

  .message.progress .message-bubble {
    background: rgba(139, 92, 246, 0.1);
    border: 1px dashed rgba(139, 92, 246, 0.3);
    color: var(--vscode-descriptionForeground, var(--text-muted));
    font-style: italic;
  }

  .typing-indicator {
    display: flex;
    gap: 4px;
    padding: 8px 0;
  }

  .typing-indicator span {
    width: 8px;
    height: 8px;
    background: var(--primary);
    border-radius: 50%;
    animation: typing 1.4s infinite ease-in-out;
  }

  .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
  .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes typing {
    0%, 100% { transform: translateY(0); opacity: 0.4; }
    50% { transform: translateY(-4px); opacity: 1; }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     INPUT AREA
  ═══════════════════════════════════════════════════════════════════════════ */

  .input-area {
    padding: 16px;
    background: var(--vscode-sideBar-background, var(--bg-dark));
    border-top: 1px solid var(--vscode-panel-border, var(--border));
  }

  .input-container {
    display: flex;
    gap: 8px;
    background: var(--vscode-input-background, var(--bg-card));
    border: 1px solid var(--vscode-input-border, var(--border));
    border-radius: 12px;
    padding: 8px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .input-container:focus-within {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
  }

  .input-container textarea {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--vscode-foreground, var(--text));
    font-family: inherit;
    font-size: 13px;
    line-height: 1.5;
    resize: none;
    outline: none;
    min-height: 24px;
    max-height: 120px;
  }

  .input-container textarea::placeholder {
    color: var(--vscode-input-placeholderForeground, var(--text-muted));
  }

  .send-btn {
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 8px;
    background: linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    transition: transform 0.2s, box-shadow 0.2s;
    flex-shrink: 0;
  }

  .send-btn:hover {
    transform: scale(1.05);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
  }

  .send-btn:active {
    transform: scale(0.95);
  }

  .input-hint {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, var(--text-muted));
  }

  @media (max-width: 340px) {
    .header-top { flex-wrap: wrap; }
    .status-badge { font-size: 10px; padding: 3px 8px; }
    .shortcuts { flex-wrap: wrap; gap: 6px; }
    .suggestions { grid-template-columns: 1fr; }
  }

  .shortcuts {
    display: flex;
    gap: 12px;
  }

  .shortcut {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .shortcut kbd {
    background: var(--vscode-badge-background, rgba(255,255,255,0.1));
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-family: inherit;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     CODE BLOCKS
  ═══════════════════════════════════════════════════════════════════════════ */

  .message-bubble pre {
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.3));
    border-radius: 8px;
    padding: 12px;
    margin: 8px 0;
    overflow-x: auto;
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
  }

  .message-bubble code {
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.3));
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
  }

  .message-bubble pre code {
    background: none;
    padding: 0;
  }

  .message-bubble a {
    color: #A78BFA;
    text-decoration: underline;
  }

  .message-bubble strong { font-weight: 600; }
  .message-bubble em { font-style: italic; opacity: 0.9; }
  .message-bubble h3, .message-bubble h4 {
    margin: 8px 0 4px;
    font-size: 13px;
  }
  .message-bubble ul, .message-bubble ol {
    margin: 6px 0 6px 18px;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SUGGESTIONS
  ═══════════════════════════════════════════════════════════════════════════ */

  .suggestions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 20px;
  }

  .suggestion {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: var(--vscode-input-background, var(--bg-card));
    border: 1px solid var(--vscode-input-border, var(--border));
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
  }

  .suggestion:hover {
    border-color: var(--primary);
    transform: translateY(-2px);
  }

  .suggestion-icon {
    font-size: 16px;
  }

  .btn-recommend {
    margin-top: 16px;
    padding: 10px 20px;
    background: linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-recommend:hover {
    transform: scale(1.02);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODAL
  ═══════════════════════════════════════════════════════════════════════════ */

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-overlay.show {
    display: flex;
  }

  .modal {
    background: var(--vscode-editor-background, var(--bg-card));
    border: 1px solid var(--vscode-panel-border, var(--border));
    border-radius: 12px;
    width: 90%;
    max-width: 400px;
    max-height: 80vh;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--vscode-panel-border, var(--border));
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%);
  }

  .modal-header h3 {
    font-size: 14px;
    margin: 0;
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .modal-body {
    padding: 16px;
    overflow-y: auto;
    max-height: 60vh;
    font-size: 12px;
  }

  .model-card {
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 8px;
  }

  .model-card.recommended {
    border-color: var(--primary);
    background: rgba(139, 92, 246, 0.1);
  }

  .model-card h4 {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .model-card .badge {
    background: var(--primary);
    color: white;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
  }

  .model-card .specs {
    display: flex;
    gap: 12px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }

  .model-card code {
    display: block;
    margin-top: 8px;
    padding: 8px;
    background: rgba(0,0,0,0.2);
    border-radius: 4px;
    font-size: 11px;
  }

  .category-title {
    margin: 16px 0 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    font-size: 13px;
  }

  /* API Cards */
  .api-card {
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 10px;
  }

  .api-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .badge-free {
    background: #10B981;
    color: white;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
  }

  .badge-paid {
    background: #F59E0B;
    color: white;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
  }

  .api-desc {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    margin: 4px 0;
  }

  .api-input {
    width: 100%;
    padding: 8px;
    margin-top: 8px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    color: var(--vscode-foreground);
    font-size: 12px;
  }

  .api-link {
    display: inline-block;
    margin-top: 6px;
    color: #8B5CF6;
    font-size: 11px;
    text-decoration: none;
  }

  .api-link:hover {
    text-decoration: underline;
  }

  .settings-tabs {
    display: flex;
    gap: 6px;
    padding: 10px 16px 0;
    border-bottom: 1px solid var(--vscode-panel-border, var(--border));
  }

  .settings-tab {
    padding: 8px 14px;
    border: none;
    border-radius: 8px 8px 0 0;
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 12px;
    cursor: pointer;
    opacity: 0.7;
  }

  .settings-tab.active {
    opacity: 1;
    background: rgba(139, 92, 246, 0.2);
    color: #8B5CF6;
    font-weight: 600;
  }

  .settings-panel {
    display: none;
  }

  .settings-panel.active {
    display: block;
  }

  .prompt-field {
    margin-bottom: 14px;
  }

  .prompt-field label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    margin-bottom: 6px;
    font-size: 12px;
  }

  .prompt-restore {
    background: none;
    border: none;
    color: #8B5CF6;
    font-size: 10px;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }

  .prompt-textarea {
    width: 100%;
    min-height: 110px;
    max-height: 200px;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid var(--vscode-input-border, var(--border));
    background: var(--vscode-input-background, var(--bg-card));
    color: var(--vscode-foreground);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    line-height: 1.45;
    resize: vertical;
    box-sizing: border-box;
  }

  .agent-ide-option {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 8px 0;
    font-size: 12px;
    line-height: 1.45;
    cursor: pointer;
  }

  .agent-ide-option input {
    margin-top: 2px;
  }

  .prompt-hint {
    font-size: 10px;
    opacity: 0.65;
    margin-top: 4px;
    line-height: 1.4;
  }

  .modal.settings-modal {
    max-width: 580px;
    max-height: 88vh;
  }

  .settings-intro {
    font-size: 11px;
    line-height: 1.5;
    opacity: 0.8;
    margin-bottom: 14px;
    padding: 10px 12px;
    background: rgba(139, 92, 246, 0.08);
    border-radius: 8px;
    border: 1px solid rgba(139, 92, 246, 0.15);
  }

  .badge-configured {
    background: rgba(16, 185, 129, 0.2);
    color: #10B981;
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
  }

  .api-model-row {
    margin-top: 6px;
  }

  .api-model-row label {
    font-size: 10px;
    opacity: 0.7;
    display: block;
    margin-bottom: 3px;
  }

  .api-model-input {
    width: 100%;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--vscode-input-border, var(--border));
    background: var(--vscode-input-background, var(--bg-card));
    color: var(--vscode-foreground);
    font-size: 11px;
    box-sizing: border-box;
  }

  .api-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .btn-use-api {
    padding: 5px 10px;
    border: 1px solid rgba(139, 92, 246, 0.4);
    background: rgba(139, 92, 246, 0.15);
    color: #8B5CF6;
    border-radius: 6px;
    font-size: 10px;
    cursor: pointer;
  }

  .btn-use-api:hover {
    background: rgba(139, 92, 246, 0.25);
  }

  .hw-card {
    margin-bottom: 12px;
    padding: 12px;
    background: rgba(139, 92, 246, 0.1);
    border-radius: 8px;
    font-size: 12px;
  }

  .hw-card strong {
    display: block;
    margin-bottom: 4px;
  }

  .hw-installed {
    margin-bottom: 12px;
    padding: 12px;
    background: rgba(16, 185, 129, 0.1);
    border-radius: 8px;
    font-size: 11px;
  }

  .hw-refresh-row {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 12px;
  }

  #settings-hardware-body {
    max-height: 50vh;
    overflow-y: auto;
  }

  .test-row {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }

  .btn-test {
    padding: 8px 14px;
    border: 1px solid rgba(16, 185, 129, 0.4);
    border-radius: 8px;
    background: rgba(16, 185, 129, 0.12);
    color: var(--vscode-foreground);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-test:hover {
    background: rgba(16, 185, 129, 0.22);
  }

  .test-result {
    font-size: 11px;
    line-height: 1.4;
    flex: 1;
    min-width: 120px;
  }

  .message-bubble pre {
    cursor: pointer;
    position: relative;
  }

  .message-bubble pre:hover {
    outline: 1px solid rgba(139, 92, 246, 0.5);
  }

  .btn-save {
    width: 100%;
    padding: 12px;
    margin-top: 16px;
    background: linear-gradient(135deg, #8B5CF6, #3B82F6);
    border: none;
    border-radius: 8px;
    color: white;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-save:hover {
    transform: scale(1.02);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     FOOTER CREADOR
  ═══════════════════════════════════════════════════════════════════════════ */

  .license-badge {
    font-size: 10px;
    opacity: 0.65;
    cursor: help;
  }

  .creator-footer {
    padding: 12px 16px;
    border-top: 1px solid var(--vscode-panel-border, var(--border));
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(59, 130, 246, 0.05) 100%);
    text-align: center;
  }

  .creator-info {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, var(--text-muted));
  }

  .creator-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
  }

  .creator-name {
    font-weight: 600;
    color: var(--vscode-foreground, var(--text));
  }

  .creator-link {
    color: #8B5CF6;
    text-decoration: none;
    transition: color 0.2s;
  }

  .creator-link:hover {
    color: #A78BFA;
    text-decoration: underline;
  }

  .version-badge {
    display: inline-block;
    padding: 2px 8px;
    background: rgba(139, 92, 246, 0.2);
    border-radius: 10px;
    font-size: 10px;
    color: #A78BFA;
    margin-left: 8px;
  }

  .auto-hint {
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--vscode-descriptionForeground, var(--text-muted));
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
  }

  .no-models-banner {
    margin-top: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 11px;
    line-height: 1.5;
    color: #FCD34D;
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.35);
    display: none;
  }

  .no-models-banner button {
    margin-top: 8px;
    padding: 6px 12px;
    background: linear-gradient(135deg, #8B5CF6, #3B82F6);
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 11px;
    cursor: pointer;
  }

  .task-models-hint {
    margin-top: 6px;
    font-size: 10px;
    opacity: 0.85;
  }

  .use-case-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
    margin: 12px 0;
  }

  .use-case-chip {
    padding: 10px 8px;
    border: 1px solid var(--vscode-input-border);
    border-radius: 8px;
    cursor: pointer;
    text-align: center;
    font-size: 10px;
    background: var(--vscode-input-background);
    transition: border-color 0.15s, background 0.15s;
  }

  .use-case-chip:hover {
    border-color: var(--primary);
  }

  .use-case-chip.active {
    border-color: var(--primary);
    background: rgba(139, 92, 246, 0.15);
  }

  .use-case-chip .uc-icon {
    font-size: 18px;
    display: block;
    margin-bottom: 4px;
  }

  .current-models-box {
    padding: 12px;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.25);
    border-radius: 8px;
    margin-bottom: 12px;
    font-size: 11px;
    line-height: 1.6;
  }

  .model-desc {
    margin: 8px 0 4px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    line-height: 1.45;
  }

  .model-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .btn-apply-task {
    padding: 5px 10px;
    font-size: 10px;
    border: 1px solid var(--primary);
    background: transparent;
    color: var(--vscode-foreground);
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-apply-task:hover {
    background: rgba(139, 92, 246, 0.15);
  }

  .btn-apply-task.primary {
    background: linear-gradient(135deg, #8B5CF6, #3B82F6);
    color: white;
    border: none;
  }

  .use-case-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .use-case-tag {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(139, 92, 246, 0.2);
  }

  .use-case-detail {
    padding: 10px 12px;
    margin-bottom: 12px;
    background: rgba(59, 130, 246, 0.08);
    border-radius: 8px;
    font-size: 11px;
    line-height: 1.5;
  }
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="header-top">
    <div class="logo"><img src="${iconUri}" alt="Local Copilot" class="brand-icon" /></div>
    <div class="title-section">
      <div class="title">Local Copilot</div>
      <div class="subtitle">Experto en todos los lenguajes · IA local</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <button type="button" class="btn-icon" id="btn-recommendations" title="IAs recomendadas para tu PC">😈</button>
      <button type="button" class="btn-icon" id="btn-refresh" title="Recargar modelos y conexión">🔄</button>
      <button type="button" class="btn-icon" id="btn-clear" title="Limpiar conversación">🗑️</button>
      <button type="button" class="btn-icon" id="btn-settings" title="Ajustes: APIs, hardware y prompts">⚙️</button>
      <div class="status-badge online" id="status-badge">
        <span class="status-dot"></span>
        <span id="status-text">Conectando...</span>
      </div>
    </div>
  </div>
  <div class="controls">
    <div class="control-group" id="internet-control">
      <label>Red:</label>
      <select id="internet-mode" title="Búsqueda web con Ollama local">
        <option value="false">🏠 Solo local</option>
        <option value="true">🔍 +Internet</option>
      </select>
    </div>
    <div class="control-group" style="flex:1">
      <label>IA:</label>
      <select id="provider-select">
        <optgroup label="🏠 IA Local">
          <option value="auto">🔄 Auto (detecta Ollama)</option>
          <option value="ollama">🏠 Ollama</option>
        </optgroup>
        <optgroup label="🆓 APIs Gratuitas (web)">
          <option value="groq">⚡ Groq</option>
          <option value="cerebras">🧠 Cerebras</option>
          <option value="together">🤝 Together AI</option>
          <option value="cohere">🔷 Cohere</option>
          <option value="huggingface">🤗 HuggingFace</option>
        </optgroup>
        <optgroup label="💎 APIs de Pago (web)">
          <option value="gemini">💎 Google Gemini</option>
          <option value="openrouter">🔀 OpenRouter</option>
        </optgroup>
      </select>
    </div>
  </div>
  <div class="auto-hint" id="auto-hint" style="display:none;"></div>
  <div class="no-models-banner" id="no-models-banner">
    <strong>⚠️ Sin modelos IA detectados</strong><br>
    Instala Ollama y descarga un modelo. La extensión elegirá automáticamente el mejor para chat, autocompletado y agente.
    <small>Ejecuta en terminal: <code>ollama pull qwen2.5-coder:7b</code></small>
    <br><button type="button">🔄 Recargar modelos</button>
  </div>
  <div class="controls" id="ollama-models-row">
    <div class="control-group" style="flex:1">
      <label>Modelo Ollama:</label>
      <select id="ollama-model-select">
        <option value="">Cargando modelos...</option>
      </select>
    </div>
  </div>
</div>

<!-- MODE TABS -->
<div class="mode-tabs" id="mode-tabs">
  <button type="button" class="mode-tab active" id="mode-chat" data-mode="chat">
    <span class="icon">💬</span>
    <span>Chat</span>
  </button>
  <button type="button" class="mode-tab" id="mode-teacher" data-mode="teacher">
    <span class="icon">🎓</span>
    <span>Profesor</span>
  </button>
  <button type="button" class="mode-tab" id="mode-agent" data-mode="agent">
    <span class="icon"><img src="${iconUri}" alt="" class="tab-icon-img" /></span>
    <span>Agente</span>
  </button>
</div>

<!-- MESSAGES -->
<div class="messages" id="messages">
  <div class="welcome" id="welcome">
    <div class="welcome-icon"><img src="${iconUri}" alt="" class="welcome-icon-img" /></div>
    <h2>¡Hola! Soy Local Copilot</h2>
    <p>Experto senior en <strong>todos los lenguajes</strong>. Explico, genero, arreglo y programo en modo Agente.</p>
    <p class="welcome-tip">📁 <strong>Tip:</strong> Siempre organizo por carpetas — <code>radio/</code>, <code>musica/</code>, <code>juegos/</code>, <code>commands/</code>… Un módulo por función, nunca todo en <code>index.js</code>.</p>
    
    <div class="suggestions">
      <div class="suggestion" data-action="explain" title="Explica el código del editor abierto">
        <span class="suggestion-icon">📚</span>
        <span>Explicar código</span>
      </div>
      <div class="suggestion" data-action="generate" title="Genera código según el archivo o selección">
        <span class="suggestion-icon">✨</span>
        <span>Generar código</span>
      </div>
      <div class="suggestion" data-action="fix" title="Corrige errores y escribe el fix en el archivo">
        <span class="suggestion-icon">🔧</span>
        <span>Arreglar errores</span>
      </div>
      <div class="suggestion" data-action="refactor" title="Mejora la organización sin cambiar la funcionalidad">
        <span class="suggestion-icon">⚡</span>
        <span>Refactorizar</span>
      </div>
    </div>
    <button type="button" class="btn-recommend" id="btn-welcome-recommendations">😈 Ver IAs recomendadas para tu PC</button>

  </div>
</div>

<!-- MODAL RECOMENDACIONES -->
<div class="modal-overlay" id="modal-overlay">
  <div class="modal" id="modal-inner">
    <div class="modal-header">
      <h3 id="modal-title">🔄 IAs Recomendadas</h3>
      <button type="button" class="modal-close" id="modal-close-btn">×</button>
    </div>
    <div class="modal-body" id="modal-body">
      <p>Cargando...</p>
    </div>
  </div>
</div>

<!-- MODAL AJUSTES -->
<div class="modal-overlay" id="settings-modal">
  <div class="modal settings-modal" id="settings-modal-inner">
    <div class="modal-header">
      <h3>⚙️ Ajustes Local Copilot</h3>
      <button type="button" class="modal-close" id="settings-close">×</button>
    </div>
    <div class="settings-tabs">
      <button type="button" class="settings-tab active" data-tab="apis">🔑 APIs</button>
      <button type="button" class="settings-tab" data-tab="models">🤖 IAs</button>
      <button type="button" class="settings-tab" data-tab="hardware">🎯 Hardware</button>
      <button type="button" class="settings-tab" data-tab="prompts">📝 Prompts</button>
    </div>
    <div class="modal-body">
      <div class="settings-panel active" id="panel-apis">
      <p class="settings-intro">
        Configura <strong>IA local (Ollama)</strong>, <strong>APIs externas gratis</strong> o <strong>APIs de pago</strong>.
        Pega tu API key, elige el modelo y pulsa <em>Usar en chat</em>. Deja la clave vacía para mantener la actual.
      </p>

      <div class="category-title">🏠 IA Local — Ollama (gratis, sin internet)</div>
      <div class="test-row">
        <button type="button" class="btn-test" id="btn-test-ollama">🔌 Probar Ollama</button>
        <button type="button" class="btn-use-api" data-provider="auto">Usar Auto (Ollama)</button>
        <span class="test-result" id="test-result"></span>
      </div>

      <div class="category-title">🌐 Navegador (no es IA integrada)</div>
      <div class="api-card">
        <div class="api-header">
          <span>🦆 DuckDuckGo</span>
          <span class="badge-free">NAVEGADOR</span>
        </div>
        <p class="api-desc">DuckDuckGo es un <strong>navegador/buscador</strong>, no una IA dentro del chat. Las IAs van arriba (Ollama, Groq, Gemini…). Aquí solo abres el navegador si quieres buscar en la web.</p>
        <div class="api-actions">
          <a href="https://duckduckgo.com/" target="_blank" class="api-link">Abrir DuckDuckGo →</a>
        </div>
      </div>

      <div class="category-title">🆓 APIs externas gratis (con API key)</div>
      
      <div class="api-card" data-api="groq">
        <div class="api-header">
          <span>⚡ Groq</span>
          <span class="badge-free">GRATIS</span>
          <span class="badge-configured api-status" id="status-groq" style="display:none">✓ Configurada</span>
        </div>
        <p class="api-desc">Ultra rápido, 14.400 tokens/min gratis</p>
        <input type="password" id="groq-key" placeholder="API Key de Groq" class="api-input">
        <div class="api-model-row">
          <label>Modelo</label>
          <input type="text" id="groq-model" placeholder="llama-3.3-70b-versatile" class="api-model-input">
        </div>
        <div class="api-actions">
          <button type="button" class="btn-use-api" data-provider="groq">Usar en chat</button>
          <a href="https://console.groq.com/keys" target="_blank" class="api-link">Obtener API Key →</a>
        </div>
      </div>

      <div class="api-card" data-api="cerebras">
        <div class="api-header">
          <span>🧠 Cerebras</span>
          <span class="badge-free">GRATIS</span>
          <span class="badge-configured api-status" id="status-cerebras" style="display:none">✓ Configurada</span>
        </div>
        <p class="api-desc">Velocidad récord, plan gratuito con límites</p>
        <input type="password" id="cerebras-key" placeholder="API Key de Cerebras" class="api-input">
        <div class="api-model-row">
          <label>Modelo</label>
          <input type="text" id="cerebras-model" placeholder="llama-3.3-70b" class="api-model-input">
        </div>
        <div class="api-actions">
          <button type="button" class="btn-use-api" data-provider="cerebras">Usar en chat</button>
          <a href="https://cloud.cerebras.ai/" target="_blank" class="api-link">Obtener API Key →</a>
        </div>
      </div>

      <div class="api-card" data-api="together">
        <div class="api-header">
          <span>🤝 Together AI</span>
          <span class="badge-free">$5 GRATIS</span>
          <span class="badge-configured api-status" id="status-together" style="display:none">✓ Configurada</span>
        </div>
        <p class="api-desc">$5 de crédito gratis al registrarte</p>
        <input type="password" id="together-key" placeholder="API Key de Together" class="api-input">
        <div class="api-model-row">
          <label>Modelo</label>
          <input type="text" id="together-model" placeholder="meta-llama/Llama-3.3-70B-Instruct-Turbo-Free" class="api-model-input">
        </div>
        <div class="api-actions">
          <button type="button" class="btn-use-api" data-provider="together">Usar en chat</button>
          <a href="https://api.together.xyz/" target="_blank" class="api-link">Obtener API Key →</a>
        </div>
      </div>

      <div class="api-card" data-api="cohere">
        <div class="api-header">
          <span>🔷 Cohere</span>
          <span class="badge-free">GRATIS</span>
          <span class="badge-configured api-status" id="status-cohere" style="display:none">✓ Configurada</span>
        </div>
        <p class="api-desc">Command R — plan gratuito con límites</p>
        <input type="password" id="cohere-key" placeholder="API Key de Cohere" class="api-input">
        <div class="api-model-row">
          <label>Modelo</label>
          <input type="text" id="cohere-model" placeholder="command-r-plus" class="api-model-input">
        </div>
        <div class="api-actions">
          <button type="button" class="btn-use-api" data-provider="cohere">Usar en chat</button>
          <a href="https://dashboard.cohere.com/api-keys" target="_blank" class="api-link">Obtener API Key →</a>
        </div>
      </div>

      <div class="api-card" data-api="huggingface">
        <div class="api-header">
          <span>🤗 HuggingFace</span>
          <span class="badge-free">GRATIS</span>
          <span class="badge-configured api-status" id="status-huggingface" style="display:none">✓ Configurada</span>
        </div>
        <p class="api-desc">Miles de modelos open source gratuitos</p>
        <input type="password" id="huggingface-key" placeholder="Token de HuggingFace" class="api-input">
        <div class="api-model-row">
          <label>Modelo</label>
          <input type="text" id="huggingface-model" placeholder="meta-llama/Llama-3.2-11B-Vision-Instruct" class="api-model-input">
        </div>
        <div class="api-actions">
          <button type="button" class="btn-use-api" data-provider="huggingface">Usar en chat</button>
          <a href="https://huggingface.co/settings/tokens" target="_blank" class="api-link">Obtener Token →</a>
        </div>
      </div>

      <div class="category-title">💎 APIs de pago / premium</div>

      <div class="api-card" data-api="gemini">
        <div class="api-header">
          <span>💎 Google Gemini</span>
          <span class="badge-paid">PAGO</span>
          <span class="badge-configured api-status" id="status-gemini" style="display:none">✓ Configurada</span>
        </div>
        <p class="api-desc">Gemini Pro, Flash — tier gratuito limitado + pago por uso</p>
        <input type="password" id="gemini-key" placeholder="API Key de Gemini" class="api-input">
        <div class="api-model-row">
          <label>Modelo</label>
          <input type="text" id="gemini-model" placeholder="gemini-2.0-flash-exp" class="api-model-input">
        </div>
        <div class="api-actions">
          <button type="button" class="btn-use-api" data-provider="gemini">Usar en chat</button>
          <a href="https://aistudio.google.com/apikey" target="_blank" class="api-link">Obtener API Key →</a>
        </div>
      </div>

      <div class="api-card" data-api="openrouter">
        <div class="api-header">
          <span>🔀 OpenRouter</span>
          <span class="badge-paid">PAGO</span>
          <span class="badge-configured api-status" id="status-openrouter" style="display:none">✓ Configurada</span>
        </div>
        <p class="api-desc">Acceso a GPT-4, Claude, Llama y más modelos externos</p>
        <input type="password" id="openrouter-key" placeholder="API Key de OpenRouter" class="api-input">
        <div class="api-model-row">
          <label>Modelo</label>
          <input type="text" id="openrouter-model" placeholder="openai/gpt-4o-mini" class="api-model-input">
        </div>
        <div class="api-actions">
          <button type="button" class="btn-use-api" data-provider="openrouter">Usar en chat</button>
          <a href="https://openrouter.ai/keys" target="_blank" class="api-link">Obtener API Key →</a>
        </div>
      </div>

      </div>

      <div class="settings-panel" id="panel-models">
        <p class="settings-intro">
          Elige la <strong>IA recomendada</strong> según lo que quieras hacer.
          Cada modelo incluye una descripción en español y puedes asignarlo a Chat, Agente o Autocompletado.
        </p>
        <div class="current-models-box" id="current-models-box">
          <strong>Asignación actual:</strong><br>
          💬 Chat: <code id="cfg-chat">—</code> · ⌨️ Autocompletado: <code id="cfg-completion">—</code> · 🤖 Agente: <code id="cfg-agent">—</code>
        </div>
        <div class="category-title">¿Para qué lo vas a usar?</div>
        <div class="use-case-grid" id="use-case-grid"></div>
        <div class="use-case-detail" id="use-case-detail"></div>
        <div id="settings-models-body">
          <p>Selecciona un uso arriba para ver modelos recomendados.</p>
        </div>
      </div>

      <div class="settings-panel" id="panel-hardware">
        <p class="settings-intro">
          Sugerencias de <strong>IA local (Ollama)</strong> según tu RAM, CPU y GPU.
          La extensión asigna automáticamente el mejor modelo para Chat, Autocompletado y Agente.
        </p>
        <div class="hw-refresh-row">
          <button type="button" class="btn-test" id="btn-refresh-hardware">🔄 Analizar mi hardware</button>
        </div>
        <div id="settings-hardware-body">
          <p>Analizando tu hardware y SO…</p>
        </div>
      </div>
      <div class="settings-panel" id="panel-prompts">
        <div class="category-title">🧠 Agente IDE (gestionar VS Code)</div>
        <p class="settings-intro" style="margin-bottom:10px;">
          Activa estas opciones para que el <strong>modo Agente</strong> pueda instalar extensiones,
          ejecutar comandos de VS Code y (opcional) modificar y recompilar Local Copilot.
          Licencia MIT — DavidPilahito7 © 2026.
        </p>
        <label class="agent-ide-option">
          <input type="checkbox" id="agent-ide-mode" />
          Gestionar VS Code: instalar/listar extensiones y comandos del IDE
        </label>
        <label class="agent-ide-option">
          <input type="checkbox" id="agent-self-modify" />
          Auto-modificar Local Copilot (recompilar e instalar tras cambios en src/)
        </label>
        <p class="prompt-hint" style="margin:12px 0;">
          Ejemplos en modo Agente: «instala Python», «lista extensiones», «añade botón X a la extensión».
        </p>
        <div class="category-title">📝 Prompts personalizados</div>
        <p class="prompt-hint" style="margin-bottom:12px;">
          Personaliza cómo responde cada modo. Si dejas el texto igual al predeterminado, se usa el built-in de la extensión.
        </p>
        <div class="prompt-field">
          <label>💬 Chat <button type="button" class="prompt-restore" data-restore="chat">Restaurar</button></label>
          <textarea class="prompt-textarea" id="prompt-chat" spellcheck="false"></textarea>
          <p class="prompt-hint">Prompt del sistema en modo Chat (no modifica archivos).</p>
        </div>
        <div class="prompt-field">
          <label>🎓 Profesor <button type="button" class="prompt-restore" data-restore="teacher">Restaurar</button></label>
          <textarea class="prompt-textarea" id="prompt-teacher" spellcheck="false"></textarea>
          <p class="prompt-hint">Enseñanza paso a paso, ejemplos y arquitectura de proyectos.</p>
        </div>
        <div class="prompt-field">
          <label>🔧 Profesor (corregir) <button type="button" class="prompt-restore" data-restore="teacherFix">Restaurar</button></label>
          <textarea class="prompt-textarea" id="prompt-teacher-fix" spellcheck="false"></textarea>
          <p class="prompt-hint">Cuando el Profesor diagnostica y escribe el fix en el editor.</p>
        </div>
        <div class="prompt-field">
          <label>🤖 Agente <button type="button" class="prompt-restore" data-restore="agent">Restaurar</button></label>
          <textarea class="prompt-textarea" id="prompt-agent" spellcheck="false" placeholder="Instrucciones extra para el agente (opcional)…"></textarea>
          <p class="prompt-hint">Se añaden al prompt del Agente. Vacío = solo comportamiento por defecto.</p>
        </div>
      </div>
      <button type="button" class="btn-save" id="btn-save-settings">💾 Guardar ajustes</button>
    </div>
  </div>
</div>

<!-- INPUT AREA -->
<div class="input-area">
  <div class="input-container">
    <textarea id="prompt" placeholder="Pregunta algo sobre tu código..." rows="1"></textarea>
    <button class="send-btn" id="send-btn" type="button">➤</button>
  </div>
  <div class="input-hint">
    <span id="hint">💬 Chat: responde preguntas sin modificar archivos</span>
    <div class="shortcuts">
      <span class="shortcut"><kbd>Enter</kbd> Enviar</span>
      <span class="shortcut"><kbd>Shift+Enter</kbd> Nueva línea</span>
    </div>
  </div>
</div>

<!-- FOOTER CREADOR -->
<div class="creator-footer">
  <div class="creator-info">
    <div class="creator-avatar"><img src="${iconUri}" alt="" class="avatar-img" /></div>
    <span>Creado por</span>
    <span class="creator-name">DavidPilahito7</span>
    <span>•</span>
    <a href="https://github.com/pilahito" class="creator-link" target="_blank">GitHub</a>
    <span>•</span>
    <a href="#" class="creator-link" id="link-donate" title="Apoyar el proyecto">Donación</a>
    <span class="version-badge">v${version}</span>
    <span>•</span>
    <span class="license-badge" title="Licencia MIT — DavidPilahito7 © 2026">MIT</span>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  const APP_ICON = ${JSON.stringify(iconUri)};
  const DONATE_URL = ${JSON.stringify(donateUrl.startsWith('http') ? donateUrl : `https://${donateUrl}`)};
  const MODEL_CATALOG_DATA = ${JSON.stringify({ useCases: USE_CASES, catalog: MODEL_CATALOG })};
  const messagesEl = document.getElementById('messages');
  const welcomeEl = document.getElementById('welcome');
  const promptEl = document.getElementById('prompt');
  const providerEl = document.getElementById('provider-select');
  const internetEl = document.getElementById('internet-mode');
  const autoHintEl = document.getElementById('auto-hint');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const WEB_PROVIDERS = ['groq', 'cerebras', 'together', 'cohere', 'huggingface', 'gemini', 'openrouter'];

  if (!messagesEl || !promptEl) {
    console.error('Local Copilot: no se encontraron elementos del chat (messages/prompt).');
  }
  let mode = 'chat';
  let currentAiEl = null;
  let streamRaw = '';

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMarkdown(text) {
    if (!text) return '';
    const fence = String.fromCharCode(96, 96, 96);
    const blocks = [];
    const codeRe = new RegExp(fence + '(\\\\w*)\\\\n?([\\\\s\\\\S]*?)' + fence, 'g');
    let src = text.replace(codeRe, (_, lang, code) => {
      const id = blocks.length;
      blocks.push(
        '<pre><code class="lang-' + (lang || 'text') + '">' +
        escapeHtml(code.trim()) + '</code></pre>'
      );
      return '@@CODE' + id + '@@';
    });

    let html = escapeHtml(src);
    blocks.forEach((block, i) => {
      html = html.split('@@CODE' + i + '@@').join(block);
    });

    html = html.replace(new RegExp('\\\\*\\\\*([^*]+)\\\\*\\\\*', 'g'), '<strong>$1</strong>');
    html = html.replace(new RegExp('_([^_' + String.fromCharCode(10) + ']+)_', 'g'), '<em>$1</em>');
    const tick = String.fromCharCode(96);
    html = html.replace(new RegExp(tick + '([^' + tick + '\\\\n]+)' + tick, 'g'), '<code>$1</code>');
    html = html.replace(new RegExp('^### (.+)$', 'gm'), '<h4>$1</h4>');
    html = html.replace(new RegExp('^## (.+)$', 'gm'), '<h3>$1</h3>');
    html = html.replace(
      new RegExp('\\\\[([^\\\\]]+)\\\\]\\\\((https?:\\\\/\\\\/[^)]+)\\\\)', 'g'),
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
    return html;
  }

  function setBubbleMarkdown(bubble, text) {
    bubble.innerHTML = renderMarkdown(text);
  }

  function isWebProvider(p) {
    return WEB_PROVIDERS.includes(p);
  }

  function normalizeModelName(name) {
    return String(name || '').replace(/:latest$/i, '').trim();
  }

  function modelsMatch(a, b) {
    if (!a || !b) return false;
    const na = normalizeModelName(a);
    const nb = normalizeModelName(b);
    return na === nb || a === b || a.startsWith(nb + ':') || b.startsWith(na + ':');
  }

  function populateModelSelect(models, currentModel, loading) {
    const select = document.getElementById('ollama-model-select');
    if (!select) return;
    select.innerHTML = '';
    if (models.length > 0) {
      let foundCurrent = false;
      models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        if (currentModel && modelsMatch(m, currentModel)) {
          opt.selected = true;
          foundCurrent = true;
        }
        select.appendChild(opt);
      });
      if (!foundCurrent && currentModel) {
        const opt = document.createElement('option');
        opt.value = currentModel;
        opt.textContent = currentModel + ' (configurado)';
        opt.selected = true;
        select.insertBefore(opt, select.firstChild);
      }
    } else if (currentModel) {
      const opt = document.createElement('option');
      opt.value = currentModel;
      opt.textContent = loading ? currentModel + ' (cargando lista…)' : currentModel;
      opt.selected = true;
      select.appendChild(opt);
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = loading ? 'Cargando modelos…' : 'No hay modelos detectados';
      select.appendChild(opt);
    }
  }

  function setMode(m) {
    mode = m;
    const tabChat = document.getElementById('mode-chat');
    const tabAgent = document.getElementById('mode-agent');
    const tabTeacher = document.getElementById('mode-teacher');
    if (tabChat) tabChat.classList.toggle('active', m === 'chat');
    if (tabAgent) tabAgent.classList.toggle('active', m === 'agent');
    if (tabTeacher) tabTeacher.classList.toggle('active', m === 'teacher');

    const hintEl = document.getElementById('hint');
    if (hintEl) {
      hintEl.textContent = m === 'agent'
        ? '🤖 Agente: programa, gestiona VS Code (⚙️ Agente IDE) e instala extensiones'
        : m === 'teacher'
          ? '🎓 Profesor: enseña y corrige errores del editor (di "esto falla, corrígelo")'
          : '💬 Chat: responde preguntas sin modificar archivos';
    }

    const prompt = document.getElementById('prompt');
    if (prompt) {
      prompt.placeholder = m === 'agent'
        ? 'Ej: instala extensión Python, crea bot Discord, modifica Local Copilot…'
        : m === 'teacher'
          ? 'Ej: explícame cómo funciona async/await con ejemplos'
          : 'Pregunta algo sobre tu código...';
    }

    updateModelRow(document.getElementById('provider-select')?.value || 'auto', false);
  }

  function syncInternetControlVisibility(provider) {
    const internetControl = document.getElementById('internet-control');
    if (!internetControl) return;
    internetControl.style.display = isWebProvider(provider) ? 'none' : 'flex';
  }

  function getTime() {
    return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  function addMessage(role, text) {
    // Ocultar welcome
    if (welcomeEl) welcomeEl.style.display = 'none';
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + role;
    
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    if (role === 'user') {
      avatar.textContent = '👤';
    } else {
      avatar.innerHTML = '<img src="' + APP_ICON + '" alt="" class="avatar-img" />';
    }
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    if (role === 'user') {
      bubble.textContent = text;
    } else {
      setBubbleMarkdown(bubble, text);
    }
    
    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = getTime();
    
    content.appendChild(bubble);
    content.appendChild(time);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    
    messagesEl.appendChild(messageDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    
    return bubble;
  }

  function addTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'message ai';
    div.id = 'typing';
    div.innerHTML = \`
      <div class="avatar"><img src="\${APP_ICON}" alt="" class="avatar-img" /></div>
      <div class="message-content">
        <div class="message-bubble">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    \`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeTypingIndicator() {
    const typing = document.getElementById('typing');
    if (typing) typing.remove();
  }

  function wantsEditorContext(text) {
    if (mode !== 'chat') return false;
    return /explica|explain|qu[eé] hace|genera|generar|arregla|fix|refactoriza|este c[oó]digo|this code/i.test(text);
  }

  function runQuickAction(action) {
    if (isSending) return;
    const labels = {
      explain: '📚 Explicar código del editor',
      generate: '✨ Generar código relacionado',
      fix: '🔧 Arreglar errores del código',
      refactor: '⚡ Refactorizar (mejor organización)',
    };
    startSending();
    addMessage('user', labels[action] || action);
    addTypingIndicator();
    vscode.postMessage({ type: 'quickAction', action });
  }

  let lastInstalledModels = [];
  let cachedHardware = null;
  let cachedTaskModels = null;
  let cachedConfiguredModels = { chat: '', completion: '', agent: '' };
  let selectedUseCase = 'programar';

  const TIER_LABELS = {
    basic: '🟢 PC Básico',
    normal: '🟡 PC Normal',
    good: '🟠 PC Buena',
    powerful: '🔵 PC Potente',
  };

  function catalogEntryFor(name) {
    if (!name || !MODEL_CATALOG_DATA.catalog) return null;
    const n = String(name).replace(/:latest$/i, '').toLowerCase();
    return MODEL_CATALOG_DATA.catalog.find(function(m) {
      const b = m.name.toLowerCase();
      return b === n || n.startsWith(b + ':') || n.includes(b);
    }) || null;
  }

  function useCaseLabel(id) {
    const u = (MODEL_CATALOG_DATA.useCases || []).find(function(x) { return x.id === id; });
    return u ? (u.icon + ' ' + u.label) : id;
  }

  function updateConfiguredModelsDisplay(cfg) {
    if (!cfg) return;
    cachedConfiguredModels = cfg;
    const set = function(id, val) {
      const el = document.getElementById(id);
      if (el) el.textContent = val || '—';
    };
    set('cfg-chat', cfg.chat);
    set('cfg-completion', cfg.completion);
    set('cfg-agent', cfg.agent);
  }

  function renderUseCaseGrid() {
    const grid = document.getElementById('use-case-grid');
    if (!grid) return;
    const cases = MODEL_CATALOG_DATA.useCases || [];
    grid.innerHTML = cases.map(function(uc) {
      const active = uc.id === selectedUseCase ? ' active' : '';
      return '<button type="button" class="use-case-chip' + active + '" data-use-case="' + escapeHtml(uc.id) + '">' +
        '<span class="uc-icon">' + uc.icon + '</span>' + escapeHtml(uc.label) + '</button>';
    }).join('');
    grid.querySelectorAll('.use-case-chip').forEach(function(btn) {
      btn.addEventListener('click', function() {
        selectedUseCase = btn.getAttribute('data-use-case') || 'programar';
        renderUseCaseGrid();
        renderModelsSettings();
      });
    });
    const detail = document.getElementById('use-case-detail');
    const info = cases.find(function(u) { return u.id === selectedUseCase; });
    if (detail && info) {
      detail.innerHTML = '<strong>' + info.icon + ' ' + escapeHtml(info.label) + '</strong><br>' + escapeHtml(info.description);
    }
  }

  function renderModelsSettings() {
    const body = document.getElementById('settings-models-body');
    if (!body) return;
    const catalog = MODEL_CATALOG_DATA.catalog || [];
    const installed = lastInstalledModels || [];
    const sorted = catalog.slice().filter(function(m) {
      return m.bestFor && m.bestFor.indexOf(selectedUseCase) >= 0;
    }).sort(function(a, b) {
      const ai = installed.some(function(x) { return x.indexOf(a.name) >= 0; }) ? 0 : 1;
      const bi = installed.some(function(x) { return x.indexOf(b.name) >= 0; }) ? 0 : 1;
      return ai - bi;
    });

    if (!sorted.length) {
      body.innerHTML = '<p>No hay modelos catalogados para este uso.</p>';
      return;
    }

    let html = '<h4 class="category-title">Modelos recomendados para «' + escapeHtml(useCaseLabel(selectedUseCase)) + '»</h4>';
    sorted.forEach(function(m, idx) {
      const isInst = installed.some(function(x) {
        return x.toLowerCase().indexOf(m.name.toLowerCase()) >= 0;
      });
      const tags = (m.bestFor || []).map(function(t) {
        return '<span class="use-case-tag">' + escapeHtml(useCaseLabel(t)) + '</span>';
      }).join('');
      html += '<div class="model-card' + (idx === 0 ? ' recommended' : '') + '">';
      html += '<h4>' + escapeHtml(m.name);
      if (idx === 0) html += '<span class="badge">MEJOR OPCIÓN</span>';
      html += isInst ? ' <span class="model-installed-badge">✓ Instalado</span>' : ' <span class="model-missing-badge">○ No instalado</span>';
      html += '</h4>';
      html += '<p class="model-desc">' + escapeHtml(m.description) + '</p>';
      html += '<div class="specs"><span>📦 ' + escapeHtml(m.size) + '</span>';
      html += '<span>🧠 ' + escapeHtml(m.ram) + '</span>';
      html += '<span>' + escapeHtml(m.speed) + '</span></div>';
      html += '<div class="use-case-tags">' + tags + '</div>';
      if (!isInst) {
        html += '<code>' + escapeHtml(m.pullCmd) + '</code>';
      }
      html += '<div class="model-actions">';
      if (idx === 0) {
        html += '<button type="button" class="btn-apply-task primary" data-apply="profile" data-use-case="' + escapeHtml(selectedUseCase) + '">✓ Aplicar perfil completo</button>';
      }
      if (m.tasks && m.tasks.chat) {
        html += '<button type="button" class="btn-apply-task" data-apply="chat" data-model="' + escapeHtml(m.name) + '">💬 Chat</button>';
      }
      if (m.tasks && m.tasks.agent) {
        html += '<button type="button" class="btn-apply-task" data-apply="agent" data-model="' + escapeHtml(m.name) + '">🤖 Agente</button>';
      }
      if (m.tasks && m.tasks.completion) {
        html += '<button type="button" class="btn-apply-task" data-apply="completion" data-model="' + escapeHtml(m.name) + '">⌨️ Autocompletado</button>';
      }
      html += '</div></div>';
    });
    body.innerHTML = html;

    body.querySelectorAll('[data-apply]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const apply = btn.getAttribute('data-apply');
        const model = btn.getAttribute('data-model');
        const uc = btn.getAttribute('data-use-case') || selectedUseCase;
        if (apply === 'profile') {
          vscode.postMessage({ type: 'applyTaskModel', task: 'profile', useCase: uc });
        } else if (model) {
          vscode.postMessage({ type: 'applyTaskModel', task: apply, model: model });
        }
      });
    });
  }

  function buildRecommendationsHtml(hw, installed, taskModels) {
    if (!hw) return '<p>No se pudo analizar el hardware.</p>';

    const tier = TIER_LABELS[hw.tier] || hw.tier;
    let html = '<div class="hw-card">';
    html += '<strong>' + tier + '</strong>';
    html += '<small style="color:var(--vscode-descriptionForeground);">';
    html += hw.osLabel + ' • ' + hw.ramGb + 'GB RAM • ' + hw.cores + ' núcleos<br>';
    html += '🎮 ' + escapeHtml(hw.gpu);
    html += '</small></div>';

    if (installed && installed.length > 0) {
      html += '<div class="hw-installed">';
      html += '<strong>✅ Tus IAs instaladas (' + installed.length + '):</strong><br>';
      html += '<small>Asignación automática por tarea.</small>';
      if (taskModels) {
        html += '<div class="task-models-hint">💬 Chat: <code>' + escapeHtml(taskModels.chat || '—') + '</code> · ';
        html += '⌨️ Autocomplete: <code>' + escapeHtml(taskModels.completion || '—') + '</code> · ';
        html += '🤖 Agente: <code>' + escapeHtml(taskModels.agent || '—') + '</code></div>';
      }
      html += '<div style="margin-top:8px;">';
      installed.forEach(function(m) {
        html += '<code style="margin:2px 4px 2px 0;display:inline-block;padding:2px 6px;background:#052e16;border-radius:4px;">' + escapeHtml(m) + '</code>';
      });
      html += '</div></div>';
    } else {
      html += '<div class="hw-installed" style="background:rgba(245,158,11,0.1);">';
      html += '<strong>⚠️ Sin modelos Ollama detectados</strong><br>';
      html += '<small>Instala Ollama y descarga un modelo recomendado abajo.</small></div>';
    }

    html += '<h4 class="category-title">Modelos recomendados para tu hardware:</h4>';
    (hw.recommendations || []).forEach(function(m) {
      const isInstall = m.role === 'Instalación';
      html += '<div class="model-card' + (m.recommended ? ' recommended' : '') + '">';
      if (isInstall) {
        html += '<p style="margin:0;font-size:11px;">💡 ' + escapeHtml(m.name) + '</p>';
      } else {
        const cat = catalogEntryFor(m.name);
        html += '<h4>' + escapeHtml(m.name) + (m.recommended ? '<span class="badge">RECOMENDADO</span>' : '') + '</h4>';
        if (cat && cat.description) {
          html += '<p class="model-desc">' + escapeHtml(cat.description) + '</p>';
        } else {
          html += '<small style="color:var(--vscode-descriptionForeground);">' + escapeHtml(m.role) + '</small>';
        }
        html += '<div class="specs"><span>📦 ' + escapeHtml(m.size) + '</span>';
        html += '<span>🧠 ' + escapeHtml(m.ram) + '</span>';
        html += '<span>' + escapeHtml(m.speed) + '</span></div>';
        if (cat && cat.bestFor) {
          html += '<div class="use-case-tags">';
          cat.bestFor.forEach(function(t) {
            html += '<span class="use-case-tag">' + escapeHtml(useCaseLabel(t)) + '</span>';
          });
          html += '</div>';
        }
        html += '<code>ollama pull ' + escapeHtml(m.name) + '</code>';
      }
      html += '</div>';
    });

    html += '<div style="margin-top:16px;padding:12px;background:rgba(59,130,246,0.1);border-radius:8px;">';
    html += '<strong>💡 Consejos:</strong><br>';
    html += '<small>• GPU NVIDIA acelera mucho en ' + escapeHtml(hw.osLabel) + '<br>';
    html += '• Más RAM = modelos más grandes y mejor Agente<br>';
    html += '• Pestaña 🔑 APIs: añade Groq, Gemini, etc. si tu PC es limitado</small>';
    html += '</div>';

    return html;
  }

  function renderRecommendations(hw, installed, taskModels) {
    const body = document.getElementById('modal-body');
    if (!body || !hw) return;
    body.innerHTML = buildRecommendationsHtml(hw, installed, taskModels);
  }

  function renderSettingsHardware(hw, installed, taskModels) {
    const body = document.getElementById('settings-hardware-body');
    if (!body) return;
    body.innerHTML = buildRecommendationsHtml(hw, installed, taskModels);
  }

  function showRecommendations() {
    document.getElementById('modal-overlay').classList.add('show');
    const body = document.getElementById('modal-body');
    if (cachedHardware) {
      renderRecommendations(cachedHardware, lastInstalledModels, cachedTaskModels);
    } else {
      body.innerHTML = '<p>Analizando tu hardware y SO…</p>';
    }
    vscode.postMessage({ type: 'getRecommendations' });
    if (lastInstalledModels.length === 0) requestModelsThrottled();
  }

  function updateNoModelsBanner(noModels) {
    const banner = document.getElementById('no-models-banner');
    if (banner) {
      banner.style.display = noModels ? 'block' : 'none';
    }
  }

  function updateTaskModelsHint(taskModels) {
    if (!autoHintEl || !taskModels) return;
    const hasModels = lastInstalledModels.length > 0;
    if (!hasModels) return;
    const extra = ' · Auto: 💬' + (taskModels.chat || '?') +
      ' ⌨️' + (taskModels.completion || '?') +
      ' 🤖' + (taskModels.agent || '?');
    if (autoHintEl.textContent && !autoHintEl.textContent.includes('Auto:')) {
      autoHintEl.textContent += extra;
    }
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('show');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ABRIR EN NAVEGADOR
  // ══════════════════════════════════════════════════════════════════════════
  function openInBrowser() {
    vscode.postMessage({ type: 'openInBrowser' });
  }

  function openDonate() {
    vscode.postMessage({ type: 'openDonate', url: DONATE_URL });
  }
  // ══════════════════════════════════════════════════════════════════════════
  // MODAL AJUSTES (APIs + Prompts)
  // ══════════════════════════════════════════════════════════════════════════
  let promptDefaults = { chat: '', teacher: '', teacherFix: '', agent: '' };

  function showSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('show');
    if (cachedHardware) {
      renderSettingsHardware(cachedHardware, lastInstalledModels, cachedTaskModels);
    }
    renderUseCaseGrid();
    renderModelsSettings();
    updateConfiguredModelsDisplay(cachedConfiguredModels);
    vscode.postMessage({ type: 'getSettings' });
    vscode.postMessage({ type: 'getRecommendations' });
    if (lastInstalledModels.length === 0) requestModelsThrottled();
  }

  function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('show');
  }

  function switchSettingsTab(tab) {
    document.querySelectorAll('.settings-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.settings-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === 'panel-' + tab);
    });
  }

  function fillPromptFields(prompts) {
    const map = {
      chat: 'prompt-chat',
      teacher: 'prompt-teacher',
      teacherFix: 'prompt-teacher-fix',
      agent: 'prompt-agent',
    };
    Object.entries(map).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el && prompts && prompts[key] !== undefined) {
        el.value = prompts[key] || '';
      }
    });
  }

  function collectPrompts() {
    return {
      chat: document.getElementById('prompt-chat')?.value || '',
      teacher: document.getElementById('prompt-teacher')?.value || '',
      teacherFix: document.getElementById('prompt-teacher-fix')?.value || '',
      agent: document.getElementById('prompt-agent')?.value || '',
    };
  }

  function collectApiModels() {
    return {
      groq: document.getElementById('groq-model')?.value || '',
      cerebras: document.getElementById('cerebras-model')?.value || '',
      together: document.getElementById('together-model')?.value || '',
      cohere: document.getElementById('cohere-model')?.value || '',
      huggingface: document.getElementById('huggingface-model')?.value || '',
      gemini: document.getElementById('gemini-model')?.value || '',
      openrouter: document.getElementById('openrouter-model')?.value || '',
    };
  }

  function fillApiModels(apiModels) {
    if (!apiModels) return;
    const map = {
      groq: 'groq-model',
      cerebras: 'cerebras-model',
      together: 'together-model',
      cohere: 'cohere-model',
      huggingface: 'huggingface-model',
      gemini: 'gemini-model',
      openrouter: 'openrouter-model',
    };
    Object.entries(map).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el && apiModels[key]) el.value = apiModels[key];
    });
  }

  function updateApiStatusBadges(keysConfigured) {
    if (!keysConfigured) return;
    Object.entries(keysConfigured).forEach(([k, configured]) => {
      const badge = document.getElementById('status-' + k);
      if (badge) badge.style.display = configured ? 'inline' : 'none';
    });
  }

  function useProviderFromSettings(provider) {
    if (providerEl) providerEl.value = provider;
    syncInternetControlVisibility(provider);
    updateModelRow(provider, false);
    vscode.postMessage({ type: 'setProviderFromSettings', provider });
  }

  function fillAgentIdeOptions(opts) {
    const ide = document.getElementById('agent-ide-mode');
    const self = document.getElementById('agent-self-modify');
    if (ide && opts) ide.checked = !!opts.agentIdeMode;
    if (self && opts) self.checked = !!opts.agentSelfModify;
  }

  function saveSettings() {
    const keys = {
      groq: document.getElementById('groq-key')?.value || '',
      cerebras: document.getElementById('cerebras-key')?.value || '',
      together: document.getElementById('together-key')?.value || '',
      cohere: document.getElementById('cohere-key')?.value || '',
      huggingface: document.getElementById('huggingface-key')?.value || '',
      gemini: document.getElementById('gemini-key')?.value || '',
      openrouter: document.getElementById('openrouter-key')?.value || '',
    };
    vscode.postMessage({
      type: 'saveSettings',
      keys,
      models: collectApiModels(),
      prompts: collectPrompts(),
      agentIdeMode: !!document.getElementById('agent-ide-mode')?.checked,
      agentSelfModify: !!document.getElementById('agent-self-modify')?.checked,
    });
    closeSettingsModal();
  }

  const btnSettings = document.getElementById('btn-settings');
  const btnRecommendations = document.getElementById('btn-recommendations');
  const btnWelcomeRecommendations = document.getElementById('btn-welcome-recommendations');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnClear = document.getElementById('btn-clear');
  const btnTestOllama = document.getElementById('btn-test-ollama');
  const noModelsBanner = document.getElementById('no-models-banner');

  if (noModelsBanner) {
    noModelsBanner.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.tagName === 'BUTTON') {
        if (statusText) statusText.textContent = 'Recargando…';
        lastModelFetchMs = 0;
        vscode.postMessage({ type: 'checkConnection' });
        showRecommendations();
      }
    });
  }

  if (btnSettings) {
    btnSettings.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSettingsModal();
    });
  }
  if (btnRecommendations) {
    btnRecommendations.addEventListener('click', () => showRecommendations());
  }
  if (btnWelcomeRecommendations) {
    btnWelcomeRecommendations.addEventListener('click', () => showRecommendations());
  }
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      if (statusText) statusText.textContent = 'Recargando…';
      lastModelFetchMs = 0;
      vscode.postMessage({ type: 'checkConnection' });
    });
  }
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (confirm('¿Limpiar toda la conversación?')) {
        vscode.postMessage({ type: 'clearChat' });
      }
    });
  }
  if (btnTestOllama) {
    btnTestOllama.addEventListener('click', () => {
      const el = document.getElementById('test-result');
      if (el) el.textContent = 'Comprobando…';
      vscode.postMessage({ type: 'testOllama' });
    });
  }

  const btnRefreshHardware = document.getElementById('btn-refresh-hardware');
  if (btnRefreshHardware) {
    btnRefreshHardware.addEventListener('click', () => {
      const body = document.getElementById('settings-hardware-body');
      if (body) body.innerHTML = '<p>Analizando tu hardware y SO…</p>';
      vscode.postMessage({ type: 'getRecommendations' });
      requestModelsThrottled();
    });
  }

  document.querySelectorAll('.btn-use-api[data-provider]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const provider = btn.getAttribute('data-provider');
      if (provider) useProviderFromSettings(provider);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettingsModal();
      closeModal();
    }
  });

  if (messagesEl) {
    messagesEl.addEventListener('click', (e) => {
      const pre = e.target.closest('pre');
      if (!pre) return;
      const code = pre.textContent || '';
      if (!code.trim()) return;
      navigator.clipboard.writeText(code).then(() => {
        const tip = document.createElement('div');
        tip.textContent = '✓ Código copiado';
        tip.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#10B981;color:#fff;padding:6px 12px;border-radius:6px;font-size:11px;z-index:9999;';
        document.body.appendChild(tip);
        setTimeout(() => tip.remove(), 1500);
      }).catch(() => {});
    });
  }

  const settingsModal = document.getElementById('settings-modal');
  const settingsInner = document.getElementById('settings-modal-inner');
  const settingsClose = document.getElementById('settings-close');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  if (settingsClose) settingsClose.addEventListener('click', closeSettingsModal);
  if (btnSaveSettings) btnSaveSettings.addEventListener('click', saveSettings);
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });
  }
  if (settingsInner) {
    settingsInner.addEventListener('click', (e) => e.stopPropagation());
  }

  document.querySelectorAll('.settings-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab) switchSettingsTab(tab);
    });
  });

  document.querySelectorAll('.prompt-restore').forEach((btn) => {
    btn.addEventListener('click', () => {
      const field = btn.getAttribute('data-restore');
      if (!field || !promptDefaults[field]) return;
      const idMap = {
        chat: 'prompt-chat',
        teacher: 'prompt-teacher',
        teacherFix: 'prompt-teacher-fix',
        agent: 'prompt-agent',
      };
      const el = document.getElementById(idMap[field]);
      if (el) el.value = promptDefaults[field] || '';
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CARGAR MODELOS OLLAMA
  // ══════════════════════════════════════════════════════════════════════════
  function setProvider(provider) {
    vscode.postMessage({ type: 'setProvider', provider });
    syncInternetControlVisibility(provider);
    updateModelRow(provider, true);
  }

  function setInternetMode(value) {
    const useInternet = value === 'true';
    vscode.postMessage({ type: 'setInternetMode', useInternet });
    const provider = providerEl?.value || 'auto';
    if (autoHintEl) {
      autoHintEl.style.display = 'block';
      if (isWebProvider(provider)) {
        autoHintEl.textContent = '🌐 API web seleccionada. Configura la clave en ⚙️ si no conecta.';
      } else if (useInternet) {
        autoHintEl.textContent = '🌐 +Internet: búsqueda web solo si la pregunta lo pide (docs, noticias, tutoriales…).';
      } else {
        autoHintEl.textContent = '🏠 Solo local: Ollama en tu PC sin búsqueda web.';
      }
    }
    updateModelRow(provider, false);
  }

  let lastModelFetchMs = 0;
  const MODEL_FETCH_MIN_MS = 5000;

  function requestModelsThrottled() {
    const now = Date.now();
    if (now - lastModelFetchMs < MODEL_FETCH_MIN_MS) return;
    lastModelFetchMs = now;
    vscode.postMessage({ type: 'getOllamaModels' });
  }

  function updateModelRow(provider, force) {
    const ollamaRow = document.getElementById('ollama-models-row');
    if (!ollamaRow) return;
    syncInternetControlVisibility(provider);
    if (provider === 'auto' || provider === 'ollama') {
      ollamaRow.style.display = 'flex';
      if (force && lastInstalledModels.length === 0) {
        requestModelsThrottled();
      }
    } else {
      ollamaRow.style.display = 'none';
    }
  }

  let isSending = false;
  let sendingWatchdog = null;

  function finishSending() {
    isSending = false;
    if (sendingWatchdog) {
      clearTimeout(sendingWatchdog);
      sendingWatchdog = null;
    }
    removeTypingIndicator();
    currentAiEl = null;
    streamRaw = '';
    const btn = document.getElementById('send-btn');
    if (btn) {
      btn.textContent = '➤';
      btn.title = 'Enviar (Enter)';
    }
  }

  function startSending() {
    isSending = true;
    const btn = document.getElementById('send-btn');
    if (btn) {
      btn.textContent = '⏹';
      btn.title = 'Detener generación';
    }
    if (sendingWatchdog) clearTimeout(sendingWatchdog);
    sendingWatchdog = setTimeout(() => {
      if (!isSending) return;
      finishSending();
      addMessage('ai', '⚠ Tiempo de espera agotado. Comprueba que Ollama esté corriendo (ollama serve) o reinicia VS Code (Reload Window).');
    }, 300000);
  }

  function clearChatUi() {
    if (messagesEl) {
      messagesEl.innerHTML = '';
      if (welcomeEl) {
        messagesEl.appendChild(welcomeEl);
        welcomeEl.style.display = 'block';
      }
    }
    finishSending();
  }

  function submitPrompt() {
    if (!promptEl || !messagesEl) return;
    if (isSending) {
      vscode.postMessage({ type: 'cancel' });
      finishSending();
      return;
    }
    const text = promptEl.value.trim();
    if (!text) return;
    startSending();

    addMessage('user', text);
    promptEl.value = '';
    promptEl.style.height = 'auto';
    addTypingIndicator();

    vscode.postMessage({
      type: 'send',
      text,
      mode,
      includeEditor: mode === 'chat' && wantsEditorContext(text),
    });
  }

  document.querySelectorAll('.mode-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.getAttribute('data-mode');
      if (m) setMode(m);
    });
  });

  // Auto-resize textarea
  if (promptEl) {
    promptEl.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
  }

  if (providerEl) {
    providerEl.addEventListener('change', () => {
      vscode.postMessage({ type: 'setProvider', provider: providerEl.value });
      syncInternetControlVisibility(providerEl.value);
      updateModelRow(providerEl.value, true);
    });
  }

  if (internetEl) {
    internetEl.addEventListener('change', () => {
      setInternetMode(internetEl.value);
    });
  }

  const linkDonate = document.getElementById('link-donate');
  if (linkDonate) {
    linkDonate.addEventListener('click', (e) => {
      e.preventDefault();
      openDonate();
    });
  }

  document.querySelectorAll('.suggestion[data-action]').forEach((el) => {
    el.addEventListener('click', () => {
      const action = el.getAttribute('data-action');
      if (action) runQuickAction(action);
    });
  });

  const modalOverlay = document.getElementById('modal-overlay');
  const modalInner = document.getElementById('modal-inner');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', closeModal);
  }
  if (modalInner) {
    modalInner.addEventListener('click', (e) => e.stopPropagation());
  }
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeModal);
  }

  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.addEventListener('click', submitPrompt);
  if (promptEl) {
    promptEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitPrompt();
      }
    });
  }

  window.addEventListener('message', ({ data: msg }) => {
    switch (msg.type) {
      case 'ping':
        vscode.postMessage({ type: 'pong', id: msg.id });
        break;

      case 'simulateSend':
        if (msg.mode) setMode(msg.mode);
        if (msg.text && promptEl) {
          promptEl.value = msg.text;
          submitPrompt();
        }
        break;

      case 'initState':
        if (msg.provider && providerEl) providerEl.value = msg.provider;
        if (internetEl) internetEl.value = String(!!msg.useInternet);
        syncInternetControlVisibility(msg.provider || 'auto');
        updateModelRow(msg.provider || 'auto', true);
        if (autoHintEl && msg.useInternet) {
          autoHintEl.style.display = 'block';
          autoHintEl.textContent = '🌐 +Internet activo: búsqueda web cuando la pregunta lo pide.';
        }
        break;

      case 'bootstrap':
        if (msg.hardware) cachedHardware = msg.hardware;
        if (msg.taskModels) cachedTaskModels = msg.taskModels;
        if (msg.models) lastInstalledModels = msg.models;
        updateNoModelsBanner(!!msg.noModels);
        if (msg.hardware && !cachedHardware) cachedHardware = msg.hardware;
        break;

      case 'openRecommendations':
        document.getElementById('modal-overlay').classList.add('show');
        if (cachedHardware) {
          renderRecommendations(cachedHardware, lastInstalledModels, cachedTaskModels);
        } else {
          document.getElementById('modal-body').innerHTML = '<p>Analizando tu hardware y SO…</p>';
        }
        break;

      case 'recommendations':
        cachedHardware = msg.hardware || cachedHardware;
        if (cachedHardware) {
          renderSettingsHardware(cachedHardware, lastInstalledModels, cachedTaskModels);
        }
        cachedTaskModels = msg.taskModels || cachedTaskModels;
        if (msg.installed) lastInstalledModels = msg.installed;
        if (msg.configuredModels) updateConfiguredModelsDisplay(msg.configuredModels);
        renderUseCaseGrid();
        renderModelsSettings();
        renderRecommendations(cachedHardware, lastInstalledModels, cachedTaskModels);
        break;

      case 'connectionStatus': {
        const provider = msg.provider || 'auto';
        const effective = msg.effectiveProvider || provider;
        const useInternet = msg.internetEnabled !== undefined ? !!msg.internetEnabled : false;

        if (internetEl) internetEl.value = String(useInternet);
        if (providerEl) providerEl.value = provider;

        if (autoHintEl) {
          autoHintEl.style.display = 'block';
          if (msg.message) {
            autoHintEl.textContent = msg.message;
          } else if (isWebProvider(effective)) {
            autoHintEl.textContent = '🌐 API web: ' + effective + '. Clave en ⚙️.';
          } else if (useInternet) {
            autoHintEl.textContent = '🌐 Ollama local + internet bajo demanda.';
          } else {
            autoHintEl.textContent = '🏠 Ollama local sin internet.';
          }
        }

        statusBadge.className = 'status-badge ' + (msg.ok ? 'online' : 'offline');

        if (msg.ok) {
          const labels = {
            auto: '🔄 Auto',
            ollama: '🏠 Ollama',
            gemini: '💎 Gemini',
            groq: '⚡ Groq',
            cerebras: '🧠 Cerebras',
            together: '🤝 Together',
            cohere: '🔷 Cohere',
            huggingface: '🤗 HuggingFace',
            openrouter: '🔀 OpenRouter',
          };
          const label = provider === 'auto'
            ? (labels.auto + ' → ' + (labels[effective] || effective))
            : (labels[provider] || provider);
          const net = isWebProvider(effective) ? '🌐 ' : (useInternet ? '🌐 ' : '🏠 ');
          statusText.textContent = net + label + ' ✓';
        } else {
          statusText.textContent = msg.message || 'Desconectado';
        }

        syncInternetControlVisibility(provider);
        if (msg.taskModels) {
          cachedTaskModels = msg.taskModels;
          updateTaskModelsHint(msg.taskModels);
        }
        updateNoModelsBanner(!!msg.noModels);
        if (msg.models && msg.models.length > 0) {
          lastInstalledModels = msg.models;
          populateModelSelect(msg.models, msg.currentModel || '');
          updateNoModelsBanner(false);
        } else if (msg.currentModel) {
          populateModelSelect([msg.currentModel], msg.currentModel, true);
        }
        syncInternetControlVisibility(provider);
        const ollamaRow = document.getElementById('ollama-models-row');
        if (ollamaRow) {
          ollamaRow.style.display = (provider === 'auto' || provider === 'ollama') ? 'flex' : 'none';
        }
        break;
      }
      
      case 'sendAck':
        removeTypingIndicator();
        addTypingIndicator();
        break;

      case 'progress':
        removeTypingIndicator();
        if (msg.text) {
          if (currentAiEl) {
            streamRaw += (streamRaw ? '\\n\\n' : '') + msg.text;
            setBubbleMarkdown(currentAiEl, streamRaw);
          } else {
            addMessage('progress', msg.text);
          }
        }
        addTypingIndicator();
        break;
        
      case 'responseStart':
        removeTypingIndicator();
        streamRaw = '';
        currentAiEl = addMessage('ai', '');
        break;
        
      case 'token':
        if (currentAiEl) {
          streamRaw += msg.text;
          setBubbleMarkdown(currentAiEl, streamRaw);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        break;
        
      case 'responseEnd':
        finishSending();
        break;
        
      case 'response':
        finishSending();
        if (msg.text) {
          if (currentAiEl) {
            streamRaw = msg.text;
            setBubbleMarkdown(currentAiEl, streamRaw);
            currentAiEl = null;
          } else {
            addMessage('ai', msg.text);
          }
        }
        break;
        
      case 'prefill':
        setMode(msg.mode ?? 'chat');
        promptEl.value = msg.text;
        promptEl.focus();
        submitPrompt();
        break;

      case 'contextAttached':
        addMessage('ai', '📎 Código adjunto desde ' + (msg.filePath || 'editor'));
        break;

      case 'generationCancelled':
        finishSending();
        break;

      case 'chatCleared':
        clearChatUi();
        break;

      case 'testResult': {
        const el = document.getElementById('test-result');
        if (el) {
          el.textContent = msg.message || '';
          el.style.color = msg.ok ? '#10B981' : '#F59E0B';
        }
        break;
      }

      case 'settingsData':
        if (msg.defaults) promptDefaults = msg.defaults;
        if (msg.prompts) fillPromptFields(msg.prompts);
        fillAgentIdeOptions(msg);
        if (msg.apiModels) fillApiModels(msg.apiModels);
        if (msg.hardware) {
          cachedHardware = msg.hardware;
          renderSettingsHardware(msg.hardware, msg.installed || lastInstalledModels, msg.taskModels || cachedTaskModels);
        }
        if (msg.installed) lastInstalledModels = msg.installed;
        if (msg.taskModels) cachedTaskModels = msg.taskModels;
        if (msg.configuredModels) updateConfiguredModelsDisplay(msg.configuredModels);
        renderUseCaseGrid();
        renderModelsSettings();
        if (msg.keysConfigured) {
          updateApiStatusBadges(msg.keysConfigured);
          const placeholders = {
            groq: 'groq-key',
            cerebras: 'cerebras-key',
            together: 'together-key',
            cohere: 'cohere-key',
            huggingface: 'huggingface-key',
            gemini: 'gemini-key',
            openrouter: 'openrouter-key',
          };
          Object.entries(placeholders).forEach(([k, id]) => {
            const input = document.getElementById(id);
            if (input && msg.keysConfigured[k]) {
              input.placeholder = '•••••••• (ya configurada — deja vacío para mantener)';
            }
          });
        }
        break;

      case 'providerChanged':
        if (msg.provider && providerEl) {
          providerEl.value = msg.provider;
          syncInternetControlVisibility(msg.provider);
          updateModelRow(msg.provider, false);
        }
        break;

      case 'ollamaModels':
        lastInstalledModels = msg.models || [];
        populateModelSelect(msg.models || [], msg.currentModel || '', !!msg.loading);
        if (!msg.loading) {
          if (msg.error && statusText) {
            statusText.textContent = '⚠ ' + msg.error;
            statusBadge.className = 'status-badge offline';
          } else if (lastInstalledModels.length > 0 && statusText) {
            statusBadge.className = 'status-badge online';
            statusText.textContent = '🏠 Ollama · ' + lastInstalledModels.length + ' IA(s) ✓';
          }
        }
        if (lastInstalledModels.length > 0) {
          updateNoModelsBanner(false);
        }
        if (cachedHardware) {
          const modal = document.getElementById('modal-overlay');
          if (modal && modal.classList.contains('show')) {
            renderRecommendations(cachedHardware, lastInstalledModels, cachedTaskModels);
          }
        }
        break;
    }
  });

  // Listener para cambio de modelo Ollama (actualiza chatModel y completionModel)
  const modelSelect = document.getElementById('ollama-model-select');
  if (modelSelect) {
    modelSelect.addEventListener('change', function() {
      if (this.value) {
        vscode.postMessage({ type: 'setModel', model: this.value });
      }
    });
  }

  // Inicializar UI — handshake cuando el script ya escucha
  try {
    setMode('chat');
    syncInternetControlVisibility(providerEl?.value || 'auto');
    updateModelRow(providerEl?.value || 'auto', true);
    if (statusText) statusText.textContent = 'Cargando IAs de Ollama…';
    vscode.postMessage({ type: 'ready' });
    requestModelsThrottled();
  } catch (initErr) {
    console.error('Local Copilot init:', initErr);
    vscode.postMessage({ type: 'scriptError', message: String(initErr) });
  }

  let modelRetries = 0;
  const modelRetryTimer = setInterval(() => {
    if (lastInstalledModels.length > 0 || modelRetries >= 5) {
      clearInterval(modelRetryTimer);
      if (!lastInstalledModels.length && statusText) {
        statusText.textContent = '⚠ Sin modelos — comprueba Ollama';
        statusBadge.className = 'status-badge offline';
      }
      return;
    }
    modelRetries++;
    requestModelsThrottled();
  }, 5000);
</script>
</body>
</html>`;
  }
}
