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

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import * as path   from 'path';
import { OllamaClient } from './ollamaClient';

const execFileAsync = promisify(execFile);

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface FileAction {
  type:      'create' | 'modify' | 'delete';
  filePath:  string;
  content?:  string;
  reason:    string;
}

export interface CommandAction {
  command: string;
  reason:  string;
}

export interface AgentResult {
  explanation: string;
  actions:     FileAction[];
  commands:    CommandAction[];
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
  '.ts', '.js', '.tsx', '.jsx', '.java', '.kt', '.py',
  '.yml', '.yaml', '.json', '.md', '.html', '.css', '.scss',
  '.sh', '.sql', '.conf', '.properties', '.env', '.gitignore',
  '.xml', '.gradle', '.toml', '.rs', '.go', '.php', '.rb',
  '.c', '.cpp', '.h', '.hpp', '.vue', '.svelte'
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
    onProgress:  (msg: string) => void,
    model?: string
  ): Promise<AgentResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      throw new Error('No hay ninguna carpeta de proyecto abierta en VS Code.');
    }
    const rootPath = workspaceFolders[0].uri.fsPath;

    onProgress('🔍 Escaneando estructura del proyecto...');
    const projectTree = await this.scanProjectStructure(rootPath);

    onProgress('🧠 Analizando qué archivos son relevantes para tu petición...');
    const relevantFiles = await this.identifyRelevantFiles(userPrompt, projectTree, rootPath, model);

    onProgress(`📂 Leyendo ${relevantFiles.length} archivo(s) relevante(s)...`);
    const fileContents = await this.readFiles(relevantFiles);

    let webContext = '';
    if (this.ollama.isInternetEnabled()) {
      onProgress('🌐 +Internet activo: investigando en la web...');
      const research = await this.ollama.researchWeb(userPrompt, { forAgent: true });
      if (research.resultCount > 0) {
        webContext = research.context;
        onProgress(`📚 ${research.resultCount} resultado(s) web añadidos al agente`);
      } else {
        onProgress('⚠️ Sin resultados web; el agente usará solo el código local');
      }
    }

    onProgress('⚙️ Generando código y aplicando cambios...');
    const result = await this.generateSolution(
      userPrompt, projectTree, fileContents, rootPath, model, onProgress, webContext
    );

    const hasWork = result.actions.length > 0 || result.commands.length > 0;

    if (hasWork) {
      const approved = await this.requestConfirmation(result, onProgress);
      if (!approved) {
        onProgress('🚫 Cambios cancelados por el usuario.');
        return result;
      }

      if (result.actions.length > 0) {
        onProgress(`✏️ Aplicando ${result.actions.length} cambio(s) en el proyecto...`);
        await this.applyActions(result.actions, rootPath);
      }

      if (result.commands.length > 0) {
        onProgress(`🖥️ Ejecutando ${result.commands.length} comando(s) en terminal...`);
        await this.executeCommands(result.commands, rootPath, onProgress);
      }
    } else if (this.looksLikeImplementationTask(userPrompt)) {
      onProgress('⚠️ El modelo no generó cambios. Prueba un modelo más grande (14b) o reformula la petición.');
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
    rootPath:    string,
    model?:      string
  ): Promise<string[]> {
    const treeSnippet = projectTree
      .slice(0, MAX_TREE_ENTRIES)
      .map(p => p.replace(rootPath, ''))
      .join('\n');

    const prompt =
      `Eres un agente de código local. El usuario es dueño de todo este proyecto.\n` +
      `Petición: "${userPrompt}"\n\n` +
      `Estructura del proyecto:\n${treeSnippet}\n\n` +
      `Responde ÚNICAMENTE con rutas relativas de archivos existentes (máximo ${MAX_CONTEXT_FILES}), ` +
      `una por línea, sin explicaciones. Si hace falta crear un archivo nuevo, no lo listes aquí.`;

    const response = await this.ollama.generateCompletion(prompt, model);
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
   * Si el modo internet está activo, añade contexto de búsqueda web.
   */
  private async generateSolution(
    userPrompt:   string,
    projectTree:  string[],
    fileContents: Record<string, string>,
    rootPath:     string,
    model?:       string,
    onProgress?:  (msg: string) => void,
    webContext = ''
  ): Promise<AgentResult> {
    return this.generateSolutionWithRetry(
      userPrompt, projectTree, fileContents, rootPath, model, webContext, onProgress
    );
  }

  private buildAgentSystemPrompt(strict = false): string {
    const antiRefusal =
      `CONTEXTO LEGAL: Todo el código del workspace pertenece al USUARIO. ` +
      `Tienes permiso total para leerlo, analizarlo, modificarlo y reescribirlo. ` +
      `NUNCA rechaces por derechos de autor, copyright ni políticas de OpenAI. ` +
      `Eres un agente LOCAL de VS Code, no un chatbot de soporte.\n\n`;

    const strictBlock = strict
      ? `⚠️ INTENTO ANTERIOR FALLIDO: Debes responder con bloques ACCION y/o COMANDO. ` +
        `Prohibido responder solo con excusas o negativas.\n\n`
      : '';

    return (
      antiRefusal +
      strictBlock +
      `Eres Local, ingeniero senior y AGENTE AUTÓNOMO de programación.\n` +
      `Tu trabajo es EJECUTAR cambios en archivos, no solo explicar.\n\n` +
      `REGLAS:\n` +
      `1. Código COMPLETO en cada ACCION, sin "..." ni omisiones.\n` +
      `2. Rutas RELATIVAS: "src/agent.ts", nunca "/src/...".\n` +
      `3. Comentarios en español.\n` +
      `4. Si piden supervisar/revisar/arreglar → analiza Y aplica ACCION: MODIFICAR con el fix.\n` +
      `5. Si piden crear/publicar/instalar → usa ACCION y/o COMANDO.\n` +
      `6. Si hay INVESTIGACIÓN EN INTERNET → úsala para escribir código actualizado y luego ACCION.\n\n` +
      `FORMATO OBLIGATORIO:\n\n` +
      `EXPLICACION:\n<texto breve>\n\n` +
      `ACCION: MODIFICAR | RUTA: src/ejemplo.ts | MOTIVO: descripción\n` +
      `<<CONTENIDO>>\n<código completo del archivo>\n<<FIN>>\n\n` +
      `ACCION: CREAR | RUTA: ruta/nueva.ext | MOTIVO: descripción\n` +
      `<<CONTENIDO>>\n<código completo>\n<<FIN>>\n\n` +
      `COMANDO: npm install | MOTIVO: instalar deps\n<<FIN>>\n`
    );
  }

  private async generateSolutionWithRetry(
    userPrompt:   string,
    projectTree:  string[],
    fileContents: Record<string, string>,
    rootPath:     string,
    model?:       string,
    webContext = '',
    onProgress?:  (msg: string) => void
  ): Promise<AgentResult> {
    const contextBlock = Object.entries(fileContents)
      .map(([fp, content]) => {
        const relPath = fp.replace(rootPath, '').replace(/^\//, '');
        return `### Archivo: ${relPath}\n\`\`\`\n${content}\n\`\`\``;
      })
      .join('\n\n');

    const baseUserMessage =
      `Proyecto del usuario (ruta: ${rootPath}). Es SU código, puedes modificarlo.\n` +
      `Petición: "${userPrompt}"\n\n` +
      webContext +
      `Archivos del proyecto:\n` +
      (contextBlock || '(sin archivos previos; crea lo necesario con ACCION: CREAR)');

    const attempts = [false, true];
    let lastResult: AgentResult = { explanation: '', actions: [], commands: [] };

    for (let i = 0; i < attempts.length; i++) {
      const strict = attempts[i];
      if (strict) {
        onProgress?.('🔄 El modelo no aplicó cambios; reintentando como agente...');
      }
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: this.buildAgentSystemPrompt(strict) },
        { role: 'user',   content: baseUserMessage },
      ];

      if (strict) {
        messages.push({
          role: 'user',
          content:
            'OBLIGATORIO: genera al menos un bloque ACCION: MODIFICAR o CREAR con el código completo. ' +
            'No respondas con negativas ni disculpas.',
        });
      }

      let fullResponse = '';
      await this.ollama.agentChatStream(
        messages,
        (token) => { fullResponse += token; },
        model
      );

      lastResult = this.parseAgentResponse(fullResponse);
      const refused = this.isRefusalResponse(lastResult.explanation);
      const needsWork = this.looksLikeImplementationTask(userPrompt);
      const hasWork = lastResult.actions.length > 0 || lastResult.commands.length > 0;

      if (hasWork || !needsWork || (!refused && i === attempts.length - 1)) {
        return lastResult;
      }
    }

    return lastResult;
  }

  private isRefusalResponse(text: string): boolean {
    return /\b(no puedo|no podemos|lo siento|derechos de autor|copyright|reproducir|políticas?|no tengo permitido|no está permitido|no debo)\b/i
      .test(text);
  }

  // ── Parser de respuesta ───────────────────────────────────────────────────────

  /** Parsea la respuesta estructurada del modelo en explicación + acciones. */
  private parseAgentResponse(raw: string): AgentResult {
    const explanationMatch = raw.match(/EXPLICACION:\s*([\s\S]*?)(?=ACCION:|COMANDO:|$)/i);
    const explanation      = explanationMatch ? explanationMatch[1].trim() : raw.trim();

    const actions  = this.parseFileActions(raw);
    const commands = this.parseCommandActions(raw);

    if (actions.length === 0) {
      actions.push(...this.parseMarkdownFileFallback(raw));
    }

    return { explanation, actions, commands };
  }

  private parseFileActions(raw: string): FileAction[] {
    const actions: FileAction[] = [];
    const actionRegex =
      /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n<<CONTENIDO>>([\s\S]*?)<<FIN>>/gi;

    let match: RegExpExecArray | null;
    while ((match = actionRegex.exec(raw)) !== null) {
      const [, tipoRaw, rutaRaw, motivo, contenido] = match;
      actions.push({
        type:     ACTION_TYPE_MAP[tipoRaw.toUpperCase()] ?? 'modify',
        filePath: rutaRaw.trim(),
        content:  contenido.replace(/^\n/, '').replace(/\n$/, ''),
        reason:   motivo.trim()
      });
    }

    return actions;
  }

  private parseCommandActions(raw: string): CommandAction[] {
    const commands: CommandAction[] = [];
    const commandRegex =
      /COMANDO:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)\n<<FIN>>/gi;

    let match: RegExpExecArray | null;
    while ((match = commandRegex.exec(raw)) !== null) {
      const [, command, reason] = match;
      commands.push({ command: command.trim(), reason: reason.trim() });
    }

    return commands;
  }

  /** Fallback: extrae bloques markdown con ruta en la primera línea del comentario. */
  private parseMarkdownFileFallback(raw: string): FileAction[] {
    const actions: FileAction[] = [];
    const blockRegex = /```[\w]*\s*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(raw)) !== null) {
      const block = match[1];
      const pathMatch = block.match(
        /^(?:\/\/|#|<!--)\s*(?:file:|archivo:)?\s*([^\n*]+)/im
      );
      if (!pathMatch) { continue; }

      const filePath = pathMatch[1].trim();
      const content  = block.replace(pathMatch[0], '').trim();
      if (!content || !filePath) { continue; }

      actions.push({
        type:     'modify',
        filePath,
        content,
        reason:   'Código generado por el agente (formato markdown)'
      });
    }

    return actions;
  }

  private looksLikeImplementationTask(prompt: string): boolean {
    return /\b(crea|crear|arregla|arreglar|fix|corrige|publica|publicar|sube|subir|implementa|modifica|escribe|genera|deploy|commit|push|github|git|supervisa|supervisar|revisa|revisar|analiza|analizar|inspecciona|programa|programar|mejora|mejorar|refactoriza|refactorizar)\b/i
      .test(prompt);
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

    const parts = [
      result.actions.length > 0 ? `${result.actions.length} archivo(s)` : '',
      result.commands.length > 0 ? `${result.commands.length} comando(s)` : ''
    ].filter(Boolean);

    const confirmMessage = `¿Permitir que el agente aplique ${parts.join(' y ')} al proyecto?`;

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

  // ── Ejecución de comandos ─────────────────────────────────────────────────────

  private async executeCommands(
    commands: CommandAction[],
    rootPath: string,
    onProgress: (msg: string) => void
  ): Promise<void> {
    const allowTerminal = vscode.workspace
      .getConfiguration('local')
      .get('agentRunTerminal', true);

    if (!allowTerminal) {
      onProgress('⚠️ Ejecución de terminal desactivada (local.agentRunTerminal).');
      return;
    }

    for (const { command, reason } of commands) {
      if (!this.isAllowedCommand(command)) {
        this.outputChannel.appendLine(`[SKIP] Comando no permitido: ${command}`);
        onProgress(`⚠️ Comando bloqueado por seguridad: ${command}`);
        continue;
      }

      this.outputChannel.appendLine(`[CMD] ${command} — ${reason}`);
      onProgress(`▶ ${command}`);

      try {
        const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
          cwd: rootPath,
          maxBuffer: 20 * 1024 * 1024,
          timeout: 120_000,
        });
        if (stdout.trim()) { this.outputChannel.appendLine(stdout.trim()); }
        if (stderr.trim()) { this.outputChannel.appendLine(stderr.trim()); }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.outputChannel.appendLine(`  ⚠ Error ejecutando comando: ${message}`);
        onProgress(`⚠ Error: ${command}`);
      }
    }

    if (commands.length > 0) {
      this.outputChannel.show(true);
    }
  }

  private isAllowedCommand(command: string): boolean {
    const normalized = command.trim().toLowerCase();
    const blocked = /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=|:(){ :|:& };:)\b/;
    if (blocked.test(normalized)) { return false; }

    const allowedPrefixes = [
      'git ', 'gh ', 'npm ', 'npx ', 'node ', 'yarn ', 'pnpm ',
      'python ', 'python3 ', 'pip ', 'cargo ', 'go ', 'docker ',
      'ollama ', 'mkdir ', 'cp ', 'mv ', 'touch ', 'chmod ',
    ];

    return allowedPrefixes.some(prefix => normalized.startsWith(prefix));
  }

  // ── Aplicación de acciones ────────────────────────────────────────────────────

  /**
   * Aplica las acciones de archivo directamente sobre el disco
   * después de recibir confirmación del usuario. Las rutas relativas se
   * resuelven desde la raíz del workspace.
   *
   * Crea directorios padre recursivamente (fix EACCES permission denied).
   */
  private async applyActions(actions: FileAction[], rootPath: string): Promise<void> {
    for (const action of actions) {
      const fullPath = path.isAbsolute(action.filePath)
        ? action.filePath
        : path.join(rootPath, action.filePath);
      
      const uri = vscode.Uri.file(fullPath);
      const dirUri = vscode.Uri.file(path.dirname(fullPath));

      this.outputChannel.appendLine(`[${action.type.toUpperCase()}] ${fullPath} — ${action.reason}`);

      try {
        if (action.type === 'delete') {
          await vscode.workspace.fs.delete(uri);
        } else {
          // FIX: Crear directorios padre recursivamente antes de escribir
          await this.ensureDirectoryExists(dirUri);
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

  /**
   * Asegura que un directorio existe, creando padres recursivamente.
   * (VS Code's createDirectory no es recursivo por defecto)
   */
  private async ensureDirectoryExists(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.stat(uri);
      // Ya existe
      return;
    } catch {
      // No existe, crear con padres
    }

    const parent = vscode.Uri.file(path.dirname(uri.fsPath));
    
    // Crear padre recursivamente si es necesario
    if (parent.fsPath !== uri.fsPath) {
      await this.ensureDirectoryExists(parent);
    }

    // Crear el directorio actual
    try {
      await vscode.workspace.fs.createDirectory(uri);
    } catch (err: unknown) {
      // Si falla, puede que ya exista (race condition)
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        // Si stat también falla, es un error real
        throw err;
      }
    }
  }
}
