import * as vscode from 'vscode';
import type { LocalChatViewProvider } from './chatViewProvider';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let openingChat = false;
let chatPanelOpen = false;

/** Vistas de otras extensiones IA que compiten por la barra derecha. */
const COMPETING_VIEW_IDS = [
  'chatgpt.sidebarSecondaryView',
  'chatgpt.sidebarView',
  'github.copilot-chat',
  'github.copilot.panelView',
  'workbench.panel.chat.view.copilot',
];

const COMPETING_CLOSE_COMMANDS = [
  'github.copilot.chat.close',
  'github.copilot.closeQueryEditor',
];

/** Cierra Codex / Copilot Chat si están abiertos — no deben interrumpir Local Copilot. */
async function suppressCompetingAiChats(log?: (line: string) => void): Promise<void> {
  for (const cmd of COMPETING_CLOSE_COMMANDS) {
    try {
      await vscode.commands.executeCommand(cmd);
      log?.(`[layout] Cerrado competidor: ${cmd}`);
    } catch {
      /* extensión no instalada */
    }
  }
  for (const viewId of COMPETING_VIEW_IDS) {
    try {
      await vscode.commands.executeCommand('workbench.action.closeView', viewId);
      log?.(`[layout] closeView: ${viewId}`);
    } catch {
      /* vista no presente */
    }
  }
}

/** Muestra la barra lateral secundaria (derecha) donde vive el chat. */
async function ensureAuxiliaryBarVisible(log?: (line: string) => void): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.auxiliaryBar.show');
    log?.('[openCopilotChat] auxiliaryBar.show');
    await delay(120);
    return;
  } catch {
    /* VS Code antiguo */
  }

  const secondaryHidden =
    vscode.workspace.getConfiguration('workbench').get('secondarySideBar.defaultVisibility') === 'hidden';
  if (secondaryHidden) {
    await vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
    log?.('[openCopilotChat] toggleAuxiliaryBar (estaba oculta)');
    await delay(120);
  }
}

/** Enfoca el webview del chat en el panel derecho. */
async function focusChatView(log?: (line: string) => void): Promise<void> {
  const focusCommands = [
    'local.chatView.focus',
    'workbench.view.extension.localcopilot-chat',
    'workbench.view.localcopilot-chat',
  ];

  for (const cmd of focusCommands) {
    try {
      await vscode.commands.executeCommand(cmd);
      log?.(`[openCopilotChat] focus: ${cmd}`);
      await delay(80);
    } catch {
      /* siguiente */
    }
  }
}

/**
 * Abre el chat en el panel DERECHO (barra lateral secundaria).
 * El icono del dock queda a la izquierda; el chat no ocupa la barra izquierda.
 */
export async function openCopilotChat(
  chatProvider: LocalChatViewProvider,
  log?: (line: string) => void
): Promise<void> {
  if (openingChat) { return; }
  openingChat = true;

  try {
    await ensureAuxiliaryBarVisible(log);
    await suppressCompetingAiChats(log);

    try {
      await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
      await delay(80);
    } catch {
      /* */
    }

    for (let attempt = 0; attempt < 6; attempt++) {
      await focusChatView(log);
      await chatProvider.reveal();
      await delay(100 + attempt * 60);
      if (await chatProvider.waitUntilReady(2000)) {
        break;
      }
    }

    await suppressCompetingAiChats(log);
    await focusChatView(log);
    await chatProvider.reveal();

    if (!chatProvider.isReady()) {
      throw new Error('La vista del chat no se inicializó. Recarga VS Code (Reload Window).');
    }

    chatPanelOpen = true;
    log?.('[openCopilotChat] Chat abierto en panel derecho.');
  } finally {
    openingChat = false;
  }
}

/** Oculta el panel derecho del chat (al cerrar el dock izquierdo). */
export async function hideCopilotChat(log?: (line: string) => void): Promise<void> {
  if (!chatPanelOpen) { return; }
  try {
    await vscode.commands.executeCommand('workbench.action.closeView', 'local.chatView');
    log?.('[hideCopilotChat] closeView local.chatView');
  } catch {
    /* */
  }
  try {
    await vscode.commands.executeCommand('workbench.action.auxiliaryBar.hide');
    log?.('[hideCopilotChat] auxiliaryBar.hide');
  } catch {
    try {
      await vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
    } catch { /* */ }
  }
  chatPanelOpen = false;
}

export function isCopilotChatOpen(): boolean {
  return chatPanelOpen;
}

/** Alterna chat: abre si está cerrado, oculta si ya está abierto. */
export async function toggleCopilotChat(
  chatProvider: LocalChatViewProvider,
  log?: (line: string) => void
): Promise<void> {
  if (chatPanelOpen) {
    await hideCopilotChat(log);
    return;
  }
  await openCopilotChat(chatProvider, log);
}

/** Clic en icono izquierdo: alterna dock + chat (se oculta al pulsar de nuevo). */
export async function onActivityBarIconClick(
  chatProvider: LocalChatViewProvider,
  log?: (line: string) => void
): Promise<void> {
  if (chatPanelOpen) {
    await hideCopilotChat(log);
    return;
  }
  try {
    await vscode.commands.executeCommand('workbench.view.explorer');
    log?.('[dock] Explorador izquierdo activo');
  } catch {
    /* */
  }
  await delay(80);
  await openCopilotChat(chatProvider, log);
}