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
import { OllamaClient } from './ollamaClient';
import { LocalAgent, FileAction } from './agent';

// ── Tipos de mensajes Webview ────────────────────────────────────────────────

type WebviewInMessage =
  | { type: 'send'; text: string; mode: 'chat' | 'agent' }
  | { type: 'checkConnection' }
  | { type: 'setProvider'; provider: string }
  | { type: 'setInternetMode'; useInternet: boolean };

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
        this.post({ type: 'connectionStatus', ...status });
      } else if (message.type === 'setProvider') {
        await vscode.workspace.getConfiguration('local').update(
          'provider',
          message.provider,
          vscode.ConfigurationTarget.Global
        );
        this.ollama.refreshConfig();
        const status = await this.ollama.checkConnection();
        this.post({ type: 'connectionStatus', ...status });
      } else if (message.type === 'setInternetMode') {
        const config = vscode.workspace.getConfiguration('local');
        await config.update('useInternet', message.useInternet, vscode.ConfigurationTarget.Global);
        
        // Si activa internet y el proveedor es ollama, cambiar a DuckDuckGo (GRATIS sin API key)
        if (message.useInternet && config.get('provider') === 'ollama') {
          await config.update('provider', 'duckduckgo', vscode.ConfigurationTarget.Global);
        }
        // Si desactiva internet, volver a ollama
        if (!message.useInternet) {
          await config.update('provider', 'ollama', vscode.ConfigurationTarget.Global);
        }
        
        this.ollama.refreshConfig();
        const status = await this.ollama.checkConnection();
        this.post({ type: 'connectionStatus', ...status });
      }
    });

    // Comprueba la conexión nada más abrir la vista.
    this.ollama.checkConnection().then((status) => {
      this.post({ type: 'connectionStatus', ...status });
    });
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
      const result = await this.agent.handleRequest(text, (progress) => {
        this.post({ type: 'progress', text: progress });
      });

      let summary = `${result.explanation}\n\n`;

      if (result.actions.length > 0) {
        summary += '**Archivos modificados:**\n';
        for (const action of result.actions as FileAction[]) {
          const icon = action.type === 'create' ? '🆕'
                     : action.type === 'delete' ? '🗑️'
                     : '✏️';
          summary += `${icon} \`${action.filePath}\` — ${action.reason}\n`;
        }
      } else {
        summary += '_No fue necesario modificar archivos._';
      }

      this.post({ type: 'response', text: summary, done: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: 'response', text: `⚠ Error: ${message}`, done: true });
    }
  }

  /**
   * Modo chat: streaming directo con Ollama, sin tocar archivos del proyecto.
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
      await this.ollama.chatStream(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: text }
        ],
        (token) => this.post({ type: 'token', text: token })
      );
      this.post({ type: 'responseEnd' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: 'response', text: `⚠ Error de conexión: ${message}`, done: true });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

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
    <div class="status-badge online" id="status-badge">
      <span class="status-dot"></span>
      <span id="status-text">Conectando...</span>
    </div>
  </div>
  <div class="controls">
    <div class="control-group">
      <label>🌐</label>
      <select id="internet-mode">
        <option value="false">Local</option>
        <option value="true">Internet</option>
      </select>
    </div>
    <div class="control-group" style="flex:1">
      <label>🤖</label>
      <select id="provider-select">
        <option value="ollama">🏠 Ollama (local)</option>
        <option value="duckduckgo">🦆 DuckDuckGo (gratis!)</option>
        <option value="groq">⚡ Groq</option>
        <option value="cerebras">⚡ Cerebras</option>
        <option value="gemini">💎 Gemini</option>
        <option value="together">🤝 Together</option>
        <option value="cohere">🔷 Cohere</option>
        <option value="huggingface">🤗 HuggingFace</option>
        <option value="openrouter">🔀 OpenRouter</option>
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
    <span class="version-badge">v1.0.0</span>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const welcomeEl = document.getElementById('welcome');
  const promptEl = document.getElementById('prompt');
  const providerEl = document.getElementById('provider-select');
  const internetEl = document.getElementById('internet-mode');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  let mode = 'chat';
  let currentAiEl = null;

  function setMode(m) {
    mode = m;
    document.getElementById('mode-chat').classList.toggle('active', m === 'chat');
    document.getElementById('mode-agent').classList.toggle('active', m === 'agent');
    document.getElementById('hint').innerHTML = m === 'agent'
      ? '🤖 Agente: analiza y modifica archivos automáticamente'
      : '💬 Chat: responde preguntas sin modificar archivos';
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
  });

  internetEl.addEventListener('change', () => {
    vscode.postMessage({ type: 'setInternetMode', useInternet: internetEl.value === 'true' });
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
        const provider = msg.provider || 'ollama';
        const useInternet = provider !== 'ollama';
        providerEl.value = provider;
        internetEl.value = String(useInternet);
        
        statusBadge.className = 'status-badge ' + (msg.ok ? 'online' : 'offline');
        
        if (msg.ok) {
          const labels = {
            ollama: '🏠 Ollama',
            duckduckgo: '🦆 DuckDuckGo',
            gemini: '💎 Gemini',
            groq: '⚡ Groq',
            cerebras: '⚡ Cerebras',
            together: '🤝 Together',
            cohere: '🔷 Cohere',
            huggingface: '🤗 HuggingFace',
            openrouter: '🔀 OpenRouter'
          };
          statusText.textContent = (labels[provider] || provider) + ' ✓';
        } else {
          statusText.textContent = 'Desconectado';
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
    }
  });
</script>
</body>
</html>`;
  }
}
