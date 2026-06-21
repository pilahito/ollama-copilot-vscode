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

// ── Tipos de mensajes Webview ────────────────────────────────────────────────

type WebviewInMessage =
  | { type: 'send'; text: string; mode: 'chat' | 'agent' }
  | { type: 'checkConnection' }
  | { type: 'setProvider'; provider: string }
  | { type: 'setInternetMode'; useInternet: boolean }
  | { type: 'getOllamaModels' }
  | { type: 'setModel'; model: string }
  | { type: 'openInBrowser' }
  | { type: 'saveAPIKeys'; keys: Record<string, string> };

// ── Constantes ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'Eres Local, ingeniero de software senior. Respondes siempre en español, de forma técnica y directa.';

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

  constructor(
    private readonly extensionUri: vscode.Uri,
    ollama: OllamaClient
  ) {
    this.ollama = ollama;
    this.agent  = new LocalAgent(ollama);
  }

  // ── API de VS Code ────────────────────────────────────────────────────────────

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html    = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (message: WebviewInMessage) => {
      if (message.type === 'send') {
        await this.handleUserMessage(message.text, message.mode);
      } else if (message.type === 'checkConnection') {
        const status = await this.ollama.checkConnection();
        this.post({ type: 'connectionStatus', ...status, currentModel: this.getCurrentModel() });
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
      } else if (message.type === 'getOllamaModels') {
        await this.loadOllamaModels();
      } else if (message.type === 'openInBrowser') {
        await this.ollama.resolveAutoProvider();
        const url = this.ollama.getBrowserChatUrl();
        const browser = this.ollama.getBrowserName();
        vscode.env.openExternal(vscode.Uri.parse(url));
        vscode.window.showInformationMessage(`Abriendo en ${browser}: ${url}`);
      } else if (message.type === 'saveAPIKeys') {
        const config = vscode.workspace.getConfiguration('local');
        const keyMap: Record<string, string> = {
          groq: 'groqApiKey',
          cerebras: 'cerebrasApiKey',
          together: 'togetherApiKey',
          huggingface: 'huggingfaceApiKey',
          gemini: 'geminiApiKey',
          openrouter: 'openRouterApiKey',
        };
        for (const [key, setting] of Object.entries(keyMap)) {
          const value = message.keys[key]?.trim();
          if (value) {
            await config.update(setting, value, vscode.ConfigurationTarget.Global);
          }
        }
        this.ollama.refreshConfig();
        vscode.window.showInformationMessage('✓ Claves API guardadas.');
      } else if (message.type === 'setModel') {
        const config = vscode.workspace.getConfiguration('local');
        await config.update('chatModel', message.model, vscode.ConfigurationTarget.Global);
        await config.update('completionModel', message.model, vscode.ConfigurationTarget.Global);
        this.ollama.refreshConfig();
        vscode.window.showInformationMessage(`✓ Modelo cambiado a: ${message.model}`);
        // Refresh connection status so UI updates
        const status = await this.ollama.checkConnection();
        this.post({ type: 'connectionStatus', ...status, currentModel: this.getCurrentModel() });
      }
    });

    // Comprueba la conexión nada más abrir la vista y detecta modelos instalados
    this.ollama.checkConnection().then((status) => {
      const useInternet = this.ollama.isInternetEnabled();
      this.post({
        type: 'connectionStatus',
        ...status,
        internetEnabled: useInternet,
        currentModel: this.getCurrentModel(),
      });
    });

    // Siempre detectar IAs instaladas al cargar (independiente del proveedor)
    void this.loadOllamaModels();
  }

  // ── API pública ───────────────────────────────────────────────────────────────

  /**
   * Permite que comandos externos (clic derecho "explicar/arreglar")
   * empujen texto al chat y abran el panel automáticamente.
   */
  public sendExternalPrompt(text: string, mode: 'chat' | 'agent' = 'chat'): void {
    this.view?.show?.(true);
    this.post({ type: 'prefill', text, mode });
  }

  // ── Lógica de mensajes ────────────────────────────────────────────────────────

  private async handleUserMessage(text: string, mode: 'chat' | 'agent'): Promise<void> {
    if (mode === 'agent') {
      await this.handleAgentMode(text);
      return;
    }
    await this.handleChatMode(text);
  }

  /**
   * Modo agente: analiza el proyecto y aplica cambios directamente en disco.
   * El agente informa del progreso mediante callbacks en tiempo real.
   */
  private async handleAgentMode(text: string): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration('local');
      const agentModel = config.get<string>('chatModel') || config.get<string>('completionModel');
      const result = await this.agent.handleRequest(text, (progress) => {
        this.post({ type: 'progress', text: progress });
      }, agentModel);

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

      if (result.actions.length === 0 && result.commands.length === 0) {
        const refused = /\b(no puedo|derechos de autor|copyright|lo siento)\b/i.test(result.explanation);
        summary += refused
          ? '_El modelo rechazó modificar código (falso positivo de copyright). Reintenta con: "Modifica directamente los archivos del proyecto" o usa un modelo coder más grande (14b)._'
          : '_El agente no generó cambios. Sé más específico: "Modifica src/archivo.ts y arregla X"._';
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
  private async handleChatMode(text: string): Promise<void> {
    const status = await this.ollama.checkConnection();
    if (!status.ok) {
      const providerName = status.provider === 'gemini'
        ? 'Gemini'
        : status.provider === 'openrouter'
          ? 'OpenRouter'
          : 'Ollama';
      this.post({
        type: 'response',
        text: `⚠ No se pudo usar ${providerName}. ${status.message ?? 'Revisa la configuración y vuelve a intentarlo.'}`,
      });
      return;
    }

    this.post({ type: 'responseStart' });
    try {
      const messages = [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        { role: 'user' as const,   content: text }
      ];

      if (this.ollama.isInternetEnabled()) {
        if (this.ollama.getResolvedProvider() === 'ollama') {
          await this.ollama.chatWithWebSearch(
            messages,
            (token) => this.post({ type: 'token', text: token })
          );
        } else {
          this.post({ type: 'token', text: '🔍 Investigando en internet...\n\n' });
          const { context } = await this.ollama.researchWeb(text);
          const enhanced = context
            ? [{ role: 'system' as const, content: SYSTEM_PROMPT }, { role: 'user' as const, content: context + text }]
            : messages;
          await this.ollama.chatStream(
            enhanced,
            (token) => this.post({ type: 'token', text: token })
          );
        }
      } else {
        await this.ollama.chatStream(
          messages,
          (token) => this.post({ type: 'token', text: token })
        );
      }
      this.post({ type: 'responseEnd' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: 'response', text: `⚠ Error de conexión: ${message}`, done: true });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private getCurrentModel(): string {
    const config = vscode.workspace.getConfiguration('local');
    return config.get<string>('chatModel', '') || config.get<string>('completionModel', '');
  }

  private async loadOllamaModels(): Promise<void> {
    const current = this.getCurrentModel();
    const installed = await this.ollama.getInstalledOllamaModels();
    if (installed.length > 0) {
      this.post({ type: 'ollamaModels', models: installed, currentModel: current });
      return;
    }
    const status = await this.ollama.checkConnection();
    this.post({ type: 'ollamaModels', models: status.models || [], currentModel: current });
  }

  private post(msg: Record<string, unknown>): void {
    this.view?.webview.postMessage(msg);
  }

  // ── HTML de la Webview ────────────────────────────────────────────────────────

  private getHtml(): string {
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
    background: linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
  }

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
    gap: 8px;
    padding: 10px 16px;
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
    font-size: 48px;
    margin-bottom: 16px;
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
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, var(--text-muted));
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
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="header-top">
    <div class="logo">🤖</div>
    <div class="title-section">
      <div class="title">Local Copilot</div>
      <div class="subtitle">Tu asistente de código con IA</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <button class="btn-icon" onclick="openInBrowser()" title="Abrir chat en tu navegador predeterminado">🌐</button>
      <button class="btn-icon" onclick="showAPIsModal()" title="Configurar APIs">⚙️</button>
      <div class="status-badge online" id="status-badge">
        <span class="status-dot"></span>
        <span id="status-text">Conectando...</span>
      </div>
    </div>
  </div>
  <div class="controls">
    <div class="control-group">
      <label>🌐</label>
      <select id="internet-mode" onchange="setInternetMode(this.value)" title="Activar o desactivar internet">
        <option value="false">Local</option>
        <option value="true">+Internet</option>
      </select>
    </div>
    <div class="control-group" style="flex:1">
      <label>🤖</label>
      <select id="provider-select" onchange="setProvider(this.value)">
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
  <div class="controls" id="ollama-models-row" style="display:none;">
    <div class="control-group" style="flex:1">
      <label>📦 Modelo:</label>
      <select id="ollama-model-select">
        <option value="">Cargando modelos...</option>
      </select>
    </div>
  </div>
</div>

<!-- MODE TABS -->
<div class="mode-tabs">
  <button class="mode-tab active" id="mode-chat" onclick="setMode('chat')">
    <span class="icon">💬</span>
    <span>Chat</span>
  </button>
  <button class="mode-tab" id="mode-agent" onclick="setMode('agent')">
    <span class="icon">🤖</span>
    <span>Agente</span>
  </button>
</div>

<!-- MESSAGES -->
<div class="messages" id="messages">
  <div class="welcome" id="welcome">
    <div class="welcome-icon">🚀</div>
    <h2>¡Hola! Soy Local Copilot</h2>
    <p>Pregúntame lo que quieras sobre tu código. Puedo explicar, generar, arreglar y mucho más.</p>
    
    <div class="suggestions">
      <div class="suggestion" onclick="useSuggestion('Explica qué hace este código')">
        <span class="suggestion-icon">📚</span>
        <span>Explicar código</span>
      </div>
      <div class="suggestion" onclick="useSuggestion('Genera una función para')">
        <span class="suggestion-icon">✨</span>
        <span>Generar código</span>
      </div>
      <div class="suggestion" onclick="useSuggestion('Arregla este error:')">
        <span class="suggestion-icon">🔧</span>
        <span>Arreglar errores</span>
      </div>
      <div class="suggestion" onclick="useSuggestion('Refactoriza este código para mejorarlo')">
        <span class="suggestion-icon">⚡</span>
        <span>Refactorizar</span>
      </div>
    </div>
    
    <button class="btn-recommend" onclick="showRecommendations()">
      🎯 Ver IAs recomendadas para tu PC
    </button>
  </div>
</div>

<!-- MODAL RECOMENDACIONES -->
<div class="modal-overlay" id="modal-overlay" onclick="closeModal()">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3 id="modal-title">🎯 IAs Recomendadas</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body" id="modal-body">
      <p>Cargando...</p>
    </div>
  </div>
</div>

<!-- MODAL APIs -->
<div class="modal-overlay" id="apis-modal" onclick="closeAPIsModal()">
  <div class="modal" style="max-width:450px;" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>⚙️ Configurar APIs de IA</h3>
      <button class="modal-close" onclick="closeAPIsModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="category-title">🆓 APIs Gratuitas (Recomendadas)</div>
      
      <div class="api-card">
        <div class="api-header">
          <span>⚡ Groq</span>
          <span class="badge-free">GRATIS</span>
        </div>
        <p class="api-desc">Ultra rápido, 14.400 tokens/min gratis</p>
        <input type="password" id="groq-key" placeholder="API Key de Groq" class="api-input">
        <a href="https://console.groq.com/keys" target="_blank" class="api-link">Obtener API Key →</a>
      </div>

      <div class="api-card">
        <div class="api-header">
          <span>🧠 Cerebras</span>
          <span class="badge-free">GRATIS</span>
        </div>
        <p class="api-desc">Muy rápido, plan gratuito con límites</p>
        <input type="password" id="cerebras-key" placeholder="API Key de Cerebras" class="api-input">
        <a href="https://cloud.cerebras.ai/" target="_blank" class="api-link">Obtener API Key →</a>
      </div>

      <div class="api-card">
        <div class="api-header">
          <span>🤝 Together AI</span>
          <span class="badge-free">$5 GRATIS</span>
        </div>
        <p class="api-desc">$5 de crédito gratis al registrarte</p>
        <input type="password" id="together-key" placeholder="API Key de Together" class="api-input">
        <a href="https://api.together.xyz/" target="_blank" class="api-link">Obtener API Key →</a>
      </div>

      <div class="api-card">
        <div class="api-header">
          <span>🤗 HuggingFace</span>
          <span class="badge-free">GRATIS</span>
        </div>
        <p class="api-desc">Miles de modelos gratuitos</p>
        <input type="password" id="huggingface-key" placeholder="Token de HuggingFace" class="api-input">
        <a href="https://huggingface.co/settings/tokens" target="_blank" class="api-link">Obtener Token →</a>
      </div>

      <div class="category-title">💎 APIs de Pago (Mayor calidad)</div>

      <div class="api-card">
        <div class="api-header">
          <span>💎 Google Gemini</span>
          <span class="badge-paid">PAGO</span>
        </div>
        <p class="api-desc">Gemini Pro, Flash - desde $0.0001/1K tokens</p>
        <input type="password" id="gemini-key" placeholder="API Key de Gemini" class="api-input">
        <a href="https://aistudio.google.com/apikey" target="_blank" class="api-link">Obtener API Key →</a>
      </div>

      <div class="api-card">
        <div class="api-header">
          <span>🔀 OpenRouter</span>
          <span class="badge-paid">PAGO</span>
        </div>
        <p class="api-desc">Acceso a GPT-4, Claude, Llama y más</p>
        <input type="password" id="openrouter-key" placeholder="API Key de OpenRouter" class="api-input">
        <a href="https://openrouter.ai/keys" target="_blank" class="api-link">Obtener API Key →</a>
      </div>

      <button class="btn-save" onclick="saveAPIKeys()">💾 Guardar Configuración</button>
    </div>
  </div>
</div>

<!-- INPUT AREA -->
<div class="input-area">
  <div class="input-container">
    <textarea id="prompt" placeholder="Pregunta algo sobre tu código..." rows="1"></textarea>
    <button class="send-btn" id="send">➤</button>
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
    <div class="creator-avatar">👨‍💻</div>
    <span>Creado por</span>
    <span class="creator-name">DavidPilahito7</span>
    <span>•</span>
    <a href="https://github.com/pilahito" class="creator-link" target="_blank">GitHub</a>
    <span class="version-badge">v1.0.5</span>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const welcomeEl = document.getElementById('welcome');
  const promptEl = document.getElementById('prompt');
  const providerEl = document.getElementById('provider-select');
  const internetEl = document.getElementById('internet-mode');
  const autoHintEl = document.getElementById('auto-hint');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const WEB_PROVIDERS = ['groq', 'cerebras', 'together', 'cohere', 'huggingface', 'gemini', 'openrouter'];
  let mode = 'chat';
  let currentAiEl = null;

  function isWebProvider(p) {
    return WEB_PROVIDERS.includes(p);
  }

  function setMode(m) {
    mode = m;
    document.getElementById('mode-chat').classList.toggle('active', m === 'chat');
    document.getElementById('mode-agent').classList.toggle('active', m === 'agent');
    const teacherTab = document.getElementById('mode-teacher');
    if (teacherTab) teacherTab.classList.toggle('active', m === 'teacher');

    document.getElementById('hint').innerHTML = m === 'agent'
      ? '🤖 Agente: analiza y modifica archivos automáticamente'
      : m === 'teacher'
      ? '🎓 Profesor: explica paso a paso'
      : '💬 Chat: responde preguntas sin modificar archivos';

    // Show model selector for Ollama even in agent/teacher mode
    const ollamaRow = document.getElementById('ollama-models-row');
    const provider = document.getElementById('provider-select')?.value;
    if (ollamaRow && (provider === 'ollama' || provider === 'auto')) {
      ollamaRow.style.display = 'flex';
    }
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
    avatar.textContent = role === 'user' ? '👤' : '🤖';
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = text;
    
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
      <div class="avatar">🤖</div>
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

  function useSuggestion(text) {
    promptEl.value = text;
    promptEl.focus();
  }

  let lastInstalledModels = [];

  function showRecommendations() {
    const modal = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    modal.classList.add('show');
    
    // Pedir modelos instalados reales (si Ollama está activo)
    vscode.postMessage({ type: 'getOllamaModels' });
    
    // Detección de hardware más conservadora
    const ram = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 4;
    
    let category, models;
    
    // Recomendaciones mucho más realistas y "decentes" para PCs normales
    if (ram <= 6) {
      category = '🟢 PC Básico / Portátil (' + ram + 'GB RAM)';
      models = [
        { name: 'qwen2.5-coder:1.5b', size: '1.1GB', ram: '~3GB', speed: '⚡⚡⚡⚡⚡', recommended: true },
        { name: 'phi3:mini', size: '2.2GB', ram: '~4GB', speed: '⚡⚡⚡⚡', recommended: true },
        { name: 'gemma2:2b', size: '1.6GB', ram: '~4GB', speed: '⚡⚡⚡⚡', recommended: false },
      ];
    } else if (ram <= 12) {
      category = '🟡 PC Normal (' + ram + 'GB RAM)';
      models = [
        { name: 'qwen2.5-coder:3b', size: '2.0GB', ram: '~5-6GB', speed: '⚡⚡⚡⚡', recommended: true },
        { name: 'llama3.2:3b', size: '2.0GB', ram: '~6GB', speed: '⚡⚡⚡⚡', recommended: true },
        { name: 'deepseek-coder:6.7b', size: '3.8GB', ram: '~8GB', speed: '⚡⚡⚡', recommended: false },
        { name: 'qwen2.5-coder:7b', size: '4.7GB', ram: '~9-10GB', speed: '⚡⚡⚡', recommended: false },
      ];
    } else if (ram <= 20) {
      category = '🟠 PC Buena (' + ram + 'GB RAM)';
      models = [
        { name: 'qwen2.5-coder:7b', size: '4.7GB', ram: '~9-10GB', speed: '⚡⚡⚡', recommended: true },
        { name: 'llama3.1:8b', size: '4.7GB', ram: '~10GB', speed: '⚡⚡⚡', recommended: true },
        { name: 'deepseek-coder:6.7b', size: '3.8GB', ram: '~8GB', speed: '⚡⚡⚡', recommended: false },
        { name: 'codellama:13b', size: '7.4GB', ram: '~14-16GB', speed: '⚡⚡', recommended: false },
      ];
    } else {
      category = '🔵 PC Potente (' + ram + 'GB RAM)';
      models = [
        { name: 'qwen2.5-coder:14b', size: '9GB', ram: '~16-18GB', speed: '⚡⚡', recommended: true },
        { name: 'llama3.1:8b', size: '4.7GB', ram: '~10GB', speed: '⚡⚡⚡', recommended: true },
        { name: 'qwen2.5-coder:7b', size: '4.7GB', ram: '~10GB', speed: '⚡⚡⚡', recommended: false },
      ];
    }
    
    let html = '<div style="margin-bottom:12px;padding:12px;background:rgba(139,92,246,0.1);border-radius:8px;">';
    html += '<strong>' + category + '</strong><br>';
    html += '<small style="color:var(--vscode-descriptionForeground);">' + ram + 'GB RAM detectados • ' + cores + ' núcleos</small>';
    html += '</div>';
    
    html += '<h4 class="category-title">Modelos recomendados:</h4>';
    
    models.forEach(m => {
      html += '<div class="model-card' + (m.recommended ? ' recommended' : '') + '">';
      html += '<h4>' + m.name + (m.recommended ? '<span class="badge">RECOMENDADO</span>' : '') + '</h4>';
      html += '<div class="specs">';
      html += '<span>📦 ' + m.size + '</span>';
      html += '<span>🧠 ' + m.ram + '</span>';
      html += '<span>⚡ ' + m.speed + '</span>';
      html += '</div>';
      html += '<code>ollama pull ' + m.name + '</code>';
      html += '</div>';
    });

    // Mostrar modelos instalados reales si los tenemos (detectados de ollama list)
    if (lastInstalledModels && lastInstalledModels.length > 0) {
      html += '<h4 class="category-title" style="margin-top:12px;">✅ Tus IAs instaladas (detectadas con ollama list):</h4>';
      lastInstalledModels.forEach(name => {
        html += '<div class="model-card"><code>' + name + '</code> <small>(instalado)</small></div>';
      });
    }
    
    html += '<div style="margin-top:16px;padding:12px;background:rgba(59,130,246,0.1);border-radius:8px;">';
    html += '<strong>💡 Consejos:</strong><br>';
    html += '<small>• Cierra apps pesadas antes de usar la IA<br>';
    html += '• Usa modelos pequeños (3b-7b) si tu PC es normal<br>';
    html += '• GPU NVIDIA acelera mucho la generación</small>';
    html += '</div>';
    
    body.innerHTML = html;
  }

  function updateRecommendationsWithInstalled(installedModels) {
    const body = document.getElementById('modal-body');
    if (!body || !installedModels || installedModels.length === 0) return;

    // Si ya hay contenido de recomendaciones, agregar sección de instalados arriba
    let installedHTML = '<div style="margin-bottom:16px;padding:12px;background:rgba(16,185,129,0.1);border-radius:8px;">';
    installedHTML += '<strong>✅ Tus IAs instaladas actualmente:</strong><br>';
    installedHTML += '<small>Puedes usar estas directamente sin descargar nada.</small>';
    installedHTML += '<div style="margin-top:8px;">';
    installedModels.forEach(function(m) {
      installedHTML += '<code style="margin-right:6px;display:inline-block;padding:2px 6px;background:#052e16;border-radius:4px;">' + m + '</code>';
    });
    installedHTML += '</div></div>';
    
    // Insertar al principio del modal
    body.innerHTML = installedHTML + body.innerHTML;
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

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL APIs
  // ══════════════════════════════════════════════════════════════════════════
  function showAPIsModal() {
    document.getElementById('apis-modal').classList.add('show');
  }

  function closeAPIsModal() {
    document.getElementById('apis-modal').classList.remove('show');
  }

  function saveAPIKeys() {
    const keys = {
      groq: document.getElementById('groq-key')?.value || '',
      cerebras: document.getElementById('cerebras-key')?.value || '',
      together: document.getElementById('together-key')?.value || '',
      huggingface: document.getElementById('huggingface-key')?.value || '',
      gemini: document.getElementById('gemini-key')?.value || '',
      openrouter: document.getElementById('openrouter-key')?.value || ''
    };
    vscode.postMessage({ type: 'saveAPIKeys', keys });
    closeAPIsModal();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CARGAR MODELOS OLLAMA
  // ══════════════════════════════════════════════════════════════════════════
  function setProvider(provider) {
    vscode.postMessage({ type: 'setProvider', provider });
    updateModelRow(provider);
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
        autoHintEl.textContent = '🌐 +Internet: Ollama local con búsqueda web para responder mejor.';
      } else {
        autoHintEl.textContent = '🏠 Solo local: Ollama en tu PC sin búsqueda web.';
      }
    }
    updateModelRow(provider);
  }

  function updateModelRow(provider) {
    const ollamaRow = document.getElementById('ollama-models-row');
    if (!ollamaRow) return;
    if (provider === 'auto' || provider === 'ollama') {
      ollamaRow.style.display = 'flex';
      vscode.postMessage({ type: 'getOllamaModels' });
    } else {
      ollamaRow.style.display = 'flex';
    }
  }

  function send() {
    const text = promptEl.value.trim();
    if (!text) return;
    
    addMessage('user', text);
    promptEl.value = '';
    promptEl.style.height = 'auto';
    addTypingIndicator();
    
    vscode.postMessage({ type: 'send', text, mode });
  }

  // Auto-resize textarea
  promptEl.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  providerEl.addEventListener('change', () => {
    vscode.postMessage({ type: 'setProvider', provider: providerEl.value });
    updateModelRow(providerEl.value);
  });

  internetEl.addEventListener('change', () => {
    setInternetMode(internetEl.value);
  });

  document.getElementById('send').addEventListener('click', send);
  promptEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  window.addEventListener('message', ({ data: msg }) => {
    switch (msg.type) {
      case 'connectionStatus': {
        const provider = msg.provider === 'duckduckgo' ? 'auto' : (msg.provider || 'auto');
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
            autoHintEl.textContent = '🌐 Ollama local + búsqueda web activa.';
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

        updateModelRow(provider);

        if (isWebProvider(effective)) {
          const current = msg.currentModel || '';
          const select = document.getElementById('ollama-model-select');
          if (select) {
            select.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = current;
            opt.textContent = current || ('Modelo ' + effective);
            opt.selected = true;
            select.appendChild(opt);
          }
        }
        break;
      }
      
      case 'progress':
        removeTypingIndicator();
        addMessage('progress', msg.text);
        addTypingIndicator();
        break;
        
      case 'responseStart':
        removeTypingIndicator();
        currentAiEl = addMessage('ai', '');
        break;
        
      case 'token':
        if (currentAiEl) {
          currentAiEl.textContent += msg.text;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        break;
        
      case 'responseEnd':
        currentAiEl = null;
        break;
        
      case 'response':
        removeTypingIndicator();
        if (msg.done) addMessage('ai', msg.text);
        break;
        
      case 'prefill':
        setMode(msg.mode ?? 'chat');
        promptEl.value = msg.text;
        promptEl.focus();
        send();
        break;

      case 'ollamaModels':
        lastInstalledModels = msg.models || [];
        
        const select = document.getElementById('ollama-model-select');
        if (select) {
          select.innerHTML = '';
          if (msg.models && msg.models.length > 0) {
            let foundCurrent = false;
            msg.models.forEach(m => {
              const opt = document.createElement('option');
              opt.value = m;
              opt.textContent = m;
              if (msg.currentModel && m === msg.currentModel) {
                opt.selected = true;
                foundCurrent = true;
              }
              select.appendChild(opt);
            });
            if (!foundCurrent && msg.currentModel) {
              const opt = document.createElement('option');
              opt.value = msg.currentModel;
              opt.textContent = msg.currentModel + ' (actual)';
              opt.selected = true;
              select.insertBefore(opt, select.firstChild);
            }
          } else {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No hay modelos detectados';
            select.appendChild(opt);
          }
        }

        // Si el modal de recomendaciones está abierto, actualízalo con los modelos reales instalados
        const modal = document.getElementById('modal-overlay');
        if (modal && modal.classList.contains('show') && lastInstalledModels.length > 0) {
          updateRecommendationsWithInstalled(lastInstalledModels);
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
</script>
</body>
</html>`;
  }
}
