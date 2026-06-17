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

// ── Constantes ────────────────────────────────────────────────────────────────

/** Intervalo de redetección de Ollama en segundo plano (ms). */
const POLLING_INTERVAL_MS = 30_000;

/** Modelo recomendado si el usuario no tiene ninguno descargado. */
const RECOMMENDED_MODEL = 'qwen2.5-coder:7b';

// ── Activación ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const ollama        = new OllamaClient();
  const statusBarItem = createStatusBar(context);

  // ── Status bar ──────────────────────────────────────────────────────────────

  async function refreshStatusBar(): Promise<void> {
    const status = await ollama.checkConnection();

    if (status.ok) {
      const modelList = status.models.join(', ') || 'ninguno descargado';
      statusBarItem.text              = `$(check) Local: IA local activa`;
      statusBarItem.tooltip           = `Ollama conectado. Modelos: ${modelList}`;
      statusBarItem.backgroundColor   = undefined;
    } else {
      statusBarItem.text            = `$(warning) Local: sin IA local`;
      statusBarItem.tooltip         = 'No se detecta Ollama. Ejecuta "ollama serve" en tu terminal.';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    statusBarItem.show();
  }

  // Detecta Ollama al arrancar y repite cada POLLING_INTERVAL_MS por si
  // el usuario lanza Ollama después de abrir VS Code.
  refreshStatusBar();
  const interval = setInterval(refreshStatusBar, POLLING_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

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

    // Abre el panel lateral de chat.
    vscode.commands.registerCommand('local.openChat', () => {
      vscode.commands.executeCommand('workbench.view.extension.local-sidebar');
    }),

    // Comprueba la conexión manualmente y muestra una notificación con el resultado.
    vscode.commands.registerCommand('local.checkConnection', async () => {
      await refreshStatusBar();
      const status = await ollama.checkConnection();

      if (status.ok) {
        const modelList = status.models.join(', ')
          || `ninguno — descarga uno con "ollama pull ${RECOMMENDED_MODEL}"`;
        vscode.window.showInformationMessage(
          `✓ Local: Ollama conectado. Modelos disponibles: ${modelList}`
        );
      } else {
        vscode.window.showWarningMessage(
          '⚠ Local: no se detecta Ollama en localhost:11434. Instálalo y ejecuta "ollama serve".'
        );
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

      vscode.commands.executeCommand('workbench.view.extension.local-sidebar');
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
      vscode.commands.executeCommand('workbench.view.extension.local-sidebar');
      chatProvider.sendExternalPrompt(
        `Arregla el siguiente código del archivo ${filePath}. Aplica el cambio directamente:\n\n${code}`,
        'agent'
      );
    }),

    // Pide al agente que analice la estructura general del proyecto.
    vscode.commands.registerCommand('local.analyzeProject', () => {
      vscode.commands.executeCommand('workbench.view.extension.local-sidebar');
      chatProvider.sendExternalPrompt(
        'Analiza la estructura general de este proyecto y dime qué mejorarías o si detectas algún problema.',
        'agent'
      );
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
