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
import { buildFuturisticWebDesignBlock, wantsFuturisticAnimalWeb } from './designProfiles/futuristicWebProfile';
import {
  buildProfessionalCapabilitiesBlock,
  wantsNekotinaClone,
  wantsProfessionalProject,
} from './designProfiles/professionalCapabilitiesProfile';
import { NEKOTINA_FULL_FILES } from './nekotinaFullBlueprint';
import { detectBlueprint } from './projectBlueprints';
import { gatherReferenceContext } from './referenceLearner';
import {
  buildClarificationMessage,
  buildRequirementsBlock,
  shouldGatherRequirements,
  type RequirementsSession,
} from './requirementsGatherer';
import { gatherSmartContext } from './smartContext';
import { getEditorActionSpec, type EditorQuickAction } from './editorActions';
import { pickProjectType, sessionForChoice } from './projectWizard';
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
import { SshGrokOptimizer, collectSystemSnapshot, buildSshAnalyzePrompt, getSshConfig } from './sshSystemAnalyzer';

// ── Tipos de mensajes Webview ────────────────────────────────────────────────

type ChatMode = 'chat' | 'agent' | 'teacher';

type WebviewInMessage =
  | { type: 'send'; text: string; mode: ChatMode; includeEditor?: boolean; forceEditor?: boolean }
  | { type: 'quickAction'; action: EditorQuickAction }
  | { type: 'createProject' }
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
  private requirementsSession: RequirementsSession | null = null;
  private readonly github?: GitHubService;
  private readonly extensionContext?: vscode.ExtensionContext;
  private static readonly PENDING_AGENT_KEY = 'local.pendingAgentRequest';
  private static readonly MODELS_REQUEST_MIN_MS = 3_000;
  private static readonly MODELS_CACHE_MS = 45_000;
  private static readonly SYNC_TIMEOUT_MS = 12_000;

  /** Panel fijo del agente — se sincroniza entero en cada actualización. */
  private agentPanel: {
    active: boolean;
    steps: string[];
    code: string;
    summary: string;
    startedAt: number;
  } = { active: false, steps: [], code: '', summary: '', startedAt: 0 };
  private agentHeartbeat?: ReturnType<typeof setInterval>;
  private lastLoggedAgentSyncSteps = -1;
  private agentSyncTimer?: ReturnType<typeof setTimeout>;
  private agentSyncDirty = false;
  private static readonly AGENT_SYNC_MS = 180;

  constructor(
    private readonly extensionUri: vscode.Uri,
    ollama: OllamaClient,
    github?: GitHubService,
    log?: (line: string) => void,
    extensionContext?: vscode.ExtensionContext
  ) {
    this.ollama = ollama;
    this.github  = github;
    this.agent   = new LocalAgent(ollama, github, (line) => this.postAgentUiLine(line));
    this.extensionContext = extensionContext;
    if (log) { this.outputLog = log; }
  }

  // ── API de VS Code ────────────────────────────────────────────────────────────

  private savePendingAgentRequest(text: string, gen: number): void {
    void this.extensionContext?.globalState.update(
      LocalChatViewProvider.PENDING_AGENT_KEY,
      { text, gen, savedAt: Date.now() }
    );
  }

  private clearPendingAgentRequest(): void {
    void this.extensionContext?.globalState.update(LocalChatViewProvider.PENDING_AGENT_KEY, undefined);
  }

  private loadPendingAgentRequest(): { text: string; gen: number } | null {
    const raw = this.extensionContext?.globalState.get<{ text: string; gen: number; savedAt?: number }>(
      LocalChatViewProvider.PENDING_AGENT_KEY
    );
    if (!raw?.text) { return null; }
    if (raw.savedAt && Date.now() - raw.savedAt > 10 * 60_000) {
      this.clearPendingAgentRequest();
      return null;
    }
    return { text: raw.text, gen: raw.gen };
  }

  /** Reintenta la petición del Agente tras abrir carpeta automáticamente. */
  async resumePendingAgentRequest(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) { return; }
    const pending = this.loadPendingAgentRequest();
    if (!pending) { return; }
    this.clearPendingAgentRequest();
    await this.ensureWebviewReady();
    this.chatGeneration += 1;
    const gen = this.chatGeneration;
    this.resetAgentPanel();
    this.pushAgentPanelStep('📂 Proyecto abierto — continuando automáticamente…');
    this.post({ type: 'sendAck', gen });
    this.post({ type: 'responseStart', agentLive: true, resumeSending: true });
    try {
      await this.handleAgentMode(pending.text, gen, null);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.finishAgentPanel(`⚠ Error: ${errMsg}`);
      this.post({ type: 'responseEnd' });
      this.post({ type: 'response', text: `⚠ Error: ${errMsg}`, done: true, append: true, agentLive: true });
      this.post({ type: 'agentDone' });
    }
  }

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
        const choice = await vscode.window.showWarningMessage(
          '¿Limpiar toda la conversación del chat?',
          { modal: true },
          'Sí, limpiar',
          'Cancelar'
        );
        if (choice === 'Sí, limpiar') {
          this.clearChat();
        }
      } else if (message.type === 'testOllama') {
        await this.runOllamaTest();
      } else if (message.type === 'send') {
        const text = message.text?.trim();
        if (!text) { return; }
        const mode: ChatMode =
          message.mode === 'agent' || message.mode === 'teacher' ? message.mode : 'chat';
        this.trace(`[send] mode=${mode} chars=${text.length}`);
        this.sendReceivedForTest = true;
        const gen = ++this.chatGeneration;
        void this.reveal();
        this.post({ type: 'sendAck', gen });
        if (mode === 'agent') {
          this.resetAgentPanel();
          this.pushAgentPanelStep(
            `📨 Petición: ${text.slice(0, 160)}${text.length > 160 ? '…' : ''}`
          );
          this.post({ type: 'responseStart', agentLive: true });
        }
        try {
          await this.handleUserMessage(
            text,
            mode,
            message.includeEditor === true,
            gen,
            message.forceEditor === true
          );
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.finishAgentPanel(`Error: ${errMsg}`);
          this.postChatReply(
            this.formatUserError(
              'No se pudo procesar el mensaje',
              'Comprueba Ollama (ollama serve) o tu API en ⚙️. Detalle: ' + errMsg
            )
          );
          this.post({ type: 'agentDone' });
        }
      } else if (message.type === 'createProject') {
        try {
          await this.runProjectCreationWizard();
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.postChatReply(this.formatUserError('No se pudo iniciar el asistente de proyecto', errMsg));
        }
      } else if (message.type === 'quickAction') {
        try {
          await this.runEditorQuickAction(message.action);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.postChatReply(this.formatUserError('No se pudo completar la acción', errMsg));
        }
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
        if (this.agentPanel.active || this.agentPanel.steps.length > 0) {
          this.syncAgentPanel();
        }
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
      version: this.getExtensionVersion(),
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
    if (this.openChatPanel) {
      await this.openChatPanel();
    }
    await this.waitUntilReady();
    if (this.view) {
      await this.view.show?.(true);
    }
  }

  /** Asegura panel + script del chat antes de enviar progreso del agente. */
  public async ensureWebviewReady(timeoutMs = 15_000): Promise<boolean> {
    await this.reveal();
    const start = Date.now();
    while ((!this.view || !this.webviewScriptReady) && Date.now() - start < timeoutMs) {
      await new Promise<void>((r) => setTimeout(r, 100));
    }
    if (!this.view || !this.webviewScriptReady) {
      this.outputLog('[chat] webview no lista — mensajes irán a Output → Local Copilot');
      return false;
    }
    return true;
  }

  private resetAgentPanel(): void {
    if (this.agentHeartbeat) {
      clearInterval(this.agentHeartbeat);
      this.agentHeartbeat = undefined;
    }
    this.agentPanel = { active: true, steps: [], code: '', summary: '', startedAt: Date.now() };
    this.syncAgentPanel(true);
    this.agentHeartbeat = setInterval(() => {
      if (!this.agentPanel.active) { return; }
      const mins = Math.floor((Date.now() - this.agentPanel.startedAt) / 60_000);
      this.syncAgentPanel(true);
      this.post({ type: 'agentPulse', elapsedMin: mins });
    }, 45_000);
  }

  private finishAgentPanel(summary: string): void {
    if (this.agentHeartbeat) {
      clearInterval(this.agentHeartbeat);
      this.agentHeartbeat = undefined;
    }
    this.agentPanel.active = false;
    this.agentPanel.summary = summary;
    this.syncAgentPanel(true);
  }

  private pushAgentPanelStep(text: string): void {
    const t = text.trim();
    if (!t) { return; }
    this.agentPanel.active = true;
    this.agentPanel.steps.push(t);
    if (this.agentPanel.steps.length > 100) {
      this.agentPanel.steps = this.agentPanel.steps.slice(-80);
    }
    this.syncAgentPanel();
  }

  /** Evita artefactos PLANPLANPLAN… cuando Ollama reinicia el streaming varias veces. */
  private sanitizeAgentPanelCode(raw: string): string {
    if (!raw) { return ''; }
    let s = raw.replace(/(?:PLAN\s*:?\s*){2,}/gi, 'PLAN:\n');
    const meaningful = s
      .replace(/\bPLAN\s*:?\s*/gi, '')
      .replace(/\bEXPLICACION\s*:?\s*/gi, '')
      .trim();
    if (!meaningful || meaningful.length < 12) {
      if (!/\bACCION\s*:/i.test(s) && !/<<CONTENIDO>>/i.test(s)) {
        return '';
      }
    }
    return s.trim();
  }

  private clearAgentPanelCode(): void {
    this.agentPanel.code = '';
    this.syncAgentPanel(true);
  }

  private appendAgentPanelCode(token: string): void {
    if (!token) { return; }
    this.agentPanel.active = true;
    this.agentPanel.code += token;
    if (this.agentPanel.code.length > 60_000) {
      this.agentPanel.code = this.agentPanel.code.slice(-50_000);
    }
    this.syncAgentPanel();
  }

  private syncAgentPanel(force = false): void {
    this.agentSyncDirty = true;
    if (force) {
      this.flushAgentSync();
      return;
    }
    if (this.agentSyncTimer) { return; }
    this.agentSyncTimer = setTimeout(() => {
      this.agentSyncTimer = undefined;
      this.flushAgentSync();
    }, LocalChatViewProvider.AGENT_SYNC_MS);
  }

  private flushAgentSync(): void {
    if (!this.agentSyncDirty) { return; }
    this.agentSyncDirty = false;
    const elapsedMin = this.agentPanel.startedAt
      ? Math.floor((Date.now() - this.agentPanel.startedAt) / 60_000)
      : 0;
    this.post({
      type: 'agentSync',
      active: this.agentPanel.active,
      steps: [...this.agentPanel.steps],
      code: this.sanitizeAgentPanelCode(this.agentPanel.code),
      summary: this.agentPanel.summary,
      elapsedMin,
    });
  }

  /** Réplica en el chat lo que el agente escribe en Output → Local Agente. */
  private postAgentUiLine(line: string): void {
    const text = line.trim();
    if (!text) { return; }
    const icon = text.startsWith('[MODIFY]') ? '✏️'
      : text.startsWith('[CREATE]') ? '🆕'
        : text.startsWith('[DELETE]') ? '🗑️'
          : text.startsWith('[CMD]') ? '▶'
            : text.startsWith('[AGENTE]') ? '🤖'
              : '📋';
    const pretty = text
      .replace(/^\[(MODIFY|CREATE|DELETE|CMD|AGENTE[^\]]*)\]\s*/i, '')
      .trim();
    this.pushAgentPanelStep(`${icon} ${pretty}`);
    this.post({ type: 'progress', text: `${icon} ${pretty}`, agentLive: true });
  }

  public sendExternalPrompt(text: string, mode: ChatMode = 'chat'): void {
    void this.reveal();
    this.post({ type: 'prefill', text, mode });
  }

  /** Análisis rápido del sistema (local o SSH) — una pasada con el agente. */
  public async runSshSystemAnalyze(preferSsh = true): Promise<void> {
    await this.reveal();
    await this.waitUntilReady(12_000);
    const ssh = getSshConfig();
    const gen = ++this.chatGeneration;
    this.post({ type: 'sendAck', gen });
    this.post({ type: 'responseStart' });
    this.post({ type: 'progress', text: '🔬 Recolectando información del sistema…' });

    try {
      const snapshot = await collectSystemSnapshot(preferSsh && ssh.enabled, (m) => {
        this.post({ type: 'progress', text: m });
      });
      const prompt = buildSshAnalyzePrompt(snapshot);
      await this.handleAgentMode(prompt, gen, null, { skipShell: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.post({ type: 'response', text: `⚠️ Error: ${msg}`, done: true });
    }
  }

  /**
   * Modo Grok autónomo: analiza y mejora el sistema durante horas (2–3h por defecto).
   * Local o vía SSH según configuración.
   */
  /** Ollama Build — agente autónomo como Cursor (multi-ronda con herramientas). */
  public async runOllamaBuild(task?: string): Promise<void> {
    const text =
      task?.trim() ||
      (await vscode.window.showInputBox({
        title: 'Ollama Build',
        prompt: 'Describe la tarea (el agente leerá, escribirá y ejecutará terminal solo)',
        placeHolder: 'Ej: Crea bot Discord con radio, música y admin panel',
      }))?.trim();
    if (!text) { return; }

    await this.reveal();
    await this.waitUntilReady(12_000);
    const gen = ++this.chatGeneration;
    this.resetAgentPanel();
    this.pushAgentPanelStep(`🚀 Ollama Build: ${text.slice(0, 140)}${text.length > 140 ? '…' : ''}`);
    this.post({ type: 'sendAck', gen });
    this.post({ type: 'setMode', mode: 'agent' });
    this.post({ type: 'responseStart', agentLive: true });
    try {
      await this.handleAgentMode(text, gen, this.requirementsSession);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.finishAgentPanel(`⚠ Error: ${msg}`);
      this.post({ type: 'response', text: `⚠ Ollama Build: ${msg}`, done: true, append: true, agentLive: true });
      this.post({ type: 'agentDone' });
    }
  }

  public async runGrokSystemOptimize(preferSsh = true): Promise<void> {
    await this.reveal();
    await this.waitUntilReady(12_000);
    const gen = ++this.chatGeneration;
    this.post({ type: 'sendAck', gen });
    this.post({ type: 'responseStart' });

    const optimizer = new SshGrokOptimizer(this.ollama, this.agent, this.outputLog);
    try {
      const result = await optimizer.run({
        preferSsh,
        onProgress: (msg) => {
          if (msg.trim()) {
            this.post({ type: 'progress', text: msg });
            this.post({ type: 'token', text: msg + '\n' });
          }
        },
      });
      const footer = result.complete
        ? '\n\n✅ **Optimización completa**'
        : `\n\n✓ Finalizado: ${result.rounds} ronda(s)`;
      this.post({ type: 'response', text: result.summary + footer, done: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.post({ type: 'response', text: `⚠️ Modo Grok: ${msg}`, done: true });
    }
  }

  private pendingEditorEnrich: ReturnType<typeof enrichMessageWithEditor> | undefined;
  private pendingTeacherApply = false;
  private openChatPanel?: () => Promise<void>;

  /** Abre el chat en el panel derecho (lo configura extension.ts). */
  public setOpenChatPanel(fn: () => Promise<void>): void {
    this.openChatPanel = fn;
  }

  /** Respuesta corta en el chat (libera el botón Enviar y evita UI colgada). */
  private postChatReply(text: string): void {
    this.post({ type: 'responseStart' });
    this.post({ type: 'response', text, done: true });
  }

  private formatUserError(summary: string, detail?: string): string {
    return detail ? `**${summary}**\n\n${detail}` : `**${summary}**`;
  }

  /** Asistente: elige tipo de proyecto y preguntas de funciones. */
  public async runProjectCreationWizard(): Promise<void> {
    const choice = await pickProjectType();
    if (!choice) {
      this.post({ type: 'generationCancelled' });
      return;
    }

    const session = sessionForChoice(choice);
    await this.reveal();
    await this.waitUntilReady(8000);
    this.post({ type: 'setMode', mode: 'chat' });

    if (session) {
      this.requirementsSession = session;
      this.post({ type: 'responseStart' });
      this.post({ type: 'response', text: buildClarificationMessage(session), done: true });
      return;
    }

    const gen = ++this.chatGeneration;
    this.post({ type: 'sendAck', gen });
    await this.handleUserMessage(choice.seed, 'chat', false, gen, false);
  }

  /** Acción rápida del editor: explicar, generar, arreglar o refactorizar. */
  public async runEditorQuickAction(action: EditorQuickAction): Promise<void> {
    try {
      const spec = getEditorActionSpec(action);
      const editor = resolveCodeEditor();
      const hasCode = !!editor && editor.document.getText().trim().length > 20;

      if (action === 'generate' && !hasCode) {
        await this.runProjectCreationWizard();
        return;
      }

      if (!editor) {
        if (action === 'explain' || action === 'fix' || action === 'refactor') {
          await this.reveal();
          await this.waitUntilReady(8000);
          this.postChatReply(
            'Abre un **archivo de código** en el editor (izquierda) y vuelve a pulsar el botón.'
          );
          return;
        }
        await this.runProjectCreationWizard();
        return;
      }

      if (spec.teacherFix) {
        this.pendingTeacherApply = true;
      }

      this.pendingEditorEnrich = enrichMessageWithEditor(spec.prompt, spec.attachEditor);
      await this.reveal();
      await this.waitUntilReady(8000);
      this.post({ type: 'setMode', mode: spec.mode });

      const gen = ++this.chatGeneration;
      this.post({ type: 'sendAck', gen });
      await this.handleUserMessage(spec.prompt, spec.mode, spec.attachEditor, gen, true);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.outputLog(`[quickAction:${action}] ${errMsg}`);
      this.postChatReply(this.formatUserError('Error al ejecutar la acción', errMsg));
    }
  }

  /** Explica código del editor (captura ANTES de que el chat robe el foco). */
  public async explainFromEditor(): Promise<void> {
    await this.runEditorQuickAction('explain');
  }

  /** Limpia el historial del chat en el panel. */
  public clearChat(): void {
    this.cancelActiveGeneration();
    this.requirementsSession = null;
    this.clearPendingAgentRequest();
    if (this.agentHeartbeat) {
      clearInterval(this.agentHeartbeat);
      this.agentHeartbeat = undefined;
    }
    this.agentPanel = { active: false, steps: [], code: '', summary: '', startedAt: 0 };
    this.trace('[chat] conversación limpiada');
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
      const isAgent = mode === 'agent';
      if (isAgent) {
        this.resetAgentPanel();
        this.pushAgentPanelStep(`📨 Test: ${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`);
        this.post({ type: 'responseStart', agentLive: true });
      }
      const done = new Promise<void>((resolve) => {
        const check = (): void => {
          if (isAgent && events.includes('agentDone')) { resolve(); return; }
          if (events.includes('responseEnd') || events.includes('response')) { resolve(); }
        };
        const interval = setInterval(() => {
          check();
          if (isAgent && events.includes('agentDone')) { clearInterval(interval); }
          else if (events.includes('responseEnd') || events.includes('response')) { clearInterval(interval); }
        }, 200);
        setTimeout(() => { clearInterval(interval); resolve(); }, timeoutMs);
      });

      await this.handleUserMessage(text, mode, false, gen);
      await done;

      const ok = isAgent
        ? events.includes('agentDone')
        : snippet.trim().length > 3 &&
          (events.includes('responseEnd') || events.includes('response'));
      this.trace(`[pipeline:${mode}] events=${events.join(',')} ok=${ok}`);
      return { ok, events, snippet: snippet.trim().slice(0, 200) };
    } finally {
      restore();
    }
  }

  /** Muestra un mensaje en el chat (visible para depuración / tests en vivo). */
  public async injectChatMessage(
    text: string,
    role: 'user' | 'ai' = 'ai',
    style: 'info' | 'ok' | 'fail' = 'info'
  ): Promise<void> {
    await this.reveal();
    await this.waitUntilReady(10_000);
    this.post({ type: 'chatInject', text, role, style });
    this.trace(`[chatInject:${style}] ${text.slice(0, 120)}`);
  }

  /** Línea en el banner de test + log de depuración. */
  public appendAgentTestLine(line: string, kind: 'info' | 'ok' | 'fail' = 'info'): void {
    debugLog(`[agent-live:ui] ${line}`);
    this.post({ type: 'agentTestLine', line, kind });
  }

  /** Prepara la UI para test agente: pestaña Agente + banner visible. */
  public async beginAgentLiveTestUi(scenarioCount: number): Promise<void> {
    await this.reveal();
    await this.waitUntilReady(15_000);
    this.post({ type: 'agentTestStart', total: scenarioCount });
    this.post({ type: 'setMode', mode: 'agent' });
    await this.injectChatMessage(
      `🧪 **Test agente en vivo** — ${scenarioCount} escenarios.\n` +
      'Verás cada petición **escribirse letra a letra** en el input y la respuesta del agente en el panel morado.',
      'ai',
      'info'
    );
  }

  public endAgentLiveTestUi(summary: string, ok: boolean): void {
    this.post({ type: 'agentTestEnd' });
    void this.injectChatMessage(summary, 'ai', ok ? 'ok' : 'fail');
  }

  /** Prueba envío real webview→extensión→Ollama (como si el usuario pulsara Enter). */
  public async testWebviewUserSend(
    text: string,
    mode: ChatMode = 'chat',
    timeoutMs = 90_000,
    options?: { typing?: boolean; typingMs?: number }
  ): Promise<{ ok: boolean; events: string[]; snippet: string }> {
    const events: string[] = [];
    let snippet = '';
    let lastProgress = '';
    const origPost = this.post.bind(this);
    const restore = (): void => { this.post = origPost; };
    const isAgent = mode === 'agent';

    this.post = (msg: Record<string, unknown>) => {
      const t = String(msg.type ?? '?');
      events.push(t);
      if (t === 'token' && typeof msg.text === 'string') { snippet += msg.text; }
      if (t === 'response' && typeof msg.text === 'string') { snippet = msg.text; }
      if (t === 'progress' && typeof msg.text === 'string') {
        lastProgress = msg.text.trim().slice(0, 160);
        if (isAgent) { this.trace(`[agent-live:progress] ${lastProgress}`); }
      }
      if (t === 'agentSync' && isAgent) {
        const steps = Array.isArray(msg.steps) ? msg.steps.length : 0;
        const codeLen = typeof msg.code === 'string' ? msg.code.length : 0;
        this.trace(`[agent-live:sync] steps=${steps} code=${codeLen} active=${!!msg.active}`);
      }
      if (t === 'agentDone' && isAgent) {
        this.trace('[agent-live:ui] agentDone — generación terminada');
      }
      if (t === 'codeStreamStart' && isAgent) {
        this.trace('[agent-live:ui] código en vivo iniciado');
      }
      origPost(msg);
    };

    const isComplete = (): boolean => {
      if (!this.sendReceivedForTest) { return false; }
      if (isAgent) {
        return events.includes('agentDone') &&
          (events.includes('response') || events.includes('progress'));
      }
      return events.includes('responseEnd') || events.includes('response');
    };

    try {
      await this.reveal();
      if (!this.view || !this.webviewScriptReady) {
        return { ok: false, events: ['not-ready'], snippet: '' };
      }
      this.sendReceivedForTest = false;
      this.trace(`[userSend:${mode}] simulateSend → "${text.slice(0, 80)}…" typing=${!!options?.typing}`);
      origPost({
        type: 'simulateSend',
        text,
        mode,
        typing: options?.typing ?? (mode === 'agent'),
        typingMs: options?.typingMs ?? 22,
      });

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (isComplete()) { break; }
        await new Promise<void>((r) => setTimeout(r, 300));
      }

      const ok = isComplete() && (isAgent ? events.includes('agentDone') : snippet.trim().length > 1);
      this.trace(
        `[userSend:${mode}] send=${this.sendReceivedForTest} ok=${ok} ` +
        `events=${events.filter((e, i, a) => a.indexOf(e) === i).join(',')}` +
        (lastProgress ? ` last="${lastProgress.slice(0, 60)}…"` : '')
      );
      if (!ok && isAgent) {
        this.trace(`[userSend:agent] FALLO — revisa panel morado y Output → Local Agente`);
      }
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

  /** Reenvía tokens del agente solo al panel fijo (sin burbuja duplicada en el chat). */
  private createAgentTokenFlusher(gen: number): {
    push: (token: string) => void;
    flush: () => void;
    resetStream: () => void;
  } {
    let pending = '';
    let tokenTimer: ReturnType<typeof setTimeout> | undefined;

    const flushTokens = (): void => {
      pending = '';
      tokenTimer = undefined;
    };

    return {
      push: (token: string) => {
        if (!token || !this.isGenerationActive(gen)) { return; }
        this.appendAgentPanelCode(token);
        pending += token;
        if (!tokenTimer) {
          tokenTimer = setTimeout(flushTokens, 70);
        }
      },
      flush: () => {
        if (tokenTimer) {
          clearTimeout(tokenTimer);
          tokenTimer = undefined;
        }
        flushTokens();
      },
      resetStream: () => {
        if (tokenTimer) {
          clearTimeout(tokenTimer);
          tokenTimer = undefined;
        }
        pending = '';
        this.clearAgentPanelCode();
      },
    };
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
    const hasWorkspace = !!vscode.workspace.workspaceFolders?.length;
    const reqCheck = shouldGatherRequirements(text, this.requirementsSession, hasWorkspace, { mode });

    if (reqCheck.gather && reqCheck.message) {
      this.requirementsSession = reqCheck.session;
      this.post({ type: 'responseStart' });
      this.post({ type: 'response', text: reqCheck.message, done: true });
      return;
    }

    if (reqCheck.session) {
      this.requirementsSession = reqCheck.session;
    }

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
      const fixIntent = wantsTeacherFix(text) || this.pendingTeacherApply;
      if (this.pendingTeacherApply) {
        this.pendingTeacherApply = false;
      }
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

    if (enriched.attached && this.isGenerationActive(gen)) {
      this.post({
        type: 'progress',
        text: `📎 Usando código de \`${enriched.filePath}\``,
      });
    }

    if (!this.isGenerationActive(gen)) {
      const cancelMsg = 'Petición cancelada. Pulsa de nuevo **Enviar** cuando quieras continuar.';
      if (mode === 'agent') {
        this.pushAgentPanelStep(cancelMsg);
        this.post({ type: 'response', text: cancelMsg, done: true, agentLive: true });
        this.post({ type: 'agentDone' });
      } else {
        this.post({ type: 'response', text: cancelMsg, done: true });
      }
      return;
    }

    const reqBlock = this.requirementsSession?.complete
      ? buildRequirementsBlock(this.requirementsSession)
      : '';
    const promptWithReq = reqBlock ? `${reqBlock}\n\n${enriched.text}` : enriched.text;

    if (mode === 'agent') {
      await this.handleAgentMode(promptWithReq, gen, this.requirementsSession);
      if (this.requirementsSession?.complete) {
        this.requirementsSession = null;
      }
      return;
    }
    await this.handleChatMode(
      promptWithReq,
      enriched.attached,
      mode === 'teacher' ? 'teacher' : 'chat',
      gen
    );
    if (this.requirementsSession?.complete) {
      this.requirementsSession = null;
    }
  }

  /**
   * Modo agente: analiza el proyecto y aplica cambios directamente en disco.
   * El agente informa del progreso mediante callbacks en tiempo real.
   */
  private async handleAgentMode(
    text: string,
    gen: number,
    requirementsSession: RequirementsSession | null = null,
    options?: { skipShell?: boolean }
  ): Promise<void> {
    let deferAgentDone = false;
    let tokenFlusher: ReturnType<LocalChatViewProvider['createAgentTokenFlusher']> | undefined;
    const agentProgress = (progress: string): void => {
      this.outputLog(`[agente] ${progress}`);
      this.pushAgentPanelStep(progress);
      this.post({ type: 'progress', text: progress, agentLive: true });
      if (
        tokenFlusher &&
        /reintento automático|reescribiendo en el chat|corrigiendo respuesta|Pasada \d+\/\d+ modo generación/i.test(progress)
      ) {
        tokenFlusher.resetStream();
      }
    };

    try {
      void this.ensureWebviewReady();

      if (!options?.skipShell) {
        agentProgress('🤖 Agente activado — preparando entorno…');
      }

      if (!vscode.workspace.workspaceFolders?.length) {
        const autoOpen = vscode.workspace
          .getConfiguration('local')
          .get<boolean>('agentAutoOpenFolder', true);
        if (autoOpen) {
          this.savePendingAgentRequest(text, gen);
          agentProgress('📂 Abriendo selector de carpeta — elige tu proyecto y el agente continuará solo…');
          const folders = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Abrir proyecto',
            title: 'Local Copilot — Carpeta del proyecto',
          });
          if (folders?.[0]) {
            agentProgress('📂 Abriendo proyecto — el agente continuará tras recargar VS Code…');
            deferAgentDone = true;
            await vscode.commands.executeCommand('vscode.openFolder', folders[0], false);
            return;
          }
          this.clearPendingAgentRequest();
        }
        const noFolderMsg =
          '⚠ **Agente necesita un proyecto abierto.**\n\n' +
          '1. **Archivo → Abrir carpeta** (tu bot, web, etc.)\n' +
          '2. Pestaña **Agente** y describe qué crear o modificar\n' +
          '3. El agente escribe archivos en disco automáticamente\n\n' +
          '_Sin carpeta abierta solo funcionan Chat y Profesor (con archivo en el editor)._';
        this.finishAgentPanel(noFolderMsg);
        this.post({ type: 'responseEnd' });
        this.post({
          type: 'response',
          text: noFolderMsg,
          done: true,
          append: true,
          agentLive: true,
        });
        return;
      }

      agentProgress('🔗 Conectando con Ollama…');

      await this.ollama.prefetch(true);
      await this.ollama.autoSelectBestModels();

      let status = await this.ollama.checkConnection(true);
      if (!status.ok) {
        const installed = await this.ollama.getInstalledOllamaModels(true);
        const prov = vscode.workspace.getConfiguration('local').get<string>('provider', 'auto');
        if (installed.length > 0 && (prov === 'auto' || prov === 'ollama')) {
          status = { ok: true, models: installed, provider: prov, effectiveProvider: 'ollama' };
        } else {
          const offlineMsg = `⚠ **Agente no disponible.** ${status.message ?? 'Comprueba Ollama o configura una API en ⚙️.'}`;
          this.finishAgentPanel(offlineMsg);
          this.post({ type: 'responseEnd' });
          this.post({
            type: 'response',
            text: offlineMsg,
            done: true,
            append: true,
            agentLive: true,
          });
          return;
        }
      }

      const agentModel = this.ollama.getModelForTask('agent');
      agentProgress(`🧠 Agente (${agentModel}) — verás el código escribirse aquí en vivo`);
      tokenFlusher = this.createAgentTokenFlusher(gen);
      const result = await this.agent.handleRequest(
        text,
        agentProgress,
        agentModel,
        requirementsSession,
        (token) => tokenFlusher.push(token)
      );
      tokenFlusher.flush();

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
          : '_El agente no escribió archivos. Comprueba: **1)** carpeta del proyecto abierta, **2)** modelo agente (`qwen2.5-coder:14b` en ⚙️), **3)** pide algo concreto: "Crea public/index.html con diseño animalista" o "Modifica index.js y añade comando /ping"._';
      }

      if (hasWork) {
        summary += '\n_Aplicado por **Ollama** en modo Agente (no asistente externo)._';
      }

      this.finishAgentPanel(summary);
      this.post({ type: 'responseEnd' });
      this.post({ type: 'response', text: summary, done: true, append: true, agentLive: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.finishAgentPanel(`⚠ Error: ${message}`);
      this.post({ type: 'responseEnd' });
      this.post({ type: 'response', text: `⚠ Error: ${message}`, done: true, append: true, agentLive: true });
    } finally {
      if (!deferAgentDone) {
        this.post({ type: 'agentDone' });
      }
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
        text: this.formatUserError('Profesor no disponible', status.message ?? 'Ejecuta `ollama serve` o configura una API en ⚙️.'),
        done: true,
      });
      return;
    }

    const ctx = getEditorContextForFix();
    if (!ctx.code || !ctx.filePath) {
      this.post({
        type: 'response',
        text:
          '**Abre el archivo con el error** en el editor y vuelve a pulsar **Arreglar errores**.\n\n' +
          'Opcional: selecciona solo la parte problemática antes de enviar.',
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
      this.post({ type: 'responseStart', agentLive: true });
      this.post({
        type: 'progress',
        text: `🎓 Profesor (${teacherModel}) — diagnostica y corrige en vivo…`,
        agentLive: true,
      });

      const teacherFlusher = this.createAgentTokenFlusher(gen);
      const result = await this.agent.handleTeacherFix(
        enriched.attached ? enriched.text : text,
        ctx.filePath,
        ctx.code,
        diags,
        (progress) => {
          if (!this.isGenerationActive(gen)) { return; }
          this.post({ type: 'progress', text: progress, agentLive: true });
          if (/reintento|reescribiendo/i.test(progress)) {
            teacherFlusher.resetStream();
          }
        },
        teacherModel,
        (token) => teacherFlusher.push(token)
      );
      teacherFlusher.flush();

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

      this.post({ type: 'responseEnd' });
      this.post({ type: 'response', text: summary, done: true, append: true, agentLive: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: 'responseEnd' });
      this.post({ type: 'response', text: `⚠ Error: ${message}`, done: true, append: true, agentLive: true });
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
        this.postChatReply(
          this.formatUserError(
            'Sin conexión con la IA',
            status.message ?? `Abre ⚙️ y configura ${providerName}, o ejecuta \`ollama serve\` para usar Ollama local.`
          )
        );
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

        const smart = await gatherSmartContext({
          prompt: text,
          blueprint,
          internetEnabled: this.ollama.isInternetEnabled(),
          github: this.github,
          hardware: this.ollama.getHardwareProfile(),
        });
        if (smart?.block) {
          referenceContext += `\n\n${smart.block}`;
          if (this.isGenerationActive(gen)) {
            this.post({ type: 'token', text: `${smart.summary}\n\n` });
          }
        }
      }

      if (wantsFuturisticAnimalWeb(text)) {
        referenceContext += `\n\n${buildFuturisticWebDesignBlock()}`;
      }
      if (wantsProfessionalProject(text)) {
        referenceContext += `\n\n${buildProfessionalCapabilitiesBlock()}`;
      }
      if (wantsNekotinaClone(text)) {
        referenceContext +=
          `\n\nReferencia bot Discord completo (${NEKOTINA_FULL_FILES.length} archivos modulares).\n` +
          `Estructura: commands/, events/, services/, musica/, juegos/ — no monolito en index.js.\n`;
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
      this.postChatReply(
        this.formatUserError('Error de conexión', message + '. Comprueba `ollama serve` o tu API en ⚙️.')
      );
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
    } else if (t === 'agentSync') {
      const steps = Array.isArray(msg.steps) ? msg.steps.length : 0;
      const codeLen = typeof msg.code === 'string' ? msg.code.length : 0;
      const active = !!msg.active;
      const stepJump = steps !== this.lastLoggedAgentSyncSteps;
      if (stepJump || !active) {
        this.lastLoggedAgentSyncSteps = steps;
        this.trace(`[webview→] agentSync steps=${steps} code=${codeLen} active=${active}`);
      }
    } else if (t === 'progress' && msg.agentLive && typeof msg.text === 'string') {
      this.trace(`[agent-live:progress] ${msg.text.trim().slice(0, 140)}`);
    } else if (t !== 'token' && t !== 'progress') {
      this.trace(`[webview→] ${t}`);
    }
    if (!this.view) {
      this.trace(`[webview→] DESCARTADO (sin vista): ${t}`);
      if ((t === 'progress' || t === 'response') && typeof msg.text === 'string' && msg.text.trim()) {
        this.outputLog(`[chat sin UI] ${msg.text.trim().slice(0, 240)}`);
      }
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

  .welcome-emoji {
    font-size: 56px;
    line-height: 1;
    margin-bottom: 12px;
    filter: drop-shadow(0 4px 12px rgba(139, 92, 246, 0.45));
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
    max-width: 300px;
    margin: 0 auto 8px;
  }

  .welcome-modes {
    font-size: 12px !important;
    opacity: 0.9;
    max-width: 320px !important;
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

  .message.ai.agent-live .message-bubble {
    border-left: 3px solid var(--primary, #8b5cf6);
    background: rgba(139, 92, 246, 0.06);
    min-height: 48px;
  }

  .message.ai.code-stream-live .message-bubble {
    border: 2px solid var(--primary, #8b5cf6);
    box-shadow: 0 0 12px rgba(139, 92, 246, 0.35);
    animation: code-stream-pulse 2s ease-in-out infinite;
  }

  @keyframes code-stream-pulse {
    0%, 100% { box-shadow: 0 0 8px rgba(139, 92, 246, 0.25); }
    50% { box-shadow: 0 0 16px rgba(139, 92, 246, 0.45); }
  }

  .message.ai.agent-live .message-bubble pre,
  .message.ai.agent-live .message-bubble code {
    font-size: 12px;
    line-height: 1.45;
  }

  .agent-progress-log {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }

  .agent-step {
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #9ca3af);
    padding: 3px 0 3px 10px;
    border-left: 2px solid var(--primary, #8b5cf6);
    line-height: 1.35;
  }

  .agent-stream-wrap {
    margin-top: 10px;
    opacity: 0.55;
    transition: opacity 0.2s ease;
  }

  .agent-stream-wrap.active {
    opacity: 1;
  }

  .agent-stream-mirror {
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
    font-size: 12px;
    line-height: 1.45;
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.35));
    color: var(--vscode-editor-foreground, #f3f4f6);
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid rgba(139, 92, 246, 0.5);
    max-height: 280px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
    margin-top: 6px;
  }

  .agent-stream-mirror:empty::after,
  .agent-stream-mirror:last-child::after {
    content: '';
  }

  .message.ai.agent-live .agent-stream-mirror::after {
    content: ' ▋';
    color: var(--primary, #8b5cf6);
    animation: agent-cursor 1s step-end infinite;
  }

  .agent-stream-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--primary, #8b5cf6);
    margin-bottom: 6px;
  }

  .agent-stream-pre {
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
    font-size: 12px;
    line-height: 1.45;
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.25));
    color: var(--vscode-editor-foreground, #e5e7eb);
    padding: 10px 12px;
    border-radius: 8px;
    max-height: 360px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
    border: 1px solid rgba(139, 92, 246, 0.35);
    margin: 0;
  }

  .message.ai.agent-live .agent-stream-pre::after {
    content: ' ▋';
    color: var(--primary, #8b5cf6);
    animation: agent-cursor 1s step-end infinite;
  }

  .agent-summary {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
  }

  @keyframes agent-cursor {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
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

  .agent-test-banner {
    display: none;
    margin: 8px 12px 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.35);
    font-size: 11px;
    line-height: 1.45;
    max-height: 140px;
    overflow-y: auto;
  }
  .agent-test-banner.visible { display: block; }
  .agent-test-banner-title {
    font-weight: 700;
    margin-bottom: 6px;
    color: #60a5fa;
  }
  .agent-test-line { opacity: 0.92; margin: 2px 0; }
  .agent-test-line.fail { color: #f87171; font-weight: 600; }
  .agent-test-line.ok { color: #34d399; }
  .agent-test-line.info { color: #93c5fd; }
  .message.test-fail .message-bubble {
    border-left: 3px solid var(--danger, #ef4444);
    background: rgba(239, 68, 68, 0.1);
  }
  .message.test-ok .message-bubble {
    border-left: 3px solid var(--success, #10b981);
    background: rgba(16, 185, 129, 0.1);
  }
  .message.test-info .message-bubble {
    border-left: 3px solid var(--primary, #8b5cf6);
    background: rgba(139, 92, 246, 0.08);
  }
  #prompt.typing-active {
    border-color: var(--primary, #8b5cf6);
    box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.25);
  }

  .agent-live-panel {
    display: none;
    margin: 0 12px 8px;
    padding: 12px;
    border-radius: 12px;
    border: 2px solid var(--primary, #8b5cf6);
    background: rgba(139, 92, 246, 0.08);
    max-height: 42vh;
    overflow-y: auto;
    box-shadow: 0 4px 20px rgba(139, 92, 246, 0.2);
  }

  .agent-live-panel.visible {
    display: block;
  }

  .agent-panel-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--primary, #8b5cf6);
    margin-bottom: 8px;
    letter-spacing: 0.03em;
  }

  .agent-panel-steps {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 8px;
  }

  .agent-panel-step {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #9ca3af);
    padding-left: 8px;
    border-left: 2px solid var(--primary, #8b5cf6);
    line-height: 1.35;
  }

  .agent-panel-code {
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 11px;
    line-height: 1.4;
    background: rgba(0, 0, 0, 0.35);
    color: var(--vscode-editor-foreground, #e5e7eb);
    padding: 10px;
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid rgba(139, 92, 246, 0.4);
  }

  .agent-panel-summary {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 12px;
  }

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
      <div class="subtitle" id="app-subtitle">Ayudante de programación · v${version}</div>
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
    <span>Ayudante</span>
  </button>
</div>

<!-- MESSAGES -->
<div class="messages" id="messages">
  <div class="welcome" id="welcome">
    <div class="welcome-icon"><img src="${iconUri}" alt="" class="welcome-icon-img" /></div>
    <h2>Ayudante de programación</h2>
    <p>Tu asistente de IA dentro de <strong>VS Code</strong>. Tres modos para programar mejor:</p>
    <p class="welcome-modes"><strong>Chat</strong> — ideas y sugerencias · <strong>Profesor</strong> — aprende el código · <strong>Ayudante</strong> — escribe y modifica archivos</p>
    <p class="welcome-tip">Abre un archivo, elige una sugerencia o describe qué quieres programar. El panel está a la <strong>derecha</strong>.</p>
    
    <div class="suggestions">
      <div class="suggestion" data-action="create" title="Elige web, Discord, WhatsApp, API… y funciones">
        <span class="suggestion-icon">🚀</span>
        <span>Crear proyecto</span>
      </div>
      <div class="suggestion" data-action="generate" title="Genera código en el archivo abierto o elige tipo de proyecto">
        <span class="suggestion-icon">✨</span>
        <span>Generar código</span>
      </div>
      <div class="suggestion" data-action="explain" title="Explica el código del editor abierto">
        <span class="suggestion-icon">📚</span>
        <span>Explicar código</span>
      </div>
      <div class="suggestion" data-action="fix" title="Corrige errores y escribe el fix en el archivo">
        <span class="suggestion-icon">🔧</span>
        <span>Arreglar errores</span>
      </div>
      <div class="suggestion" data-action="refactor" title="Mejora solo el archivo abierto, sin tocar el resto">
        <span class="suggestion-icon">⚡</span>
        <span>Refactorizar archivo</span>
      </div>
    </div>
    <button type="button" class="btn-recommend" id="btn-welcome-recommendations">Ver modelos recomendados para tu PC</button>

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

<!-- Banner de test en vivo (visible durante depuración automática) -->
<div class="agent-test-banner" id="agent-test-banner">
  <div class="agent-test-banner-title" id="agent-test-title">🧪 Test agente en vivo</div>
  <div id="agent-test-lines"></div>
</div>

<!-- PANEL AGENTE FIJO (siempre visible encima del input) -->
<div class="agent-live-panel" id="agent-live-panel">
  <div class="agent-panel-title" id="agent-panel-title">😈 Ayudante en vivo</div>
  <div class="agent-panel-steps" id="agent-live-steps"></div>
  <pre class="agent-panel-code" id="agent-live-code" style="display:none"></pre>
  <div class="agent-panel-summary" id="agent-live-summary" style="display:none"></div>
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
  const agentLivePanel = document.getElementById('agent-live-panel');
  const agentLiveSteps = document.getElementById('agent-live-steps');
  const agentLiveCode = document.getElementById('agent-live-code');
  const agentLiveSummary = document.getElementById('agent-live-summary');
  const agentPanelTitle = document.getElementById('agent-panel-title');
  const WEB_PROVIDERS = ['groq', 'cerebras', 'together', 'cohere', 'huggingface', 'gemini', 'openrouter'];

  function sanitizeAgentCode(raw) {
    if (!raw) return '';
    let s = String(raw).replace(/(?:PLAN\s*:?\s*){2,}/gi, 'PLAN:\\n');
    const meaningful = s.replace(/\\bPLAN\\s*:?\\s*/gi, '').replace(/\\bEXPLICACION\\s*:?\\s*/gi, '').trim();
    if (!meaningful || meaningful.length < 12) {
      if (!/\\bACCION\\s*:/i.test(s) && !/<<CONTENIDO>>/i.test(s)) return '';
    }
    return s.trim();
  }

  function renderAgentPanel(msg) {
    if (!agentLivePanel || !agentLiveSteps) return;
    const steps = msg.steps || [];
    const code = sanitizeAgentCode(msg.code || '');
    const summary = msg.summary || '';
    const active = !!msg.active;

    if (active || steps.length > 0 || code || summary) {
      agentLivePanel.classList.add('visible');
      if (welcomeEl) welcomeEl.style.display = 'none';
    } else {
      agentLivePanel.classList.remove('visible');
      return;
    }

    if (agentPanelTitle) {
      const mins = msg.elapsedMin || 0;
      const elapsed = mins > 0 ? ' · ' + mins + ' min' : '';
      agentPanelTitle.textContent = active
        ? '😈 Ayudante en vivo — trabajando…' + elapsed
        : '✅ Agente terminado' + elapsed;
    }

    agentLiveSteps.innerHTML = steps.map(function(s) {
      return '<div class="agent-panel-step">' + escapeHtml(String(s)) + '</div>';
    }).join('');

    if (agentLiveCode) {
      if (code) {
        agentLiveCode.style.display = 'block';
        agentLiveCode.textContent = code;
        agentLiveCode.scrollTop = agentLiveCode.scrollHeight;
      } else {
        agentLiveCode.style.display = 'none';
      }
    }

    if (agentLiveSummary) {
      if (summary) {
        agentLiveSummary.style.display = 'block';
        agentLiveSummary.innerHTML = renderMarkdown(summary);
      } else {
        agentLiveSummary.style.display = 'none';
      }
    }

    agentLivePanel.scrollTop = agentLivePanel.scrollHeight;
  }

  if (!messagesEl || !promptEl) {
    console.error('Local Copilot: no se encontraron elementos del chat (messages/prompt).');
  }
  let mode = 'chat';
  let currentAiEl = null;
  let streamRaw = '';
  let agentLiveActive = false;
  let agentStreamPre = null;
  let agentStreamMirror = null;
  let codeStreamEl = null;
  let codeStreamRaw = '';

  function ensureAgentLiveShell(bubble) {
    const msgEl = bubble.closest('.message');
    if (msgEl) msgEl.classList.add('agent-live');
    let log = bubble.querySelector('.agent-progress-log');
    if (!log) {
      log = document.createElement('div');
      log.className = 'agent-progress-log';
      bubble.appendChild(log);
    }
    let wrap = bubble.querySelector('.agent-stream-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'agent-stream-wrap';
      const label = document.createElement('div');
      label.className = 'agent-stream-label';
      label.textContent = '✍️ Código en vivo (Ollama):';
      agentStreamPre = document.createElement('pre');
      agentStreamPre.className = 'agent-stream-pre';
      wrap.appendChild(label);
      wrap.appendChild(agentStreamPre);
      bubble.appendChild(wrap);
    } else if (!agentStreamPre) {
      agentStreamPre = wrap.querySelector('.agent-stream-pre');
    }
    return { log, pre: agentStreamPre };
  }

  function appendAgentProgress(bubble, text) {
    const shell = ensureAgentLiveShell(bubble);
    const step = document.createElement('div');
    step.className = 'agent-step';
    step.textContent = text;
    shell.log.appendChild(step);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function openAgentStreamPanel(bubble) {
    const shell = ensureAgentLiveShell(bubble);
    if (!agentStreamMirror) {
      agentStreamMirror = document.createElement('div');
      agentStreamMirror.className = 'agent-stream-mirror';
      agentStreamMirror.textContent = '▋';
      shell.log.appendChild(agentStreamMirror);
    }
    if (shell.pre && !shell.pre.textContent) {
      shell.pre.textContent = '▋';
    }
    const wrap = bubble.querySelector('.agent-stream-wrap');
    if (wrap) wrap.classList.add('active');
    if (agentStreamMirror) {
      agentStreamMirror.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function startCodeStreamBubble() {
    if (codeStreamEl) return codeStreamEl;
    codeStreamEl = addMessage('ai', '');
    codeStreamRaw = '### ✍️ Ollama escribiendo en vivo\\n\\n';
    setBubbleMarkdown(codeStreamEl, codeStreamRaw);
    const msgEl = codeStreamEl.closest('.message');
    if (msgEl) msgEl.classList.add('code-stream-live');
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return codeStreamEl;
  }

  function appendCodeStreamToken(text) {
    if (!text) return;
    if (agentLivePanel && agentLivePanel.classList.contains('visible')) return;
    startCodeStreamBubble();
    codeStreamRaw += text;
    setBubbleMarkdown(codeStreamEl, codeStreamRaw);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendAgentToken(bubble, text) {
    if (!text) return;
    const shell = ensureAgentLiveShell(bubble);
    if (!agentStreamMirror) {
      agentStreamMirror = document.createElement('div');
      agentStreamMirror.className = 'agent-stream-mirror';
      shell.log.appendChild(agentStreamMirror);
    }
    agentStreamMirror.textContent += text;
    if (shell.pre) {
      if (shell.pre.textContent === '▋') {
        shell.pre.textContent = text;
      } else {
        shell.pre.textContent += text;
      }
    }
    const wrap = bubble.querySelector('.agent-stream-wrap');
    if (wrap) wrap.classList.add('active');
    streamRaw += text;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (shell.pre) {
      shell.pre.scrollTop = shell.pre.scrollHeight;
    }
  }

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
        ? '🤖 Agente: recuadro morado ENCIMA del input + archivos en disco (puede tardar horas)'
        : m === 'teacher'
          ? '🎓 Profesor: enseña y corrige errores del editor (di "esto falla, corrígelo")'
          : '💬 Chat: responde preguntas sin modificar archivos';
    }

    const prompt = document.getElementById('prompt');
    if (prompt) {
      prompt.placeholder = m === 'agent'
        ? 'Ej: créame commands/shop.js — verás el código escribirse en vivo aquí…'
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
    if (action === 'create') {
      startSending();
      addMessage('user', '🚀 Crear proyecto (web, Discord, WhatsApp…)');
      addTypingIndicator();
      vscode.postMessage({ type: 'createProject' });
      return;
    }
    const labels = {
      explain: '📚 Explicar código del editor',
      generate: '✨ Generar código',
      fix: '🔧 Arreglar errores del código',
      refactor: '⚡ Refactorizar archivo abierto',
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
      vscode.postMessage({ type: 'clearChat' });
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
    agentLiveActive = false;
    agentStreamPre = null;
    agentStreamMirror = null;
    codeStreamEl = null;
    codeStreamRaw = '';
    currentAiEl = null;
    streamRaw = '';
    const btn = document.getElementById('send-btn');
    if (btn) {
      btn.textContent = '➤';
      btn.title = 'Enviar (Enter)';
    }
  }

  const CHAT_WATCHDOG_MS = 600000;
  const AGENT_WATCHDOG_MS = 4 * 60 * 60 * 1000;

  function touchSendingWatchdog() {
    if (!isSending) return;
    if (sendingWatchdog) clearTimeout(sendingWatchdog);
    const ms = mode === 'agent' ? AGENT_WATCHDOG_MS : CHAT_WATCHDOG_MS;
    sendingWatchdog = setTimeout(() => {
      if (!isSending) return;
      finishSending();
      const msg = mode === 'agent'
        ? 'Tiempo de espera agotado. Comprueba Ollama (ollama serve) o reinicia VS Code.'
        : 'Tiempo de espera agotado. Comprueba que Ollama esté en marcha (ollama serve).';
      addMessage('ai', msg);
    }, ms);
  }

  function startSending() {
    isSending = true;
    const btn = document.getElementById('send-btn');
    if (btn) {
      btn.textContent = '⏹';
      btn.title = 'Detener generación';
    }
    touchSendingWatchdog();
  }

  function clearChatUi() {
    removeTypingIndicator();
    if (messagesEl) {
      messagesEl.querySelectorAll('.message').forEach(function(el) { el.remove(); });
      if (welcomeEl) {
        welcomeEl.style.display = 'block';
      }
    }
    if (agentLivePanel) agentLivePanel.classList.remove('visible');
    if (agentLiveSteps) agentLiveSteps.innerHTML = '';
    if (agentLiveCode) { agentLiveCode.textContent = ''; agentLiveCode.style.display = 'none'; }
    if (agentLiveSummary) { agentLiveSummary.innerHTML = ''; agentLiveSummary.style.display = 'none'; }
    if (agentPanelTitle) agentPanelTitle.textContent = '😈 Ayudante en vivo';
    if (promptEl) {
      promptEl.value = '';
      promptEl.style.height = 'auto';
    }
    finishSending();
  }

  function getActiveMode() {
    const activeTab = document.querySelector('.mode-tab.active');
    const m = activeTab?.getAttribute('data-mode');
    if (m === 'agent' || m === 'teacher' || m === 'chat') {
      mode = m;
    }
    return mode;
  }

  function submitPrompt() {
    if (!promptEl || !messagesEl) return;
    if (isSending) return;
    const text = promptEl.value.trim();
    if (!text) return;
    const sendMode = getActiveMode();
    startSending();

    addMessage('user', text);
    promptEl.value = '';
    promptEl.style.height = 'auto';
    addTypingIndicator();

    if (sendMode === 'agent' && agentLivePanel) {
      agentLivePanel.classList.add('visible');
    }

    vscode.postMessage({
      type: 'send',
      text,
      mode: sendMode,
      includeEditor: sendMode === 'chat' && wantsEditorContext(text),
    });
  }

  function stopGeneration() {
    if (!isSending) return;
    vscode.postMessage({ type: 'cancel' });
    finishSending();
    if (agentPanelTitle) {
      agentPanelTitle.textContent = '⏹ Agente detenido por el usuario';
    }
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
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      if (isSending) stopGeneration();
      else submitPrompt();
    });
  }
  if (promptEl) {
    promptEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (isSending) return;
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
          if (isSending) finishSending();
          const fullText = String(msg.text);
          const sendNow = () => {
            promptEl.classList.remove('typing-active');
            promptEl.value = fullText;
            promptEl.style.height = 'auto';
            promptEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            submitPrompt();
          };
          if (msg.typing && fullText.length > 0) {
            promptEl.value = '';
            promptEl.classList.add('typing-active');
            promptEl.focus();
            promptEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            if (welcomeEl) welcomeEl.style.display = 'none';
            let i = 0;
            const charMs = Math.max(8, msg.typingMs || 22);
            const typeTick = () => {
              if (i < fullText.length) {
                promptEl.value += fullText.charAt(i);
                i += 1;
                promptEl.style.height = 'auto';
                promptEl.scrollTop = promptEl.scrollHeight;
                messagesEl.scrollTop = messagesEl.scrollHeight;
                setTimeout(typeTick, charMs);
              } else {
                setTimeout(sendNow, 350);
              }
            };
            typeTick();
          } else {
            sendNow();
          }
        }
        break;

      case 'setMode':
        if (msg.mode) setMode(msg.mode);
        break;

      case 'chatInject': {
        if (!msg.text) break;
        const role = msg.role === 'user' ? 'user' : 'ai';
        const bubble = addMessage(role, msg.text);
        const msgEl = bubble?.closest('.message');
        if (msgEl) {
          if (msg.style === 'fail') msgEl.classList.add('test-fail');
          else if (msg.style === 'ok') msgEl.classList.add('test-ok');
          else msgEl.classList.add('test-info');
        }
        break;
      }

      case 'agentTestStart': {
        const banner = document.getElementById('agent-test-banner');
        const title = document.getElementById('agent-test-title');
        const lines = document.getElementById('agent-test-lines');
        if (banner) banner.classList.add('visible');
        if (title && msg.total) {
          title.textContent = '🧪 Test agente en vivo — ' + msg.total + ' escenarios';
        }
        if (lines) lines.innerHTML = '';
        setMode('agent');
        if (agentLivePanel) agentLivePanel.classList.add('visible');
        break;
      }

      case 'agentTestLine': {
        const linesEl = document.getElementById('agent-test-lines');
        const bannerEl = document.getElementById('agent-test-banner');
        if (bannerEl) bannerEl.classList.add('visible');
        if (linesEl && msg.line) {
          const row = document.createElement('div');
          row.className = 'agent-test-line ' + (msg.kind || 'info');
          row.textContent = msg.line;
          linesEl.appendChild(row);
          linesEl.scrollTop = linesEl.scrollHeight;
        }
        break;
      }

      case 'agentTestEnd': {
        const bannerEnd = document.getElementById('agent-test-banner');
        if (bannerEnd) bannerEnd.classList.remove('visible');
        break;
      }

      case 'initState':
        if (msg.provider && providerEl) providerEl.value = msg.provider;
        if (internetEl) internetEl.value = String(!!msg.useInternet);
        syncInternetControlVisibility(msg.provider || 'auto');
        updateModelRow(msg.provider || 'auto', true);
        if (msg.version) {
          const sub = document.getElementById('app-subtitle');
          if (sub) sub.textContent = 'Ayudante de programación · v' + msg.version;
        }
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
        touchSendingWatchdog();
        if (msg.text) {
          if (!currentAiEl) {
            currentAiEl = addMessage('ai', '');
            if (msg.agentLive) {
              agentLiveActive = true;
              const hint = document.createElement('div');
              hint.className = 'agent-progress-log';
              hint.innerHTML = '<div class="agent-step">⏳ Agente en marcha…</div>';
              currentAiEl.appendChild(hint);
              const msgEl = currentAiEl.closest('.message');
              if (msgEl) msgEl.classList.add('agent-live');
            }
          }
          if (currentAiEl && (msg.agentLive || agentLiveActive)) {
            appendAgentProgress(currentAiEl, msg.text);
          } else if (currentAiEl) {
            streamRaw += (streamRaw ? '\\n\\n' : '') + msg.text;
            setBubbleMarkdown(currentAiEl, streamRaw);
          } else {
            addMessage('progress', msg.text);
          }
        }
        if (!agentLiveActive && (!streamRaw || streamRaw.length < 20)) {
          addTypingIndicator();
        }
        break;
        
      case 'responseStart':
        removeTypingIndicator();
        streamRaw = '';
        agentLiveActive = !!msg.agentLive;
        agentStreamPre = null;
        agentStreamMirror = null;
        codeStreamEl = null;
        codeStreamRaw = '';
        if (msg.resumeSending) {
          startSending();
        }
        currentAiEl = addMessage('ai', '');
        if (agentLiveActive && currentAiEl) {
          const hint = document.createElement('div');
          hint.className = 'agent-progress-log';
          hint.innerHTML = '<div class="agent-step">⏳ Agente iniciado — espera unos segundos…</div>';
          currentAiEl.appendChild(hint);
          const msgEl = currentAiEl.closest('.message');
          if (msgEl) msgEl.classList.add('agent-live');
        }
        if (msg.resumeSending && agentLivePanel) {
          agentLivePanel.classList.add('visible');
        }
        break;
        
      case 'agentSync':
        renderAgentPanel(msg);
        touchSendingWatchdog();
        break;

      case 'agentPulse':
        touchSendingWatchdog();
        if (agentPanelTitle && msg.elapsedMin != null) {
          agentPanelTitle.textContent =
            '😈 Ayudante en vivo · ' + msg.elapsedMin + ' min';
        }
        break;

      case 'agentDone':
        finishSending();
        break;

      case 'codeStreamStart':
        if (agentLivePanel) agentLivePanel.classList.add('visible');
        else startCodeStreamBubble();
        break;

      case 'agentStreamOpen':
        startCodeStreamBubble();
        if (currentAiEl) openAgentStreamPanel(currentAiEl);
        break;

      case 'token':
        removeTypingIndicator();
        touchSendingWatchdog();
        if (!msg.text) break;
        if (msg.codeStream) {
          appendCodeStreamToken(msg.text);
          break;
        }
        if (!currentAiEl) {
          currentAiEl = addMessage('ai', '');
          agentLiveActive = !!msg.agentLive;
        }
        if (currentAiEl && (msg.agentLive || agentLiveActive)) {
          appendAgentToken(currentAiEl, msg.text);
        } else if (currentAiEl) {
          streamRaw += msg.text;
          setBubbleMarkdown(currentAiEl, streamRaw);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        break;
        
      case 'responseEnd':
        removeTypingIndicator();
        if (!agentLiveActive) {
          finishSending();
        }
        break;
        
      case 'response': {
        const bubble = currentAiEl;
        if (msg.append && bubble && (msg.agentLive || agentLiveActive)) {
          const summary = document.createElement('div');
          summary.className = 'agent-summary';
          summary.innerHTML = renderMarkdown(msg.text || '');
          bubble.appendChild(summary);
          const msgEl = bubble.closest('.message');
          if (msgEl) msgEl.classList.remove('agent-live');
          finishSending();
        } else if (msg.text) {
          if (bubble) {
            streamRaw = msg.text;
            setBubbleMarkdown(bubble, streamRaw);
          } else {
            addMessage('ai', msg.text);
          }
          finishSending();
        } else {
          finishSending();
        }
        break;
      }
        
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
