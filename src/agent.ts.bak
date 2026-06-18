/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ollama-copilot-vscode — Agente Autónomo Local
 *  (c) 2026 DavidPilahito7 · Licensed under the MIT License.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Author   : DavidPilahito7
 *  Project  : ollama-copilot-vscode
 *  Module   : LocalAgent — Agente autónomo de análisis y modificación de código
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
import * as path   from 'path';
import { OllamaClient } from './ollamaClient';

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface FileAction {
  type:      'create' | 'modify' | 'delete';
  filePath:  string;
  content?:  string;
  reason:    string;
}

export interface AgentResult {
  explanation: string;
  actions:     FileAction[];
}

// ── Constantes ────────────────────────────────────────────────────────────────

/** Máximo de archivos a leer en contexto por petición. */
const MAX_CONTEXT_FILES = 8;
/** Máximo de entradas del árbol enviadas al modelo para no saturar el contexto. */
const MAX_TREE_ENTRIES  = 300;
/** Límite de caracteres por archivo leído (evita desbordar el contexto del modelo). */
const MAX_FILE_CHARS    = 6_000;
/** Profundidad máxima de escaneo del árbol del proyecto. */
const MAX_SCAN_DEPTH    = 4;

const RELEVANT_EXTENSIONS = new Set([
  '.ts', '.js', '.java', '.kt', '.py',
  '.yml', '.yaml', '.json', '.md',
  '.sh', '.sql', '.conf', '.properties'
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', '.vscode'
]);

const ACTION_TYPE_MAP: Record<string, FileAction['type']> = {
  CREAR:     'create',
  MODIFICAR: 'modify',
  ELIMINAR:  'delete'
};

/**
 * Agente autónomo: recibe una petición en lenguaje natural, analiza el
 * proyecto y aplica los cambios directamente en disco — sin pedir confirmación
 * paso a paso, igual que Copilot en modo agente.
 *
 * @author DavidPilahito7
 * @license MIT
 */
export class LocalAgent {
  private readonly ollama:         OllamaClient;
  private readonly outputChannel:  vscode.OutputChannel;

  constructor(ollama: OllamaClient) {
    this.ollama        = ollama;
    this.outputChannel = vscode.window.createOutputChannel('Local Agente');
  }

  // ── API pública ───────────────────────────────────────────────────────────────

  /**
   * Punto de entrada principal: el usuario describe lo que necesita,
   * el agente analiza el proyecto y ejecuta los cambios.
   *
   * @param userPrompt  Petición en lenguaje natural.
   * @param onProgress  Callback que recibe mensajes de progreso en tiempo real.
   */
  async handleRequest(
    userPrompt:  string,
    onProgress:  (msg: string) => void
  ): Promise<AgentResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      throw new Error('No hay ninguna carpeta de proyecto abierta en VS Code.');
    }
    const rootPath = workspaceFolders[0].uri.fsPath;

    onProgress('🔍 Escaneando estructura del proyecto...');
    const projectTree = await this.scanProjectStructure(rootPath);

    onProgress('🧠 Analizando qué archivos son relevantes para tu petición...');
    const relevantFiles = await this.identifyRelevantFiles(userPrompt, projectTree, rootPath);

    onProgress(`📂 Leyendo ${relevantFiles.length} archivo(s) relevante(s)...`);
    const fileContents = await this.readFiles(relevantFiles);

    onProgress('⚙️ Generando la solución (esto puede tardar un poco con IA local)...');
    const result = await this.generateSolution(userPrompt, projectTree, fileContents);

    if (result.actions.length > 0) {
      const approved = await this.requestConfirmation(result, onProgress);
      if (!approved) {
        onProgress('🚫 Cambios cancelados por el usuario.');
        return result;
      }

      onProgress(`✏️ Aplicando ${result.actions.length} cambio(s) en el proyecto...`);
      await this.applyActions(result.actions, rootPath);
    }

    onProgress('✅ Listo.');
    return result;
  }

  // ── Escaneo del proyecto ──────────────────────────────────────────────────────

  /**
   * Recorre el árbol del proyecto recursivamente (hasta {@link MAX_SCAN_DEPTH})
   * para dar contexto general al modelo.
   */
  private async scanProjectStructure(
    rootPath: string,
    depth     = 0
  ): Promise<string[]> {
    if (depth > MAX_SCAN_DEPTH) { return []; }
    const results: string[] = [];

    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(rootPath));

      for (const [name, type] of entries) {
        if (IGNORE_DIRS.has(name)) { continue; }
        const fullPath = path.join(rootPath, name);

        if (type === vscode.FileType.Directory) {
          results.push(`${fullPath}/`);
          results.push(...await this.scanProjectStructure(fullPath, depth + 1));
        } else if (RELEVANT_EXTENSIONS.has(path.extname(name))) {
          results.push(fullPath);
        }
      }
    } catch {
      // Carpeta inaccesible — se omite silenciosamente.
    }

    return results;
  }

  // ── Selección de archivos relevantes ─────────────────────────────────────────

  /**
   * Pide al modelo que elija qué archivos necesita leer para resolver
   * la petición. Devuelve rutas absolutas (máximo {@link MAX_CONTEXT_FILES}).
   */
  private async identifyRelevantFiles(
    userPrompt:  string,
    projectTree: string[],
    rootPath:    string
  ): Promise<string[]> {
    const treeSnippet = projectTree
      .slice(0, MAX_TREE_ENTRIES)
      .map(p => p.replace(rootPath, ''))
      .join('\n');

    const prompt =
      `Eres Local, un ingeniero de software senior. El usuario te pide lo siguiente:\n` +
      `"${userPrompt}"\n\n` +
      `Esta es la estructura de archivos del proyecto:\n${treeSnippet}\n\n` +
      `Responde ÚNICAMENTE con una lista de rutas de archivo (máximo ${MAX_CONTEXT_FILES}) ` +
      `que necesitas leer para resolver la petición, una por línea, sin explicaciones ni markdown. ` +
      `Si necesitas crear un archivo nuevo que no existe, no lo incluyas aquí.`;

    const response = await this.ollama.generateCompletion(prompt);
    const lines    = response
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));

    const matched: string[] = [];
    for (const line of lines) {
      const found = projectTree.find(p => p.endsWith(line) || p.includes(line));
      if (found && !matched.includes(found)) { matched.push(found); }
    }

    return matched.slice(0, MAX_CONTEXT_FILES);
  }

  // ── Lectura de archivos ───────────────────────────────────────────────────────

  /** Lee el contenido de los archivos relevantes (con límite de caracteres). */
  private async readFiles(filePaths: string[]): Promise<Record<string, string>> {
    const contents: Record<string, string> = {};

    for (const fp of filePaths) {
      try {
        const data     = await vscode.workspace.fs.readFile(vscode.Uri.file(fp));
        contents[fp]   = Buffer.from(data).toString('utf-8').slice(0, MAX_FILE_CHARS);
      } catch {
        // Archivo no legible — se omite.
      }
    }

    return contents;
  }

  // ── Generación de la solución ─────────────────────────────────────────────────

  /**
   * Genera la solución final: explicación + lista de acciones de archivo.
   * Pide al modelo un formato estructurado y predecible para poder parsearlo.
   */
  private async generateSolution(
    userPrompt:   string,
    projectTree:  string[],
    fileContents: Record<string, string>
  ): Promise<AgentResult> {
    const contextBlock = Object.entries(fileContents)
      .map(([fp, content]) => `### Archivo: ${fp}\n\`\`\`\n${content}\n\`\`\``)
      .join('\n\n');

    const systemPrompt =
      `Eres Local, ingeniero de software senior autónomo. Trabajas sobre servidores ` +
      `Minecraft PaperMC, MariaDB y entornos Ubuntu/Linux, pero también ayudas con cualquier código. ` +
      `Actúas de forma independiente: decides qué archivos crear o modificar y lo haces directamente, ` +
      `sin pedir confirmación. Todos los comentarios de código van en español.\n\n` +
      `Responde EXACTAMENTE en este formato, sin texto adicional fuera de él:\n\n` +
      `EXPLICACION:\n<explicación clara de lo que vas a hacer>\n\n` +
      `ACCION: CREAR | RUTA: <ruta/relativa/archivo> | MOTIVO: <motivo>\n` +
      `<<CONTENIDO>>\n<contenido completo del archivo>\n<<FIN>>\n\n` +
      `ACCION: MODIFICAR | RUTA: <ruta/relativa/archivo> | MOTIVO: <motivo>\n` +
      `<<CONTENIDO>>\n<contenido completo del archivo>\n<<FIN>>\n\n` +
      `Puedes incluir varios bloques ACCION. Si no hace falta tocar archivos, omite todos los bloques ACCION.`;

    const userMessage =
      `Petición del usuario: "${userPrompt}"\n\n` +
      `Archivos relevantes del proyecto:\n` +
      (contextBlock || '(no se encontraron archivos existentes relevantes; puede que necesites crear uno nuevo)');

    let fullResponse = '';
    await this.ollama.chatStream(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  }
      ],
      (token) => { fullResponse += token; }
    );

    return this.parseAgentResponse(fullResponse);
  }

  // ── Parser de respuesta ───────────────────────────────────────────────────────

  /** Parsea la respuesta estructurada del modelo en explicación + acciones de archivo. */
  private parseAgentResponse(raw: string): AgentResult {
    const explanationMatch = raw.match(/EXPLICACION:\s*([\s\S]*?)(?=ACCION:|$)/);
    const explanation      = explanationMatch ? explanationMatch[1].trim() : raw.trim();

    const actions: FileAction[] = [];
    const actionRegex =
      /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n<<CONTENIDO>>([\s\S]*?)<<FIN>>/g;

    let match: RegExpExecArray | null;
    while ((match = actionRegex.exec(raw)) !== null) {
      const [, tipoRaw, rutaRaw, motivo, contenido] = match;
      actions.push({
        type:     ACTION_TYPE_MAP[tipoRaw] ?? 'modify',
        filePath: rutaRaw.trim(),
        content:  contenido.replace(/^\n/, '').replace(/\n$/, ''),
        reason:   motivo.trim()
      });
    }

    return { explanation, actions };
  }

  // ── Confirmación de acciones ───────────────────────────────────────────────

  /**
   * Solicita permiso al usuario antes de aplicar cambios en disco.
   * Si el usuario rechaza, el agente no toca ningún archivo.
   */
  private async requestConfirmation(
    result: AgentResult,
    onProgress: (msg: string) => void
  ): Promise<boolean> {
    const requireConfirmation = vscode.workspace
      .getConfiguration('local')
      .get('requireConfirmation', false);

    if (!requireConfirmation) {
      return true;
    }

    const confirmMessage = '¿Permitir que el agente aplique los cambios propuestos al proyecto?';

    onProgress('⏸️ Esperando confirmación del usuario...');

    try {
      const choice = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        'Aceptar',
        'Cancelar'
      );
      return choice === 'Aceptar';
    } catch {
      onProgress('⚠ La confirmación fue cancelada o no pudo abrirse correctamente; los cambios no se aplicarán.');
      return false;
    }
  }

  // ── Aplicación de acciones ────────────────────────────────────────────────────

  /**
   * Aplica las acciones de archivo directamente sobre el disco
   * después de recibir confirmación del usuario. Las rutas relativas se
   * resuelven desde la raíz del workspace.
   */
  private async applyActions(actions: FileAction[], rootPath: string): Promise<void> {
    for (const action of actions) {
      const fullPath = path.isAbsolute(action.filePath)
        ? action.filePath
        : path.join(rootPath, action.filePath);
      const uri = vscode.Uri.file(fullPath);

      this.outputChannel.appendLine(`[${action.type.toUpperCase()}] ${fullPath} — ${action.reason}`);

      try {
        if (action.type === 'delete') {
          await vscode.workspace.fs.delete(uri);
        } else {
          // Asegura que el directorio padre existe antes de escribir.
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fullPath)));
          await vscode.workspace.fs.writeFile(uri, Buffer.from(action.content ?? '', 'utf-8'));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.outputChannel.appendLine(`  ⚠ Error aplicando acción: ${message}`);
      }
    }

    if (actions.length > 0) {
      this.outputChannel.show(true);
    }
  }
}
