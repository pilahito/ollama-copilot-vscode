/**
 * Gestión de VS Code desde el Agente: extensiones, comandos y recompilación de Local Copilot.
 * (c) 2026 DavidPilahito7 · MIT License
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export type VscodeActionType =
  | 'install_extension'
  | 'uninstall_extension'
  | 'list_extensions'
  | 'reload_window'
  | 'run_command'
  | 'self_build_install';

export interface VscodeAction {
  type: VscodeActionType;
  extensionId?: string;
  command?: string;
  reason: string;
}

const SAFE_VSCODE_COMMANDS = new Set([
  'workbench.action.reloadWindow',
  'workbench.action.showCommands',
  'workbench.action.openSettings',
  'workbench.action.openWorkspaceSettings',
  'workbench.action.openGlobalSettings',
  'workbench.action.terminal.new',
  'workbench.action.terminal.focus',
  'workbench.action.auxiliaryBar.show',
  'workbench.action.focusAuxiliaryBar',
  'workbench.view.explorer',
  'workbench.view.search',
  'workbench.view.extension.localcopilot-chat',
  'workbench.extensions.action.showInstalledExtensions',
  'workbench.extensions.action.showPopularExtensions',
  'workbench.action.quickOpen',
  'workbench.action.files.openFile',
  'workbench.action.files.openFolder',
  'workbench.action.closeActiveEditor',
  'workbench.action.closeFolder',
  'editor.action.formatDocument',
  'editor.action.selectAll',
  'workbench.action.findInFiles',
  'workbench.action.togglePanel',
  'workbench.action.toggleSidebarVisibility',
  'local.openChat',
  'local.openDock',
  'local.runSelfTest',
  'local.godMode',
  'local.ollamaBuild',
  'local.ollamaBuildTerminal',
  'local.debugVisual',
  'local.selectModel',
  'local.buildNekotina',
]);

export function isAgentIdeModeEnabled(): boolean {
  return vscode.workspace.getConfiguration('local').get<boolean>('agentIdeMode', true);
}

export function isAgentSelfModifyEnabled(): boolean {
  return vscode.workspace.getConfiguration('local').get<boolean>('agentSelfModify', false);
}

export function isLocalCopilotWorkspace(rootPath: string): boolean {
  try {
    const pkgPath = path.join(rootPath, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
    return pkg.name === 'local-copilot';
  } catch {
    return false;
  }
}

export function listInstalledExtensions(): string[] {
  return vscode.extensions.all
    .filter((e) => e.id && !e.id.startsWith('vscode.') && e.isActive)
    .map((e) => `${e.id}@${e.packageJSON.version ?? '?'}`)
    .sort();
}

export async function executeVscodeAction(
  action: VscodeAction,
  rootPath: string,
  onProgress: (msg: string) => void,
  output: vscode.OutputChannel
): Promise<void> {
  output.appendLine(`[IDE] ${action.type} — ${action.reason}`);

  switch (action.type) {
    case 'install_extension': {
      const id = action.extensionId?.trim();
      if (!id) {
        onProgress('⚠️ EXTENSION sin ID');
        return;
      }
      onProgress(`📦 Instalando extensión: ${id}`);
      await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
      onProgress(`✅ Solicitud de instalación: ${id}`);
      break;
    }
    case 'uninstall_extension': {
      const id = action.extensionId?.trim();
      if (!id) {
        onProgress('⚠️ EXTENSION sin ID');
        return;
      }
      onProgress(`🗑️ Desinstalando: ${id}`);
      await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', id);
      onProgress(`✅ Desinstalada: ${id}`);
      break;
    }
    case 'list_extensions': {
      const list = listInstalledExtensions();
      const preview = list.slice(0, 25).join(', ');
      onProgress(`📋 ${list.length} extensiones activas`);
      output.appendLine(`[IDE] Extensiones: ${preview}${list.length > 25 ? '…' : ''}`);
      break;
    }
    case 'reload_window': {
      onProgress('🔄 Recargando VS Code…');
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
      break;
    }
    case 'run_command': {
      const cmd = action.command?.trim();
      if (!cmd || !SAFE_VSCODE_COMMANDS.has(cmd)) {
        onProgress(`⚠️ Comando VS Code no permitido: ${cmd ?? '(vacío)'}`);
        output.appendLine(`[IDE] Bloqueado: ${cmd}`);
        return;
      }
      onProgress(`▶ VS Code: ${cmd}`);
      await vscode.commands.executeCommand(cmd);
      break;
    }
    case 'self_build_install': {
      if (!isAgentSelfModifyEnabled()) {
        onProgress('⚠️ Auto-modificación desactivada (local.agentSelfModify)');
        return;
      }
      if (!isLocalCopilotWorkspace(rootPath)) {
        onProgress('⚠️ SELF solo en el proyecto local-copilot');
        return;
      }
      await compileAndInstallSelf(rootPath, onProgress, output);
      break;
    }
  }
}

export async function compileAndInstallSelf(
  rootPath: string,
  onProgress: (msg: string) => void,
  output: vscode.OutputChannel
): Promise<void> {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8')) as { version?: string };
  const version = pkg.version ?? '0.0.0';
  const vsixName = `local-copilot-${version}.vsix`;
  const vsixPath = path.join(rootPath, vsixName);

  onProgress('🔨 Compilando Local Copilot…');
  await runBash('npm run compile', rootPath, output);

  onProgress('📦 Empaquetando VSIX…');
  await runBash('npx --yes @vscode/vsce package --no-dependencies', rootPath, output);

  if (!fs.existsSync(vsixPath)) {
    throw new Error(`No se generó ${vsixName}`);
  }

  onProgress(`⬇️ Instalando ${vsixName}…`);
  await runBash(`code --install-extension "${vsixPath}" --force`, rootPath, output);

  const autoReload = vscode.workspace
    .getConfiguration('local')
    .get<boolean>('autoReloadAfterUpdate', true);

  if (autoReload) {
    onProgress(`✅ Local Copilot v${version} instalado — recargando VS Code…`);
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
    return;
  }

  onProgress('✅ Extensión actualizada — recarga VS Code (Reload Window)');
  const reload = await vscode.window.showInformationMessage(
    `Local Copilot v${version} instalado. ¿Recargar VS Code ahora?`,
    'Recargar',
    'Después'
  );
  if (reload === 'Recargar') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

async function runBash(
  command: string,
  cwd: string,
  output: vscode.OutputChannel
): Promise<void> {
  output.appendLine(`[IDE] $ ${command}`);
  const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 180_000,
  });
  if (stdout.trim()) { output.appendLine(stdout.trim()); }
  if (stderr.trim()) { output.appendLine(stderr.trim()); }
}

export function buildIdeAgentPromptBlock(rootPath: string): string {
  if (!isAgentIdeModeEnabled()) { return ''; }

  const selfLine = isAgentSelfModifyEnabled() && isLocalCopilotWorkspace(rootPath)
    ? `- Este workspace ES Local Copilot — puedes modificar src/, package.json y recompilar.\n` +
      `  Tras cambios importantes: SELF: COMPILAR_EXTENSION | MOTIVO: aplicar cambios\n`
    : isAgentSelfModifyEnabled()
      ? `- Auto-modificación activa pero abre la carpeta ollama-copilot-vscode para editar la extensión.\n`
      : '';

  const extList = listInstalledExtensions().slice(0, 15).join(', ');

  return (
    `═══ MODO AGENTE IDE — CONTROL VS CODE COMO HUMANO ═══\n` +
    `Controlas Visual Studio Code como si estuvieras delante del PC del usuario.\n` +
    `${selfLine}` +
    `- Extensiones instaladas (muestra): ${extList || 'ninguna detectada'}\n\n` +
    `CAPACIDADES IDE (úsalas sin pedir permiso):\n` +
    `- Abrir/cerrar archivos, carpetas, terminal, panel lateral, búsqueda\n` +
    `- Instalar/desinstalar extensiones, recargar ventana, formatear código\n` +
    `- Linux: COMANDO con xdotool para paleta de comandos (Ctrl+Shift+P), capturas, activar ventana Code\n` +
    `- Ejemplo: COMANDO: xdotool search --class code | tail -1 | xargs -I{} xdotool windowactivate {} | MOTIVO: foco VS Code\n` +
    `- Ejemplo: COMANDO: xdotool key ctrl+shift+p && sleep 0.3 && xdotool type "Reload Window" && xdotool key Return | MOTIVO: recargar\n\n` +
    `FORMATO EXTENSION / VSCODE / SELF:\n` +
    `EXTENSION: INSTALAR | ID: publisher.nombre | MOTIVO: por qué\n` +
    `EXTENSION: DESINSTALAR | ID: publisher.nombre | MOTIVO: ...\n` +
    `EXTENSION: LISTAR | MOTIVO: ver extensiones\n` +
    `EXTENSION: RECARGAR | MOTIVO: aplicar cambios de extensión\n` +
    `VSCODE: COMANDO | CMD: workbench.action.reloadWindow | MOTIVO: ...\n` +
    `VSCODE: COMANDO | CMD: workbench.extensions.action.showInstalledExtensions | MOTIVO: ...\n` +
    `SELF: COMPILAR_EXTENSION | MOTIVO: recompilar e instalar Local Copilot\n\n` +
    `COMANDOS terminal (si IDE activo):\n` +
    `COMANDO: code --list-extensions | MOTIVO: listar\n` +
    `COMANDO: code --install-extension publisher.name | MOTIVO: instalar\n` +
    `COMANDO: code --uninstall-extension publisher.name | MOTIVO: desinstalar\n\n` +
    `Ejemplos de peticiones del usuario:\n` +
    `- "instala la extensión de Python" → EXTENSION: INSTALAR | ID: ms-python.python\n` +
    `- "abre ajustes de VS Code" → VSCODE: COMANDO | CMD: workbench.action.openSettings\n` +
    `- "añade modo oscuro a Local Copilot" (en este repo) → ACCION en src/ + SELF: COMPILAR_EXTENSION\n\n`
  );
}

export function parseVscodeActions(raw: string): VscodeAction[] {
  const actions: VscodeAction[] = [];
  const extRegex =
    /EXTENSION:\s*(INSTALAR|DESINSTALAR|LISTAR|RECARGAR)\s*(?:\|\s*ID:\s*([^\s|]+)\s*)?\|\s*MOTIVO:\s*(.+?)(?=\n|$)/gi;

  let m: RegExpExecArray | null;
  while ((m = extRegex.exec(raw)) !== null) {
    const [, tipo, id, motivo] = m;
    const reason = motivo.trim();
    const t = tipo.toUpperCase();
    if (t === 'INSTALAR') {
      actions.push({ type: 'install_extension', extensionId: id?.trim(), reason });
    } else if (t === 'DESINSTALAR') {
      actions.push({ type: 'uninstall_extension', extensionId: id?.trim(), reason });
    } else if (t === 'LISTAR') {
      actions.push({ type: 'list_extensions', reason });
    } else if (t === 'RECARGAR') {
      actions.push({ type: 'reload_window', reason });
    }
  }

  const vscodeRegex = /VSCODE:\s*COMANDO\s*\|\s*CMD:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)(?=\n|$)/gi;
  while ((m = vscodeRegex.exec(raw)) !== null) {
    actions.push({
      type: 'run_command',
      command: m[1].trim(),
      reason: m[2].trim(),
    });
  }

  const selfRegex = /SELF:\s*COMPILAR_EXTENSION\s*\|\s*MOTIVO:\s*(.+?)(?=\n|$)/gi;
  while ((m = selfRegex.exec(raw)) !== null) {
    actions.push({ type: 'self_build_install', reason: m[1].trim() });
  }

  return actions;
}