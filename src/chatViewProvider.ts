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
        await vscode.workspace.getConfiguration('local').update(
          'useInternet',
          message.useInternet,
          vscode.ConfigurationTarget.Global
        );
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
<style>
  body {
    font-family: var(--vscode-font-family);
    background: var(--vscode-sideBar-background);
    color: var(--vscode-foreground);
    padding: 0; margin: 0;
    display: flex; flex-direction: column; height: 100vh;
  }
  #status-bar {
    padding: 8px 12px; font-size: 11px;
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex; align-items: center; gap: 6px;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #888; }
  .dot.ok   { background: #3fb950; }
  .dot.fail { background: #f85149; }
  #provider-select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 11px;
  }
  #internet-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    margin-left: auto;
  }
  #internet-toggle select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 11px;
  }

  #mode-bar {
    display: flex; gap: 4px; padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .mode-btn {
    flex: 1; font-size: 11px; padding: 5px 8px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-foreground);
    border-radius: 4px; cursor: pointer;
  }
  .mode-btn.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: var(--vscode-focusBorder);
  }

  #messages {
    flex: 1; overflow-y: auto; padding: 10px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .msg {
    padding: 8px 10px; border-radius: 6px;
    font-size: 12.5px; line-height: 1.5; white-space: pre-wrap;
  }
  .msg.user     { background: var(--vscode-button-secondaryBackground); align-self: flex-end;  max-width: 88%; }
  .msg.ai       { background: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; max-width: 92%; }
  .msg.progress { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 11.5px; }

  #input-area {
    border-top: 1px solid var(--vscode-panel-border);
    padding: 8px; display: flex; flex-direction: column; gap: 6px;
  }
  #prompt {
    width: 100%; box-sizing: border-box;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px; padding: 8px;
    font-family: var(--vscode-editor-font-family);
    font-size: 12.5px; resize: none;
    min-height: 40px; max-height: 120px;
  }
  #send {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 4px;
    padding: 7px; font-size: 12px; cursor: pointer;
  }
  #send:hover { background: var(--vscode-button-hoverBackground); }
  #hint { font-size: 10.5px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div id="status-bar">
    <span class="dot" id="status-dot"></span>
    <span id="status-text">Comprobando proveedor...</span>
    <div id="internet-toggle">
      <span>Internet:</span>
      <select id="internet-mode">
        <option value="false">No</option>
        <option value="true">Sí</option>
      </select>
    </div>
    <select id="provider-select">
      <option value="ollama">🏠 Ollama (local)</option>
      <option value="groq">🚀 Groq (gratis)</option>
      <option value="cerebras">⚡ Cerebras (gratis)</option>
      <option value="gemini">💎 Gemini (gratis)</option>
      <option value="together">🤝 Together (gratis)</option>
      <option value="cohere">🔷 Cohere (gratis)</option>
      <option value="huggingface">🤗 HuggingFace (gratis)</option>
      <option value="openrouter">🔀 OpenRouter</option>
    </select>
  </div>
  <div id="mode-bar">
    <button class="mode-btn active" id="mode-chat"  onclick="setMode('chat')">💬 Chat</button>
    <button class="mode-btn"        id="mode-agent" onclick="setMode('agent')">⚙️ Agente (modifica archivos)</button>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <div id="hint">Modo chat: solo conversación, no toca archivos del proyecto.</div>
    <textarea id="prompt" placeholder="Describe lo que necesitas..."></textarea>
    <button id="send">Enviar ▶</button>
  </div>

<script>
  const vscode      = acquireVsCodeApi();
  const messagesEl  = document.getElementById('messages');
  const promptEl    = document.getElementById('prompt');
  const providerEl  = document.getElementById('provider-select');
  const internetEl  = document.getElementById('internet-mode');
  let   mode        = 'chat';
  let   currentAiEl = null;

  function setMode(m) {
    mode = m;
    document.getElementById('mode-chat').classList.toggle('active',  m === 'chat');
    document.getElementById('mode-agent').classList.toggle('active', m === 'agent');
    document.getElementById('hint').textContent = m === 'agent'
      ? 'Modo agente: analiza tu proyecto y aplica cambios automáticamente (o pide confirmación si la opción está activada).'
      : 'Modo chat: solo conversación, no toca archivos del proyecto.';
  }

  function addMessage(role, text) {
    const div = document.createElement('div');
    div.className   = 'msg ' + role;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function send() {
    const text = promptEl.value.trim();
    if (!text) { return; }
    addMessage('user', text);
    promptEl.value = '';
    vscode.postMessage({ type: 'send', text, mode });
  }

  providerEl.addEventListener('change', () => {
    vscode.postMessage({ type: 'setProvider', provider: providerEl.value });
  });
  internetEl.addEventListener('change', () => {
    vscode.postMessage({ type: 'setInternetMode', useInternet: internetEl.value === 'true' });
  });

  document.getElementById('send').addEventListener('click', send);
  promptEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  window.addEventListener('message', ({ data: msg }) => {
    switch (msg.type) {
      case 'connectionStatus': {
        const dot = document.getElementById('status-dot');
        const txt = document.getElementById('status-text');
        const provider = msg.provider || 'ollama';
        const useInternet = msg.useInternet === true;
        providerEl.value = provider;
        internetEl.value = String(useInternet);
        dot.className  = 'dot ' + (msg.ok ? 'ok' : 'fail');
        if (msg.ok) {
          const label = provider === 'gemini'
            ? 'Gemini'
            : provider === 'openrouter'
              ? 'OpenRouter'
              : 'Ollama';
          txt.textContent = label + ' conectado (' + (msg.models?.[0] ?? '—') + ')';
        } else {
          txt.textContent = 'Proveedor no disponible';
        }
        break;
      }
      case 'progress':     addMessage('progress', msg.text); break;
      case 'responseStart': currentAiEl = addMessage('ai', ''); break;
      case 'token':
        if (currentAiEl) {
          currentAiEl.textContent += msg.text;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        break;
      case 'responseEnd':  currentAiEl = null; break;
      case 'response':     if (msg.done) { addMessage('ai', msg.text); } break;
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
