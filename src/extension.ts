/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ollama-copilot-vscode — Agente Autónomo Local
 *  (c) 2026 DavidPilahito7 · Licensed under the MIT License.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Author   : DavidPilahito7
 *  Project  : ollama-copilot-vscode
 *  Module   : extension — Punto de entrada y orquestador de la extensión
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
import { OllamaClient }                    from './ollamaClient';
import { LocalInlineCompletionProvider }  from './inlineCompletionProvider';
import { LocalChatViewProvider }          from './chatViewProvider';
import { GitHubService }                   from './githubService';

// ── Constantes ────────────────────────────────────────────────────────────────

/** Intervalo de redetección de Ollama en segundo plano (ms). */
const POLLING_INTERVAL_MS = 30_000;

/** Modelo recomendado si el usuario no tiene ninguno descargado. */
const RECOMMENDED_MODEL = 'qwen2.5-coder:7b';

// ── Activación ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const ollama        = new OllamaClient();
  const github        = new GitHubService();
  const statusBarItem = createStatusBar(context);

  // Migrar configuración antigua (duckduckgo ya no aparece en el selector)
  void (async () => {
    const config = vscode.workspace.getConfiguration('local');
    if (config.get<string>('provider') === 'duckduckgo') {
      await config.update('provider', 'auto', vscode.ConfigurationTarget.Global);
      await config.update('useInternet', true, vscode.ConfigurationTarget.Global);
      ollama.refreshConfig();
    }
  })();

  // ── Status bar ──────────────────────────────────────────────────────────────

  async function refreshStatusBar(): Promise<void> {
    const status = await ollama.checkConnection();
    const config = vscode.workspace.getConfiguration('local');
    const currComp = config.get<string>('completionModel', '');
    const currChat = config.get<string>('chatModel', '');

    if (status.ok) {
      const modelList = status.models.length > 0 ? status.models.join(', ') : 'ninguno descargado';
      statusBarItem.text              = `$(check) Local Copilot`;
      statusBarItem.tooltip           = `IA local activa.\nModelos: ${modelList}\n\nAutocompletado: ${currComp || 'no seleccionado'}\nChat: ${currChat || 'no seleccionado'}\n\nClic: ver modelos\nComando: Local: Elegir modelo de IA`;
      statusBarItem.backgroundColor   = undefined;
      statusBarItem.command = 'local.checkConnection';
    } else {
      statusBarItem.text            = `$(warning) Local Copilot`;
      statusBarItem.tooltip         = 'No se detecta Ollama. Ejecuta "ollama serve" en tu terminal.\n\nClic para comprobar.';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      statusBarItem.command = 'local.checkConnection';
    }

    statusBarItem.show();
  }

  // Detecta Ollama al arrancar y repite cada POLLING_INTERVAL_MS por si
  // el usuario lanza Ollama después de abrir VS Code.
  refreshStatusBar();
  const interval = setInterval(refreshStatusBar, POLLING_INTERVAL_MS);

  // Auto: Ollama si hay modelos, si no DuckDuckGo en el navegador del usuario
  ollama.resolveAutoProvider().then(() => {
    return ollama.autoSelectBestModels();
  }).then(() => {
    void refreshStatusBar();
  }).catch(() => {});
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('local')) {
        ollama.refreshConfig();
        void refreshStatusBar();
      }
    })
  );

  // ── Vista de chat lateral ───────────────────────────────────────────────────

  const chatProvider = new LocalChatViewProvider(context.extensionUri, ollama);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LocalChatViewProvider.viewType, chatProvider)
  );

  // ── Autocompletado inline tipo Copilot ──────────────────────────────────────

  const inlineProvider = new LocalInlineCompletionProvider(ollama);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider)
  );

  // ── Comandos ────────────────────────────────────────────────────────────────

  context.subscriptions.push(

    // Abre el panel de chat en la barra lateral.
    vscode.commands.registerCommand('local.openChat', () => {
      vscode.commands.executeCommand('workbench.view.extension.localcopilot');
    }),

    // Comprueba la conexión manualmente y muestra una notificación con el resultado.
    vscode.commands.registerCommand('local.checkConnection', async () => {
      await refreshStatusBar();
      const status = await ollama.checkConnection();

      if (status.ok) {
        const modelList = status.models.join(', ')
          || `ninguno — descarga uno con "ollama pull ${RECOMMENDED_MODEL}"`;
        const pick = await vscode.window.showInformationMessage(
          `✓ Local: Ollama conectado. Modelos: ${modelList}`,
          'Elegir modelo para programar'
        );
        if (pick === 'Elegir modelo para programar') {
          await vscode.commands.executeCommand('local.selectModel');
        }
      } else {
        const msg = await vscode.window.showWarningMessage(
          '⚠ Local: no se detecta Ollama en localhost:11434. Instálalo y ejecuta "ollama serve".',
          'Abrir terminal'
        );
        if (msg === 'Abrir terminal') {
          vscode.commands.executeCommand('workbench.action.terminal.new');
        }
      }
    }),

    // Activa/desactiva el autocompletado inline desde la paleta de comandos.
    vscode.commands.registerCommand('local.toggleInlineSuggestions', async () => {
      const config  = vscode.workspace.getConfiguration('local');
      const current = config.get('inlineSuggestionsEnabled', true);
      await config.update('inlineSuggestionsEnabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `Local: autocompletado inline ${!current ? 'activado' : 'desactivado'}.`
      );
    }),

    // Explica el código seleccionado en el chat lateral.
    vscode.commands.registerCommand('local.explainCode', async () => {
      const code = getSelectedCode();
      if (!code) { return; }

      vscode.commands.executeCommand('workbench.view.extension.localcopilot');
      chatProvider.sendExternalPrompt(
        `Explica en español qué hace este código:\n\n${code}`,
        'chat'
      );
    }),

    // Envía el código seleccionado al agente para que lo corrija directamente.
    vscode.commands.registerCommand('local.fixError', async () => {
      const editor = vscode.window.activeTextEditor;
      const code   = getSelectedCode();
      if (!code || !editor) { return; }

      const filePath = editor.document.uri.fsPath;
      vscode.commands.executeCommand('workbench.view.extension.localcopilot');
      chatProvider.sendExternalPrompt(
        `Arregla el siguiente código del archivo ${filePath}. Aplica el cambio directamente:\n\n${code}`,
        'agent'
      );
    }),

    // Pide al agente que analice la estructura general del proyecto.
    vscode.commands.registerCommand('local.analyzeProject', () => {
      vscode.commands.executeCommand('workbench.view.extension.localcopilot');
      chatProvider.sendExternalPrompt(
        'Analiza la estructura general de este proyecto y dime qué mejorarías o si detectas algún problema.',
        'agent'
      );
    }),

    // Abre una terminal automática local/SSH para ejecutar comandos.
    vscode.commands.registerCommand('local.openAutoTerminal', async () => {
      const config = vscode.workspace.getConfiguration('local');
      const enabled = config.get<boolean>('enableAutomation', false);
      if (!enabled) {
        vscode.window.showWarningMessage(
          'Activa local.enableAutomation y configura tu SSH para usar la terminal automática.'
        );
        return;
      }

      const sshUser = config.get<string>('sshUser', '');
      const sshHost = config.get<string>('sshHost', '');
      const sshPort = config.get<number>('sshPort', 22);
      const sshCommand = config.get<string>('sshCommand', 'ssh');
      const terminalName = config.get<string>('autoTerminalName', 'Local Auto');

      if (!sshHost) {
        vscode.window.showWarningMessage(
          'Configura local.sshHost para poder abrir una terminal automática.'
        );
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      });

      terminal.show(true);
      const userPart = sshUser ? `${sshUser}@` : '';
      const portPart = sshPort && sshPort !== 22 ? ` -p ${sshPort}` : '';
      terminal.sendText(`${sshCommand} ${userPart}${sshHost}${portPart}`, true);
    }),

    // ── Comandos de GitHub ──────────────────────────────────────────────────────

    // Conectar con GitHub
    vscode.commands.registerCommand('local.githubLogin', async () => {
      await github.login();
    }),

    // Desconectar de GitHub
    vscode.commands.registerCommand('local.githubLogout', async () => {
      await github.logout();
    }),

    // Publicar proyecto en GitHub
    vscode.commands.registerCommand('local.githubPublish', async () => {
      await github.publishProject();
    }),

    // Clonar repositorio de GitHub
    vscode.commands.registerCommand('local.githubClone', async () => {
      await github.cloneRepo();
    }),

    // Ver mis repositorios
    vscode.commands.registerCommand('local.githubRepos', async () => {
      const session = await github.getSession();
      if (!session) {
        const login = await github.login();
        if (!login) { return; }
      }

      const repos = await github.listRepos();
      if (!repos.length) {
        vscode.window.showInformationMessage('No tienes repositorios en GitHub.');
        return;
      }

      const selected = await vscode.window.showQuickPick(
        repos.map((r) => ({
          label: r.private ? `🔒 ${r.name}` : `🌍 ${r.name}`,
          description: r.description ?? '',
          detail: r.html_url,
          repo: r
        })),
        { placeHolder: 'Tus repositorios de GitHub' }
      );

      if (selected) {
        vscode.env.openExternal(vscode.Uri.parse(selected.repo.html_url));
      }
    }),

    // Activar modo internet (requiere API configurada en ⚙️)
    vscode.commands.registerCommand('local.useInternetProvider', async () => {
      const config = vscode.workspace.getConfiguration('local');
      await config.update('useInternet', true, vscode.ConfigurationTarget.Global);
      await config.update('provider', 'auto', vscode.ConfigurationTarget.Global);
      ollama.refreshConfig();
      await ollama.resolveAutoProvider();
      vscode.window.showInformationMessage(
        '✓ Internet activado. Configura una API en ⚙️ (Groq, Gemini, Cerebras…) o elige una en el panel.'
      );
      await refreshStatusBar();
    }),

    // Elegir IA / modelo detectado para programar (autocompletado y chat)
    vscode.commands.registerCommand('local.selectModel', async () => {
      const status = await ollama.checkConnection();
      if (!status.ok || !status.models || status.models.length === 0) {
        vscode.window.showWarningMessage('No se detectaron modelos de IA. Ejecuta "ollama serve" y "ollama pull qwen2.5-coder:7b"');
        return;
      }

      const config = vscode.workspace.getConfiguration('local');
      const currentCompletion = config.get<string>('completionModel', '');
      const currentChat = config.get<string>('chatModel', '');

      const items = status.models.map(model => ({
        label: model,
        description: model === currentCompletion || model === currentChat ? '✓ actual' : '',
        picked: model === currentCompletion || model === currentChat
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: `Modelos detectados (${status.models.length}). Elige uno`,
        canPickMany: false
      });
      if (!pick) return;

      const selectedModel = pick.label;

      const choice = await vscode.window.showQuickPick(
        [
          { label: 'Ambos (recomendado)', detail: `Usar ${selectedModel} para autocompletado + chat` },
          { label: 'Solo Autocompletado', detail: 'Para sugerencias inline mientras programas' },
          { label: 'Solo Chat / Agente', detail: 'Para el panel lateral y reparación de código' }
        ],
        { placeHolder: `¿Para qué usar "${selectedModel}"?` }
      );
      if (!choice) return;

      if (choice.label.includes('Ambos') || choice.label.includes('Autocompletado')) {
        await config.update('completionModel', selectedModel, vscode.ConfigurationTarget.Global);
      }
      if (choice.label.includes('Ambos') || choice.label.includes('Chat')) {
        await config.update('chatModel', selectedModel, vscode.ConfigurationTarget.Global);
      }

      vscode.window.showInformationMessage(`✓ Modelo IA actualizado: ${selectedModel}`);
      await refreshStatusBar();
    })

  );

  vscode.window.setStatusBarMessage('Local Copilot activado — detectando IA local...', 3000);
}

export function deactivate(): void {}

// ── Utilidades locales ────────────────────────────────────────────────────────

/**
 * Crea y registra el ítem de la barra de estado inferior.
 * El comando asociado permite comprobar la conexión con un clic.
 */
function createStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'local.checkConnection';
  context.subscriptions.push(item);
  return item;
}

/**
 * Devuelve el texto seleccionado en el editor activo.
 * Si no hay selección, muestra un aviso y devuelve `undefined`.
 */
function getSelectedCode(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage('Selecciona código primero.');
    return undefined;
  }
  return editor.document.getText(editor.selection);
}
