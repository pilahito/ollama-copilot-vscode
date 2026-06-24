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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { OllamaClient }                    from './ollamaClient';
import { LocalInlineCompletionProvider }  from './inlineCompletionProvider';
import { LocalChatViewProvider }          from './chatViewProvider';

import { GitHubService }                   from './githubService';
import { initEditorContextTracking }       from './editorContext';
import { openCopilotChat, onActivityBarIconClick, hideCopilotChat } from './copilotLayout';
import { LocalDockViewProvider } from './dockViewProvider';
import { runSelfTest, ExtensionMonitor } from './selfTest';
import { initDebugLog } from './debugLog';
import { runVisualDebug } from './visualDebug';
import { runAgentLiveTest } from './agentLiveTest';
import { runNekotinaBattleTest } from './nekotinaBattleTest';
import { isSshAutoAnalyzeEnabled } from './grokMode';

// ── Constantes ────────────────────────────────────────────────────────────────

/** Intervalo de redetección de Ollama en segundo plano (ms). */
const POLLING_INTERVAL_MS = 60_000;

/** Modelo recomendado si el usuario no tiene ninguno descargado. */
const RECOMMENDED_MODEL = 'qwen2.5-coder:7b';

const outputChannel = vscode.window.createOutputChannel('Local Copilot');

const BATTLE_FLAG_PATH = path.join(os.tmpdir(), 'local-copilot-battle-ready.flag');

/** Espera el flag de batalla (npm run test:battle) hasta 3 min y lanza test visible. */
async function pollBattleReadyFlag(
  chatProvider: LocalChatViewProvider,
  log: (line: string) => void
): Promise<void> {
  for (let i = 0; i < 36; i++) {
    if (!fs.existsSync(BATTLE_FLAG_PATH)) {
      await new Promise<void>((r) => setTimeout(r, 5_000));
      continue;
    }
    try { fs.unlinkSync(BATTLE_FLAG_PATH); } catch { /* ignore */ }
    log('[battle] AUTO — batalla Nekotina (chat visible, escribe letra a letra)…');
    outputChannel.show(true);
    await openCopilotChat(chatProvider, log);
    await new Promise<void>((r) => setTimeout(r, 2_000));
    void runNekotinaBattleTest(chatProvider, log);
    return;
  }
}

// ── Activación ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(outputChannel);
  try {
    activateExtension(context);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[activate] FATAL: ${msg}`);
    vscode.window.showErrorMessage(`Local Copilot no pudo iniciar: ${msg}`);
  }
}

function activateExtension(context: vscode.ExtensionContext): void {
  initEditorContextTracking(context);

  const extVersion = context.extension.packageJSON.version ?? '?';
  const announceKey = `localCopilotAnnounced_v${extVersion}`;
  void (async () => {
    if (!context.globalState.get<boolean>(announceKey)) {
      await context.globalState.update(announceKey, true);
      const choice = await vscode.window.showInformationMessage(
        `Local Copilot v${extVersion} listo — chat a la derecha, pulsa 😈 en la barra.`,
        'Recargar VS Code'
      );
      if (choice === 'Recargar VS Code') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }
  })();

  const ollama        = new OllamaClient();
  const github        = new GitHubService();
  const statusBarItem = createStatusBar(context);

  // Si tenía DuckDuckGo como "IA", migrar a Auto (es navegador, no IA integrada)
  void (async () => {
    const config = vscode.workspace.getConfiguration('local');
    if (config.get<string>('provider') === 'duckduckgo') {
      await config.update('provider', 'auto', vscode.ConfigurationTarget.Global);
      ollama.refreshConfig();
    }
  })();

  // ── Status bar ──────────────────────────────────────────────────────────────

  async function refreshStatusBar(): Promise<void> {
    const status = await ollama.checkConnection();
    const config = vscode.workspace.getConfiguration('local');
    const currComp  = config.get<string>('completionModel', '');
    const currChat  = config.get<string>('chatModel', '');
    const currAgent = config.get<string>('agentModel', '') || currChat;

    if (status.ok) {
      const modelList = status.models.length > 0 ? status.models.join(', ') : 'ninguno descargado';
      statusBarItem.text              = `$(check) Local Copilot`;
      statusBarItem.tooltip           = `IA local activa.\nModelos: ${modelList}\n\nAutocompletado: ${currComp || 'auto'}\nChat: ${currChat || 'auto'}\nAgente: ${currAgent || 'auto'}\n\nClic: ver modelos\nComando: Local: Elegir modelo de IA`;
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

  refreshStatusBar();
  const interval = setInterval(refreshStatusBar, POLLING_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  // ── Vista de chat lateral ───────────────────────────────────────────────────

  const log = (line: string) => outputChannel.appendLine(line);
  initDebugLog(log);
  const chatProvider = new LocalChatViewProvider(context.extensionUri, ollama, github, log, context);
  chatProvider.setOpenChatPanel(() => openCopilotChat(chatProvider, log));
  const monitor = new ExtensionMonitor(ollama, chatProvider, log);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('local')) { return; }
      ollama.refreshConfig();
      const needsInvalidate =
        event.affectsConfiguration('local.ollamaUrl') ||
        event.affectsConfiguration('local.provider') ||
        event.affectsConfiguration('local.useInternet');
      if (needsInvalidate) {
        ollama.invalidateCaches();
      }
      void refreshStatusBar();
      if (event.affectsConfiguration('local.chatModel') ||
          event.affectsConfiguration('local.completionModel') ||
          event.affectsConfiguration('local.agentModel')) {
        chatProvider.pushModelsToUi();
      }
    })
  );
  let noModelsNotified = false;

  const openLocalChat = async (): Promise<void> => {
    try {
      await openCopilotChat(chatProvider, log);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[openChat] ${msg}`);
      vscode.window.showWarningMessage(
        'No se pudo abrir el chat a la derecha. Pulsa el icono 😈 (izquierda) o activa Ver → Apariencia → Barra lateral secundaria.'
      );
    }
  };

  // Inicio silencioso: abrir chat, reintentar ping sin popup "Reintentar"
  void ollama.prefetch().then(async () => {
    await openLocalChat();
    await refreshStatusBar();
    chatProvider.pushModelsToUi();

    const snap = ollama.getBootstrapSnapshot();
    if (snap.noModels && !noModelsNotified) {
      noModelsNotified = true;
      const hw = ollama.getHardwareProfile();
      log(`[startup] Sin modelos — ollama pull qwen2.5-coder:7b (${hw.osLabel}, ${hw.ramGb}GB)`);
    }

    let healthy = false;
    for (let attempt = 0; attempt < 5 && !healthy; attempt++) {
      if (attempt > 0) {
        await openLocalChat();
      }
      const ready = await chatProvider.waitUntilReady(12_000);
      if (!ready) {
        log(`[startup] Webview esperando… (${attempt + 1}/5)`);
        await new Promise<void>((r) => setTimeout(r, 2_000));
        continue;
      }
      const pingOk = await chatProvider.testWebviewPing(10_000);
      if (pingOk) {
        await chatProvider.forceSyncModels();
        healthy = true;
        log('[startup] ✓ Chat listo (ping OK, modelos cargados)');
        await context.globalState.update('localCopilotLastHealthy', Date.now());
        void chatProvider.resumePendingAgentRequest();
        void pollBattleReadyFlag(chatProvider, log);
      } else {
        log(`[startup] Ping reintento ${attempt + 1}/5…`);
        await new Promise<void>((r) => setTimeout(r, 2_000));
      }
    }

    if (!healthy) {
      log('[startup] Monitor silencioso (sin botón Reintentar)…');
      await monitor.runUntilHealthy({ maxAttempts: 4, intervalMs: 10_000, silent: true });
    }
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[monitor] Error: ${msg}`);
  });

  context.subscriptions.push({ dispose: () => monitor.stop() });

  const onDockActivated = () => onActivityBarIconClick(chatProvider, log);
  const onDockHidden = () => hideCopilotChat(log);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      LocalChatViewProvider.viewType,
      chatProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.window.registerWebviewViewProvider(
      LocalDockViewProvider.viewType,
      new LocalDockViewProvider(context.extensionUri, onDockActivated, onDockHidden)
    )
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
      void openLocalChat();
    }),

    vscode.commands.registerCommand('local.clearChat', () => {
      void openLocalChat();
      chatProvider.clearChat();
    }),

    vscode.commands.registerCommand('local.openDock', () => {
      void openLocalChat();
    }),

    vscode.commands.registerCommand('local.supportDonate', async () => {
      const url = vscode.workspace
        .getConfiguration('local')
        .get<string>('paypalDonateUrl', 'https://www.paypal.com/paypalme/pilahito');
      await vscode.env.openExternal(vscode.Uri.parse(url));
      vscode.window.showInformationMessage(
        '¡Gracias por apoyar Local Copilot! Tu donación ayuda a seguir mejorando la extensión. 💙'
      );
    }),

    vscode.commands.registerCommand('local.openProviderSite', async () => {
      await ollama.resolveAutoProvider();
      const url = ollama.getBrowserChatUrl();
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    // Depuración visual: ping webview, pipeline UI, captura de pantalla
    vscode.commands.registerCommand('local.debugVisual', async () => {
      outputChannel.show(true);
      log('[visual] Depuración visual iniciada…');
      await runVisualDebug(ollama, chatProvider, log);
    }),

    // Modo dios: depuración visual completa (chat + profesor + agente + usuario)
    vscode.commands.registerCommand('local.testAgentLive', async () => {
      outputChannel.show(true);
      log('[agent-live] Test en vivo — verás cada petición escribirse letra a letra en el chat Agente…');
      await openLocalChat();
      outputChannel.show(true);
      const result = await runAgentLiveTest(chatProvider, log);
      if (result.ok) {
        vscode.window.showInformationMessage(
          `✓ Test agente en vivo OK — ${result.passed} pruebas. Fallos visibles en el chat + /tmp/local-copilot-debug.log`
        );
      } else {
        log(`[agent-live] ${result.failed} fallo(s) — revisa mensajes ROJOS en el chat Agente`);
        outputChannel.show(true);
        vscode.window.showWarningMessage(
          `Test agente: ${result.failed} fallo(s). Mira el chat (mensajes rojos) y /tmp/local-copilot-debug.log`
        );
      }
    }),

    vscode.commands.registerCommand('local.battleReady', async () => {
      outputChannel.show(true);
      log('[battle] Batalla Nekotina — UI visible, agente escribe en el chat…');
      await openLocalChat();
      const result = await runNekotinaBattleTest(chatProvider, log);
      if (result.readyForBattle) {
        vscode.window.showInformationMessage(
          `🏆 LISTO PARA LA BATALLA — ${result.commandCoverage}% comandos · Log: /tmp/local-copilot-debug.log`
        );
      } else {
        outputChannel.show(true);
        vscode.window.showWarningMessage(
          `Batalla: ${result.failed} fallo(s). Mira el chat Agente (rojo/verde) y el log.`
        );
      }
    }),

    vscode.commands.registerCommand('local.godMode', async () => {
      outputChannel.show(true);
      log('[god] Modo dios iniciado…');
      let attempt = 0;
      let result = await runVisualDebug(ollama, chatProvider, log, { silent: true });
      while (!result.ok && attempt < 4) {
        attempt++;
        log(`[god] Reintento automático ${attempt}/4…`);
        await chatProvider.forceSyncModels();
        await openLocalChat();
        await new Promise<void>((r) => setTimeout(r, 8_000));
        result = await runVisualDebug(ollama, chatProvider, log, { silent: true });
      }
      if (result.ok) {
        vscode.window.showInformationMessage(
          `🔥 Modo dios OK — ${result.passed} pruebas.`
        );
      } else {
        log('[god] Fallos tras reintentos — ver salida Local Copilot');
        outputChannel.show(true);
      }
    }),

    // Autotest completo: Ollama, webview, chat, profesor y agente
    vscode.commands.registerCommand('local.runSelfTest', async () => {
      outputChannel.show(true);
      log('[selfTest] Ejecutando…');
      let result = await runSelfTest(ollama, chatProvider, log);
      for (let i = 0; i < 3 && !result.ok; i++) {
        log(`[selfTest] Reintento automático ${i + 1}/3…`);
        await openLocalChat();
        await chatProvider.forceSyncModels();
        await new Promise<void>((r) => setTimeout(r, 5_000));
        result = await runSelfTest(ollama, chatProvider, log);
      }
      if (result.ok) {
        vscode.window.showInformationMessage(
          `✓ Autotest OK — ${result.passed} pruebas.`
        );
      } else {
        log(`[selfTest] ${result.failed} fallo(s) tras reintentos — ver salida`);
        outputChannel.show(true);
      }
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

    // Explica el código del editor (selección o archivo visible).
    vscode.commands.registerCommand('local.explainCode', async () => {
      await openLocalChat();
      await chatProvider.runEditorQuickAction('explain');
    }),

    vscode.commands.registerCommand('local.generateCode', async () => {
      await openLocalChat();
      await chatProvider.runEditorQuickAction('generate');
    }),

    vscode.commands.registerCommand('local.createProject', async () => {
      await openLocalChat();
      await chatProvider.runProjectCreationWizard();
    }),

    vscode.commands.registerCommand('local.fixError', async () => {
      await openLocalChat();
      await chatProvider.runEditorQuickAction('fix');
    }),

    vscode.commands.registerCommand('local.refactorCode', async () => {
      await openLocalChat();
      await chatProvider.runEditorQuickAction('refactor');
    }),

    // Pide al agente que analice la estructura general del proyecto.
    vscode.commands.registerCommand('local.analyzeProject', () => {
      void openLocalChat();
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

      if (isSshAutoAnalyzeEnabled()) {
        vscode.window.showInformationMessage(
          'SSH abierto — el análisis Grok del sistema comenzará en 15s (local.sshAutoAnalyze).',
          'Iniciar ahora',
          'Cancelar'
        ).then((choice) => {
          if (choice === 'Cancelar') { return; }
          const delay = choice === 'Iniciar ahora' ? 2_000 : 15_000;
          setTimeout(() => {
            void chatProvider.runGrokSystemOptimize(true);
          }, delay);
        });
      }
    }),

    vscode.commands.registerCommand('local.sshAnalyzeSystem', async () => {
      await openLocalChat();
      await chatProvider.runSshSystemAnalyze(true);
    }),

    vscode.commands.registerCommand('local.buildNekotina', async () => {
      const term = vscode.window.createTerminal({ name: 'Nekotina — Ollama Live' });
      term.show();
      term.sendText(`node "${path.join(context.extensionPath, 'scripts', 'extension-nekotina-live.mjs')}"`);
      vscode.window.showInformationMessage(
        'Local Copilot: construyendo Nekotina con Ollama — mira la terminal "Nekotina — Ollama Live"'
      );
    }),

    vscode.commands.registerCommand('local.ollamaBuild', async () => {
      await openLocalChat();
      await chatProvider.runOllamaBuild();
    }),

    vscode.commands.registerCommand('local.ollamaBuildTerminal', async () => {
      const task = await vscode.window.showInputBox({
        title: 'Ollama Build (terminal)',
        prompt: 'Tarea para el agente en terminal',
        placeHolder: 'Ej: Implementa feature X y ejecuta tests',
      });
      if (!task) { return; }
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionPath;
      const term = vscode.window.createTerminal({ name: 'Ollama Build', cwd });
      term.show();
      const script = path.join(context.extensionPath, 'scripts', 'ollama-build.mjs');
      term.sendText(`node "${script}" ${JSON.stringify(task)}`);
      vscode.window.showInformationMessage('Ollama Build en terminal — sigue el log en /tmp/ollama-build.log');
    }),

    vscode.commands.registerCommand('local.grokOptimizeSystem', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: 'SSH remoto', description: 'Analiza el servidor en local.sshHost (2–3 h)' },
          { label: 'Sistema local', description: 'Analiza esta máquina (2–3 h)' },
        ],
        { placeHolder: 'Modo Grok — ¿dónde optimizar?' }
      );
      if (!choice) { return; }
      await openLocalChat();
      void chatProvider.runGrokSystemOptimize(choice.label.includes('SSH'));
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
      if (!(await github.ensureAuthenticated())) {
        return;
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

  vscode.window.setStatusBarMessage('Local Copilot activado — autotest en curso…', 4000);
  outputChannel.appendLine('Local Copilot activado. Autotest automático al detectar Ollama.');
  outputChannel.show(true);
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


