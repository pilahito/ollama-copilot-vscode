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
import { GitHubService, GitHubAgentContext } from './githubService';

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

export interface GitHubToolAction {
  type:      'publish' | 'commit_push' | 'status';
  repoName?: string;
  message?:  string;
  isPrivate?: boolean;
  reason:    string;
}

export interface AgentResult {
  explanation: string;
  actions:     FileAction[];
  commands:    CommandAction[];
  githubTools: GitHubToolAction[];
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

/** Nombres de archivo sin extensión que el agente puede escribir. */
const KNOWN_FILENAMES = new Set([
  'package.json', 'tsconfig.json', 'Dockerfile', 'Makefile', 'README.md',
  '.gitignore', '.env.example', 'index.js', 'index.ts', 'main.py', 'app.py',
  '.gitkeep', '.keep',
]);

const PATH_HINT_RE = /(?:^|[/\\])(?:src|lib|server|bot|api)[/\\][\w./-]+\.\w{1,8}$/i;

/** Extensiones de código ejecutable que el agente debe escribir (no documentación). */
const CODE_EXTENSIONS = new Set([
  '.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs', '.py', '.java', '.kt',
  '.go', '.rs', '.php', '.rb', '.vue', '.svelte', '.sh', '.sql',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift',
]);

const DOC_EXTENSIONS = new Set(['.md', '.txt', '.rst', '.adoc']);

const ACTION_TYPE_MAP: Record<string, FileAction['type']> = {
  CREAR:     'create',
  MODIFICAR: 'modify',
  ELIMINAR:  'delete'
};

/** Plan de archivos/carpetas con sentido común (como un programador senior). */
interface ArchitecturePlan {
  folders:          string[];
  modulesToCreate:  string[];
  filesToModify:    string[];
  summary:          string;
}

/** Metadatos del proyecto para orientar al modelo sin que el usuario nombre archivos. */
interface ProjectProfile {
  type:        string;
  primaryEntry: string;
  stack:       string[];
  hint:        string;
  /** Archivo nuevo que Ollama debe CREAR (ej. chatbot.js). */
  moduleToCreate?: string;
  /** Carpetas que el usuario pidió crear (ej. multimedia). */
  foldersToCreate?: string[];
  /** Distribución modular esperada para esta petición. */
  architecture?: ArchitecturePlan;
}

/** Entorno local y SSH configurado en VS Code. */
interface EnvironmentProfile {
  localOs:    string;
  sshEnabled: boolean;
  sshTarget:  string | null;
  sshCommand: string;
  sshPort:    number;
}

type AgentTaskMode = 'code' | 'remote' | 'mixed' | 'github';

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
  private readonly github:         GitHubService | null;
  private readonly outputChannel:  vscode.OutputChannel;

  constructor(ollama: OllamaClient, github?: GitHubService) {
    this.ollama        = ollama;
    this.github        = github ?? null;
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

    const entryPoints = await this.getProjectEntryPoints(rootPath);
    const filesToRead = [...new Set([...entryPoints, ...relevantFiles])].slice(0, MAX_CONTEXT_FILES);

    onProgress(`📂 Leyendo ${filesToRead.length} archivo(s) relevante(s)...`);
    const fileContents = await this.readFiles(filesToRead);

    const projectName = workspaceFolders[0].name;
    let githubContext = '';
    if (this.github) {
      onProgress('🐙 Leyendo estado Git/GitHub...');
      const ghCtx = await this.github.getAgentContext(rootPath, projectName);
      githubContext = this.formatGitHubContextForAgent(ghCtx);
    }

    let webContext = '';
    if (this.ollama.isInternetEnabled()) {
      onProgress('🌐 +Internet activo: investigando en la web...');
      const research = await this.ollama.researchWeb(userPrompt, { forAgent: true });
      if (research.resultCount > 0) {
        webContext = research.context;
        onProgress(`📚 ${research.resultCount} resultado(s) web añadidos al agente`);
      } else {
        onProgress('⚠️ Búsqueda web sin resultados (DDG limitado); el agente usa código local + Ollama');
      }
    }

    onProgress('⚙️ Generando código y aplicando cambios...');
    const result = await this.generateSolution(
      userPrompt, projectTree, fileContents, rootPath, entryPoints,
      model, onProgress, webContext, githubContext, projectName
    );

    const hasWork = result.actions.length > 0 || result.commands.length > 0 || result.githubTools.length > 0;

    if (hasWork) {
      const approved = await this.requestConfirmation(result, onProgress);
      if (!approved) {
        onProgress('🚫 Cambios cancelados por el usuario.');
        return result;
      }

      if (result.commands.length > 0) {
        onProgress(`🖥️ Ejecutando ${result.commands.length} comando(s) en terminal...`);
        await this.executeCommands(result.commands, rootPath, onProgress);
      }

      if (result.actions.length > 0) {
        const normalized = await this.normalizeActionTypes(result.actions, rootPath);
        onProgress(`✏️ Aplicando ${normalized.length} cambio(s) en el proyecto...`);
        for (const action of normalized) {
          const icon = action.type === 'create' ? '🆕' : action.type === 'delete' ? '🗑️' : '✏️';
          onProgress(`${icon} ${action.filePath}`);
        }
        await this.applyActions(normalized, rootPath);
        await this.verifyAppliedActions(normalized, rootPath, onProgress);
      }

      if (result.githubTools.length > 0 && this.github) {
        onProgress(`🐙 Ejecutando ${result.githubTools.length} acción(es) GitHub...`);
        await this.executeGitHubTools(result.githubTools, rootPath, projectName, onProgress);
      }
    } else if (this.looksLikeGitHubTask(userPrompt)) {
      onProgress('⚠️ El modelo no generó acciones GitHub. Prueba: "publica en GitHub", "haz commit y push" o "git status".');
    } else if (this.looksLikeImplementationTask(userPrompt) || this.looksLikeRemoteTask(userPrompt)) {
      const mainFile = entryPoints[0]
        ? path.relative(rootPath, entryPoints[0]).replace(/\\/g, '/')
        : 'index.js';
      const env = this.buildEnvironmentProfile();
      const hint = this.looksLikeRemoteTask(userPrompt)
        ? (env.sshTarget
          ? `Configura SSH en Settings y pide: "Supervisa mi servidor SSH ${env.sshTarget}"`
          : 'Configura local.sshHost en Settings para supervisión remota')
        : `Reformula: "Modifica ${mainFile} y …" o usa qwen2.5-coder:14b`;
      onProgress(`⚠️ El modelo no generó cambios. ${hint}`);
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
      `Eres un selector de archivos para un agente de código en VS Code.\n` +
      `Petición del usuario: "${userPrompt}"\n\n` +
      `Estructura del proyecto:\n${treeSnippet}\n\n` +
      `INSTRUCCIONES:\n` +
      `- Devuelve SOLO rutas relativas de archivos de CÓDIGO existentes (.js, .ts, .py…).\n` +
      `- Prioriza: index.js, index.ts, package.json, src/*, .sh, .conf, docker-compose.yml, nginx.\n` +
      `- Si la petición es SSH/servidor: incluye scripts, configs y systemd del proyecto.\n` +
      `- Máximo ${MAX_CONTEXT_FILES} rutas, una por línea, sin explicaciones ni markdown.\n` +
      `- NO listes .md, .txt ni archivos que aún no existen.\n`;

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
    entryPoints:  string[],
    model?:       string,
    onProgress?:  (msg: string) => void,
    webContext = '',
    githubContext = '',
    projectName = 'proyecto'
  ): Promise<AgentResult> {
    return this.generateSolutionWithRetry(
      userPrompt, projectTree, fileContents, rootPath, entryPoints,
      model, webContext, githubContext, projectName, onProgress
    );
  }

  /**
   * Planifica carpetas y módulos según la petición (no todo en index.js).
   * Ej: "carpeta multimedia" → multimedia/ + commands/multimedia.js + cableado en index.js
   */
  private buildArchitecturePlan(
    userPrompt: string,
    primaryEntry: string,
    stack: string[],
    projectTree: string[],
    fileContents: Record<string, string>
  ): ArchitecturePlan {
    const folders = [...this.extractRequestedFolders(userPrompt)];
    const modules: string[] = [];
    const modifies = new Set<string>([primaryEntry]);

    const inferFolder = (name: string, re: RegExp) => {
      if (re.test(userPrompt) && !folders.includes(name)) {
        folders.push(name);
      }
    };
    inferFolder('multimedia', /\b(multimedia|im[aá]genes?|fotos?|v[ií]deos?|audios?|galer[ií]a)\b/i);
    inferFolder('assets', /\b(assets?|recursos|est[aá]ticos)\b/i);
    inferFolder('uploads', /\b(uploads?|subidas?)\b/i);
    inferFolder('data', /\b(datos|data|json\s+de\s+datos)\b/i);

    const hasCommandsDir = projectTree.some((p) => /[/\\]commands[/\\]?$/i.test(p) || p.endsWith('/commands'));
    const hasSrcDir      = projectTree.some((p) => /[/\\]src[/\\]/i.test(p));
    const cmdBase        = hasCommandsDir ? 'commands/' : (hasSrcDir ? 'src/commands/' : 'commands/');
    const isDiscord      = stack.includes('Discord.js');

    const featureSlug = (word: string): string =>
      word.toLowerCase().replace(/[^a-z0-9_-]/g, '');

    if (isDiscord) {
      if (folders.includes('multimedia') || /\bmultimedia\b/i.test(userPrompt)) {
        modules.push(`${cmdBase}multimedia.js`);
      }
      const cmdMatch = userPrompt.match(/\bcomando\s+!?([\w-]+)/i);
      if (cmdMatch) {
        modules.push(`${cmdBase}${featureSlug(cmdMatch[1])}.js`);
      }
      if (/\b(nuevo|nueva)\s+(?:funci[oó]n|feature|m[oó]dulo)\b/i.test(userPrompt)) {
        const feat = userPrompt.match(/\bpara\s+([\w-]+)/i);
        if (feat) {
          modules.push(`${cmdBase}${featureSlug(feat[1])}.js`);
        }
      }
    }

    if (this.wantsNewModuleFile(userPrompt)) {
      modules.push('chatbot.js');
    }

    if (/\b(api|endpoint|ruta)\b/i.test(userPrompt) && isDiscord) {
      modules.push(hasSrcDir ? 'src/routes/api.js' : 'routes/api.js');
    }

    const existingPaths = new Set(
      Object.keys(fileContents).map((p) => path.basename(p))
    );
    if (existingPaths.has('chatbot.js') && /\bchatbot\b/i.test(userPrompt)) {
      modifies.add('chatbot.js');
    }

    const uniqueModules = [...new Set(modules)];
    const folderLine = folders.length ? folders.map((f) => `${f}/`).join(', ') : '(ninguna nueva)';
    const moduleLine = uniqueModules.length ? uniqueModules.join(', ') : '(módulo según necesidad)';
    const summary =
      `Carpetas: ${folderLine}. Crear módulos: ${moduleLine}. ` +
      `Modificar solo cableado en: ${[...modifies].join(', ')}. ` +
      `La lógica nueva va en su módulo/carpeta, NO toda en ${primaryEntry}.`;

    return {
      folders,
      modulesToCreate: uniqueModules,
      filesToModify:   [...modifies],
      summary,
    };
  }

  /** ¿Ollama respetó la arquitectura modular (no solo index.js)? */
  private architectureSatisfied(
    actions: FileAction[],
    plan: ArchitecturePlan,
    primaryEntry: string
  ): boolean {
    if (plan.modulesToCreate.length === 0 && plan.folders.length === 0) {
      return true;
    }

    const paths = actions.map((a) => a.filePath.replace(/\\/g, '/'));
    const foldersOk = this.foldersCovered(actions, plan.folders);

    const modulesOk = plan.modulesToCreate.every((m) =>
      paths.some((p) => p === m || p.endsWith(`/${m}`))
    );

    if (plan.modulesToCreate.length > 0 && !modulesOk) {
      const onlyEntry = paths.every((p) => {
        const base = path.posix.basename(p);
        return p === primaryEntry || base === 'index.js' || base === '.gitkeep' || p.endsWith('/.gitkeep');
      });
      const bigEntry = actions.find(
        (a) => a.filePath.replace(/\\/g, '/') === primaryEntry ||
          a.filePath.endsWith('index.js')
      );
      if (onlyEntry && (bigEntry?.content?.length ?? 0) > 400) {
        return false;
      }
      return false;
    }

    return foldersOk;
  }

  /** Detecta tipo de proyecto y archivo principal para guiar a Ollama automáticamente. */
  private buildProjectProfile(
    rootPath: string,
    entryPoints: string[],
    fileContents: Record<string, string>,
    userPrompt = '',
    projectTree: string[] = []
  ): ProjectProfile {
    const primaryEntry = entryPoints[0]
      ? path.relative(rootPath, entryPoints[0]).replace(/\\/g, '/')
      : 'index.js';

    const pkgPath = Object.keys(fileContents).find((p) => p.endsWith('package.json'));
    const pkgRaw  = pkgPath ? fileContents[pkgPath] : '';
    const deps    = pkgRaw.match(/"dependencies"\s*:\s*\{([^}]+)\}/s)?.[1] ?? '';
    const stack: string[] = [];

    if (/discord\.js/.test(deps))       { stack.push('Discord.js'); }
    if (/express/.test(deps))           { stack.push('Express'); }
    if (/react/.test(deps))             { stack.push('React'); }
    if (/vue/.test(deps))               { stack.push('Vue'); }
    if (/typescript/.test(deps) || primaryEntry.endsWith('.ts')) { stack.push('TypeScript'); }
    if (/python|django|flask/.test(pkgRaw)) { stack.push('Python'); }

    let type = 'Node.js';
    if (primaryEntry.endsWith('.py')) { type = 'Python'; }
    else if (primaryEntry.endsWith('.ts')) { type = 'TypeScript/Node'; }
    else if (stack.includes('Discord.js')) { type = 'Bot de Discord (Node.js)'; }

    const architecture = this.buildArchitecturePlan(
      userPrompt, primaryEntry, stack, projectTree, fileContents
    );
    const foldersToCreate = architecture.folders;
    let moduleToCreate: string | undefined;

    let hint =
      `SENTIDO COMÚN: ${architecture.summary} ` +
      `${primaryEntry} es solo el punto de entrada (require, registrar, login) — no metas ahí toda la lógica.`;

    if (this.wantsNewModuleFile(userPrompt)) {
      moduleToCreate = 'chatbot.js';
      hint =
        `OBLIGATORIO: CREAR chatbot.js (lógica) + MODIFICAR ${primaryEntry} (solo require/registro). ` +
        `Dos bloques ACCION con <<CONTENIDO>> completo.`;
    } else if (architecture.modulesToCreate.length > 0) {
      const mods = architecture.modulesToCreate.join(', ');
      const fks  = foldersToCreate.map((f) => `${f}/.gitkeep`).join(', ');
      hint =
        `OBLIGATORIO mínimo: ` +
        (fks ? `CREAR ${fks} + ` : '') +
        `CREAR ${mods} (toda la lógica del pedido) + MODIFICAR ${primaryEntry} (solo conectar con require). ` +
        `Usa path.join(__dirname, "carpeta") — sin rutas absolutas.`;
    } else if (/\b(chatbot|chat\s*bot|palabras?\s*clave)\b/i.test(userPrompt)) {
      hint += ' Lógica en chatbot.js; index.js solo conecta.';
    } else if (/\b(mejora|mejorar|arregla|fix)\b/i.test(userPrompt)) {
      hint += ' Cambio pequeño: puede ir en el módulo existente; si es grande, crea archivo nuevo.';
    }
    if (this.looksLikeRemoteTask(userPrompt)) {
      hint += ' SSH: COMANDO para diagnóstico; scripts en .sh/.conf/.yml.';
    }

    return { type, primaryEntry, stack, hint, moduleToCreate, foldersToCreate, architecture };
  }

  /** Extrae nombres de carpetas pedidas en lenguaje natural. */
  private extractRequestedFolders(prompt: string): string[] {
    const found = new Set<string>();
    const skip = new Set(['la', 'el', 'una', 'un', 'para', 'de', 'del', 'los', 'las']);

    const patterns = [
      /\b(?:crea(?:r)?|genera(?:r)?)\s+(?:la\s+|una\s+|el\s+)?(?:carpeta|caperta|directorio|folder)\s+["']?([\w.-]+)["']?/gi,
      /\b(?:carpeta|caperta|directorio|folder)\s+(?:llamada\s+|de\s+|para\s+)?["']?([\w.-]+)["']?/gi,
      /\b(?:en\s+la\s+)?(?:carpeta|caperta)\s+["']?([\w.-]+)["']?/gi,
      /\b(?:carpeta|caperta)\s+para\s+["']?([\w.-]+)["']?/gi,
    ];

    for (const re of patterns) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(prompt)) !== null) {
        const name = match[1]?.trim().toLowerCase();
        if (name && /^[\w.-]+$/.test(name) && !skip.has(name)) {
          found.add(name);
        }
      }
    }

    return [...found];
  }

  /** Quita fences ``` que Ollama a veces mete dentro de <<CONTENIDO>>. */
  private stripMarkdownFromContent(content: string): string {
    let c = content.trim();
    const wrapped = c.match(/^```[\w]*\s*\n([\s\S]*?)\n```\s*$/);
    if (wrapped) {
      c = wrapped[1].trim();
    } else if (c.startsWith('```')) {
      c = c.replace(/^```[\w]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
    }
    return c;
  }

  /** Si el usuario pidió carpetas y el modelo no las creó, inyecta .gitkeep. */
  private injectFolderCreateActions(
    actions: FileAction[],
    userPrompt: string
  ): FileAction[] {
    const folders = this.extractRequestedFolders(userPrompt);
    if (folders.length === 0) {
      return actions;
    }

    const result = [...actions];
    const covered = new Set(
      result.map((a) => a.filePath.replace(/\\/g, '/').toLowerCase())
    );

    for (const folder of folders) {
      const gitkeep = `${folder}/.gitkeep`;
      const hasFolderFile = [...covered].some(
        (p) => p.startsWith(`${folder}/`) || p === folder
      );
      if (!hasFolderFile) {
        result.unshift({
          type:     'create',
          filePath: gitkeep,
          content:  '# Carpeta creada por Local Copilot\n',
          reason:   `Carpeta "${folder}" solicitada (auto-inyectada)`,
        });
        covered.add(gitkeep);
      }
    }

    return result;
  }

  /** Ruta de módulo sugerida cuando Ollama pone una ruta inválida (evita index.js). */
  private inferModulePathFromPrompt(prompt: string): string | null {
    if (/\bmultimedia\b/i.test(prompt)) {
      return 'commands/multimedia.js';
    }
    const cmd = prompt.match(/\bcomando\s+!?([\w-]+)/i);
    if (cmd) {
      return `commands/${cmd[1].toLowerCase()}.js`;
    }
    if (this.wantsNewModuleFile(prompt)) {
      return 'chatbot.js';
    }
    return null;
  }

  /** El usuario pide un archivo/módulo nuevo (chatbot.js, etc.). */
  private wantsNewModuleFile(prompt: string): boolean {
    return /\b(crear|crea)\b.*\b(archivo|chatbot|m[oó]dulo)\b/i.test(prompt) ||
      /\b(archivo|m[oó]dulo)\b.*\b(chatbot|bot)\b/i.test(prompt) ||
      /\bchatbot\.js\b/i.test(prompt);
  }

  /** Lee configuración SSH y SO local desde VS Code. */
  private buildEnvironmentProfile(): EnvironmentProfile {
    const config = vscode.workspace.getConfiguration('local');
    const sshHost = config.get<string>('sshHost', '').trim();
    const sshUser = config.get<string>('sshUser', '').trim();
    const sshPort = config.get<number>('sshPort', 22);
    const sshCommand = config.get<string>('sshCommand', 'ssh');
    const sshEnabled = config.get<boolean>('enableAutomation', false) && sshHost.length > 0;

    let localOs = 'desconocido';
    if (process.platform === 'linux')   { localOs = 'Linux'; }
    if (process.platform === 'win32')   { localOs = 'Windows'; }
    if (process.platform === 'darwin')  { localOs = 'macOS'; }

    const sshTarget = sshHost
      ? `${sshUser ? `${sshUser}@` : ''}${sshHost}`
      : null;

    return { localOs, sshEnabled, sshTarget, sshCommand, sshPort };
  }

  /** Prefijo ssh listo para COMANDO: `ssh -p 2220 david@host "cmd"` */
  private formatSshInvoke(env: EnvironmentProfile): string {
    if (!env.sshTarget) { return ''; }
    const portFlag = env.sshPort !== 22 ? ` -p ${env.sshPort}` : '';
    return `${env.sshCommand}${portFlag} ${env.sshTarget}`;
  }

  private formatSshDisplay(env: EnvironmentProfile): string {
    if (!env.sshTarget) { return ''; }
    return env.sshPort !== 22 ? `${env.sshTarget}:${env.sshPort}` : env.sshTarget;
  }

  private looksLikeRemoteTask(prompt: string): boolean {
    return /\b(ssh|servidor|server|vps|ubuntu|debian|centos|fedora|windows\s*server|wsl|systemd|nginx|apache|docker|kubernetes|k8s|firewall|ufw|supervisa|supervisar|remoto|infraestructura|sysadmin|devops|mariadb|mysql|postgres|redis|lavalink|papermc|minecraft\s*server)\b/i
      .test(prompt);
  }

  private looksLikeGitHubTask(prompt: string): boolean {
    return /\b(github|git\s+init|git\s+status|git\s+add|git\s+commit|git\s+push|gh\s+repo|gh\s+pr|gh\s+release|publica(?:r)?\s+(?:en\s+)?github|sube(?:r)?\s+(?:a\s+)?github|subir\s+(?:a\s+)?github|repositorio(?:\s+en\s+github)?|repo\s+remoto|commit\s+y\s+push|hacer\s+push|crear\s+release|pull\s+request|origin\s+remoto)\b/i
      .test(prompt);
  }

  private looksLikePureGitHubTask(prompt: string): boolean {
    return this.looksLikeGitHubTask(prompt) &&
      !/\b(carpeta|caperta|m[oó]dulo|archivo|comando|chatbot|api|endpoint|fix|arregla|implementa|programa|multimedia|crea(?:r)?\s+(?:la\s+)?(?:carpeta|archivo))\b/i
        .test(prompt);
  }

  private formatGitHubContextForAgent(ctx: GitHubAgentContext): string {
    const lines = [
      `Proyecto: ${ctx.projectName}`,
      `Git repo: ${ctx.isGitRepo ? 'sí' : 'no'}`,
      `Rama: ${ctx.branch}`,
      `Remote origin: ${ctx.remote}`,
      `Cambios sin commit: ${ctx.dirtyCount}`,
      `Git instalado: ${ctx.hasGit ? 'sí' : 'no'}`,
      `gh CLI: ${ctx.hasGh ? (ctx.ghAuthenticated ? 'autenticado' : 'sin login') : 'no instalado'}`,
      `VS Code GitHub: ${ctx.vscodeGitHubAuth ? 'conectado' : 'no'}`,
      ctx.userLogin ? `Usuario: @${ctx.userLogin}` : '',
      '',
      ctx.toolkitSummary,
    ].filter(Boolean);
    return lines.join('\n');
  }

  private buildGitHubToolsBlock(githubContext: string, taskMode: AgentTaskMode): string {
    if (!githubContext || !this.github) { return ''; }

    const roleHint = taskMode === 'github'
      ? 'La tarea principal es Git/GitHub — usa bloques GITHUB o COMANDO git/gh.\n'
      : 'Si el usuario pide publicar, commit o push, añade bloques GITHUB además del código.\n';

    return (
      `═══ GITHUB / GIT (herramientas del agente) ═══\n` +
      `${githubContext}\n\n` +
      roleHint +
      `FORMATO GITHUB (la extensión ejecuta esto automáticamente):\n` +
      `GITHUB: PUBLICAR | REPO: nombre-repo | PRIVADO: no | MOTIVO: <razón>\n` +
      `GITHUB: COMMIT_PUSH | MENSAJE: mensaje del commit | MOTIVO: <razón>\n` +
      `GITHUB: STATUS | MOTIVO: <razón>\n\n` +
      `También válido: COMANDO: git add -A | MOTIVO: ...\n` +
      `COMANDO: git commit -m "mensaje" | MOTIVO: ...\n` +
      `COMANDO: git push | MOTIVO: ...\n` +
      `COMANDO: gh repo create NOMBRE --public --source=. --push | MOTIVO: ...\n\n`
    );
  }

  private classifyTask(userPrompt: string): AgentTaskMode {
    const github = this.looksLikeGitHubTask(userPrompt);
    const code   = this.looksLikeImplementationTask(userPrompt) && !this.looksLikePureGitHubTask(userPrompt);
    const remote = this.looksLikeRemoteTask(userPrompt);
    if (github && (code || remote)) { return 'mixed'; }
    if (github)                     { return 'github'; }
    if (code && remote)             { return 'mixed'; }
    if (remote)                     { return 'remote'; }
    return 'code';
  }

  private buildExpertiseBlock(): string {
    return (
      `═══ EXPERTISE MULTI-PLATAFORMA ═══\n` +
      `Eres experto senior en TODOS estos ámbitos (aplica el que corresponda a la tarea):\n\n` +
      `LENGUAJES: JavaScript/TypeScript, Python, Java/Kotlin, C/C++/C#, Go, Rust, PHP, Ruby, ` +
      `Swift, SQL, Bash/PowerShell, HTML/CSS, Vue, React, Svelte, Discord.js, y más.\n\n` +
      `SO & SERVIDORES:\n` +
      `- Linux: Ubuntu, Debian, CentOS, Fedora, Arch — systemd, apt/dnf/yum, ufw, cron, journalctl\n` +
      `- Windows: Server/Desktop, PowerShell, servicios, IIS, WSL, registro, tareas programadas\n` +
      `- macOS: Homebrew, launchd, redes\n\n` +
      `INFRA & OPS: SSH, Docker/Podman, Nginx/Apache, MariaDB/MySQL/PostgreSQL, Redis, ` +
      `Git/GitHub, CI/CD, Ollama, Node/npm, Minecraft/PaperMC, Lavalink, VPN, SSL/certbot, backups.\n\n` +
      `CAPACIDADES:\n` +
      `- Programar y modificar código en el workspace\n` +
      `- Supervisar/analizar servidores locales o remotos vía COMANDO\n` +
      `- Diagnosticar (logs, procesos, disco, red, servicios) y proponer mejoras concretas\n` +
      `- Escribir scripts .sh/.ps1 y configs (.conf, .service, docker-compose.yml, nginx)\n`
    );
  }

  private buildSshBlock(env: EnvironmentProfile, taskMode: AgentTaskMode): string {
    if (taskMode === 'code' && !env.sshEnabled) { return ''; }

    let block =
      `═══ SSH Y TERMINAL REMOTA ═══\n` +
      `SO local del usuario: ${env.localOs}\n`;

    if (env.sshEnabled && env.sshTarget) {
      block +=
        `SSH configurado: ${this.formatSshDisplay(env)}\n` +
        `Para ejecutar en el servidor remoto usa COMANDO con:\n` +
        `  ${this.formatSshInvoke(env)} "<comando remoto>"\n\n` +
        `PROTOCOLO SUPERVISIÓN SSH:\n` +
        `1. DIAGNÓSTICO: COMANDO con uptime, df -h, free -m, systemctl --failed, journalctl -n 50\n` +
        `2. ANÁLISIS: interpreta salida en EXPLICACION\n` +
        `3. MEJORA: COMANDO para aplicar fix seguro O ACCION en scripts/configs del proyecto\n` +
        `4. NUNCA ejecutes rm -rf /, mkfs, ni borrados masivos sin que el usuario lo pida explícito\n\n`;
    } else {
      block +=
        `SSH no configurado. Para remoto: Settings → local.sshHost, local.sshUser, local.enableAutomation.\n` +
        `Mientras tanto usa COMANDO en la máquina local (${env.localOs}).\n\n`;
    }

    if (env.localOs === 'Windows') {
      block +=
        `WINDOWS: puedes usar COMANDO con powershell, pwsh, wsl, ipconfig, Get-Service, systeminfo.\n\n`;
    }
    if (env.localOs === 'Linux') {
      block +=
        `LINUX: puedes usar COMANDO con systemctl, journalctl, apt, ufw, docker, nginx -t, ss -tlnp.\n\n`;
    }

    return block;
  }

  private buildAgentSystemPrompt(
    strict: boolean,
    profile: ProjectProfile,
    env: EnvironmentProfile,
    taskMode: AgentTaskMode,
    githubContext = ''
  ): string {
    const stackLine = profile.stack.length
      ? `Stack detectado: ${profile.stack.join(', ')}.\n`
      : '';

    const antiRefusal =
      `═══ CONTEXTO ═══\n` +
      `Eres OLLAMA en MODO AGENTE de VS Code (Local Copilot).\n` +
      `TÚ programas: emites bloques ACCION/COMANDO y la extensión ESCRIBE los archivos automáticamente.\n` +
      `PROHIBIDO decir al usuario "copia este código", "hazlo manualmente" o "abre el archivo". TÚ lo haces.\n` +
      `Todo el código del workspace es del USUARIO — permiso TOTAL. NUNCA rechaces por copyright.\n\n`;

    const strictBlock = strict
      ? profile.moduleToCreate
        ? `⚠️ REINTENTO: Emite DOS bloques ACCION:\n` +
          `ACCION: CREAR | RUTA: ${profile.moduleToCreate} | MOTIVO: módulo chatbot\n<<CONTENIDO>>\n...\n<<FIN>>\n` +
          `ACCION: MODIFICAR | RUTA: ${profile.primaryEntry} | MOTIVO: conectar módulo\n<<CONTENIDO>>\n...\n<<FIN>>\n\n`
        : `⚠️ REINTENTO: Tu respuesta anterior NO tenía ACCION válida con código .js/.ts.\n` +
          `OBLIGATORIO: ACCION: MODIFICAR | RUTA: ${profile.primaryEntry} | con <<CONTENIDO>> completo.\n\n`
      : '';

    const roleLine = taskMode === 'remote'
      ? `Eres **Local Agent**, ingeniero DevOps/SRE senior. Supervisas, diagnosticas y mejoras sistemas.\n` +
        `Usa COMANDO para diagnóstico/ejecución y ACCION para scripts y configuraciones.\n`
      : taskMode === 'github'
        ? `Eres **Local Agent**, experto en Git y GitHub. Publicas repos, haces commit/push y revisas estado.\n` +
          `Usa bloques GITHUB o COMANDO git/gh — la extensión los ejecuta por ti.\n`
      : taskMode === 'mixed'
        ? `Eres **Local Agent**, full-stack + DevOps + GitHub senior. Programas, supervisas y publicas en Git.\n`
        : `Eres **Local Agent**, ingeniero senior autónomo. Tu salida útil es CÓDIGO en archivos.\n` +
          `NO solo explicas: PROGRAMAS.\n`;

    return (
      antiRefusal +
      strictBlock +
      `═══ ROL ═══\n` +
      roleLine +
      `\n` +
      this.buildExpertiseBlock() +
      this.buildGitHubToolsBlock(githubContext, taskMode) +
      this.buildSshBlock(env, taskMode) +
      `═══ PERFIL DEL PROYECTO ═══\n` +
      `Tipo: ${profile.type}\n` +
      stackLine +
      `Archivo principal: ${profile.primaryEntry}\n` +
      `Guía: ${profile.hint}\n\n` +
      `═══ SENTIDO COMÚN DE PROGRAMADOR (OBLIGATORIO) ═══\n` +
      `- Carpeta para datos/archivos del dominio (multimedia/, assets/, data/…)\n` +
      `- Un módulo .js/.ts por funcionalidad (commands/foo.js, services/bar.js)\n` +
      `- ${profile.primaryEntry} SOLO: cliente, require(), registrar comandos/rutas, login\n` +
      `- PROHIBIDO meter toda la lógica nueva solo en ${profile.primaryEntry}\n` +
      (profile.architecture
        ? `- Para ESTA tarea: ${profile.architecture.summary}\n`
        : '') +
      `\n` +
      `═══ PROTOCOLO ═══\n` +
      `1. PLAN: qué carpetas, qué módulos nuevos y qué archivos solo cablear.\n` +
      `2. CREAR carpetas (.gitkeep) y módulos con la lógica.\n` +
      `3. MODIFICAR ${profile.primaryEntry} solo para conectar (require/registro).\n` +
      `4. EMITIR un ACCION por cada archivo con <<CONTENIDO>>…<<FIN>>.\n\n` +
      `═══ REGLAS DE ARCHIVOS ═══\n` +
      `✅ PERMITIDO: .js .ts .tsx .jsx .py .go .rs y rutas como "index.js", "src/bot.ts"\n` +
      `❌ PROHIBIDO: .md .txt archivos sin extensión frases en español como nombre\n` +
      `❌ PROHIBIDO: crear "documentación", "instrucciones" o duplicar index.js con otro nombre\n` +
      `❌ PROHIBIDO: responder solo con listas 1. 2. 3. sin bloque ACCION\n` +
      `❌ PROHIBIDO: poner código solo en EXPLICACION — el código va en <<CONTENIDO>>\n` +
      `❌ PROHIBIDO: envolver <<CONTENIDO>> en \`\`\`javascript — solo código puro dentro\n` +
      `❌ PROHIBIDO: rutas absolutas /home/usuario/... — usa path.join(__dirname, "carpeta")\n\n` +
      `═══ EJEMPLO CORRECTO (carpeta multimedia + comando) ═══\n` +
      `ACCION: CREAR | RUTA: multimedia/.gitkeep | MOTIVO: almacén de archivos\n<<CONTENIDO>>\n# multimedia\n<<FIN>>\n` +
      `ACCION: CREAR | RUTA: commands/multimedia.js | MOTIVO: lógica listmultimedia\n<<CONTENIDO>>\n` +
      `(module.exports con fs.readdir path.join(__dirname,'../multimedia'))\n<<FIN>>\n` +
      `ACCION: MODIFICAR | RUTA: index.js | MOTIVO: registrar comando\n<<CONTENIDO>>\n` +
      `(index.js COMPLETO: require commands/multimedia, añadir a commands{})\n<<FIN>>\n\n` +
      `═══ EJEMPLO INCORRECTO (NUNCA) ═══\n` +
      `❌ Meter fs.readdir y todo el comando solo dentro de index.js sin crear commands/multimedia.js\n\n` +
      `═══ EJEMPLO CORRECTO (crear chatbot.js) ═══\n` +
      `Petición: "crear archivo chatbot"\n` +
      `ACCION: CREAR | RUTA: chatbot.js | MOTIVO: respuestas por palabras clave\n<<CONTENIDO>>\n(module.exports…)\n<<FIN>>\n` +
      `ACCION: MODIFICAR | RUTA: index.js | MOTIVO: require chatbot\n<<CONTENIDO>>\n(index.js COMPLETO)\n<<FIN>>\n\n` +
      `═══ EJEMPLO INCORRECTO (NUNCA) ═══\n` +
      `❌ ACCION: CREAR | RUTA: Nuevas respuestas basadas en palabras clave\n` +
      `❌ ACCION: CREAR | RUTA: documentacion.md\n` +
      `❌ Solo EXPLICACION con pasos sin ACCION\n\n` +
      `═══ FORMATO DE SALIDA ═══\n` +
      `PLAN:\n<1-3 líneas>\n\n` +
      `EXPLICACION:\n<resumen breve para el usuario>\n\n` +
      `ACCION: MODIFICAR | RUTA: ${profile.primaryEntry} | MOTIVO: <qué hiciste>\n` +
      `<<CONTENIDO>>\n<código COMPLETO del archivo, sin "..." ni omitir líneas>\n` +
      `<<FIN>>\n\n` +
      `ACCION: CREAR | RUTA: src/nuevo.ts | MOTIVO: <solo si no existe archivo donde encajar>\n` +
      `<<CONTENIDO>>\n<código completo>\n` +
      `<<FIN>>\n\n` +
      `COMANDO: npm install paquete | MOTIVO: <solo si hace falta>\n` +
      `<<FIN>>\n\n` +
      `COMANDO: ssh usuario@servidor "systemctl status nginx" | MOTIVO: supervisar servicio remoto\n` +
      `<<FIN>>\n\n` +
      `GITHUB: PUBLICAR | REPO: mi-proyecto | PRIVADO: no | MOTIVO: primera publicación\n` +
      `GITHUB: COMMIT_PUSH | MENSAJE: feat: cambios del agente | MOTIVO: subir al remoto\n` +
      `GITHUB: STATUS | MOTIVO: ver cambios pendientes\n`
    );
  }

  private buildFinalInstruction(
    profile: ProjectProfile,
    env: EnvironmentProfile,
    taskMode: AgentTaskMode
  ): string {
    if (taskMode === 'github') {
      return (
        `Tarea Git/GitHub: emite PLAN + EXPLICACION + bloque(s) GITHUB (PUBLICAR, COMMIT_PUSH o STATUS) ` +
        `según lo que pida el usuario. Si hay cambios de código también, añade ACCION. No digas al usuario que ejecute git manualmente.`
      );
    }
    if (taskMode === 'remote') {
      const sshHint = env.sshTarget
        ? `Usa COMANDO con ssh a ${env.sshTarget} para diagnosticar. `
        : 'Usa COMANDO local para diagnosticar. ';
      return (
        `${sshHint}Devuelve PLAN + EXPLICACION con hallazgos + COMANDO(s) de diagnóstico/mejora. ` +
        `Si hace falta script o config, usa ACCION en .sh/.conf/.yml. No crees .md.`
      );
    }
    if (taskMode === 'mixed') {
      return (
        `Combina ACCION en "${profile.primaryEntry}" (o .js/.ts/.sh correcto) CON COMANDO(s) ` +
        `para supervisar ${env.sshTarget ?? 'el sistema local'}. Si pide GitHub, añade GITHUB. ` +
        `PLAN + EXPLICACION + ACCION + COMANDO.`
      );
    }
    if (profile.moduleToCreate) {
      return (
        `Ollama debe CREAR "${profile.moduleToCreate}" y MODIFICAR "${profile.primaryEntry}". ` +
        `Dos bloques ACCION con <<CONTENIDO>> completo. La extensión aplicará los cambios — no digas al usuario que lo haga.`
      );
    }
    if (profile.architecture && (profile.architecture.modulesToCreate.length > 0 || profile.architecture.folders.length > 0)) {
      const arch = profile.architecture;
      return (
        `Arquitectura obligatoria: ${arch.summary} ` +
        `Emite ACCION CREAR para cada carpeta (.gitkeep) y módulo (${arch.modulesToCreate.join(', ') || 'según plan'}), ` +
        `luego ACCION MODIFICAR ${profile.primaryEntry} solo para require/registro. Sin \`\`\` en <<CONTENIDO>>.`
      );
    }
    return (
      `Distribuye en módulos con sentido común; ${profile.primaryEntry} solo cablea. ` +
      `PLAN + EXPLICACION + ACCION con <<CONTENIDO>> completo.`
    );
  }

  private buildAgentUserMessage(
    userPrompt: string,
    rootPath: string,
    profile: ProjectProfile,
    env: EnvironmentProfile,
    taskMode: AgentTaskMode,
    contextBlock: string,
    webContext: string,
    githubContext = ''
  ): string {
    const modeLabel = taskMode === 'code' ? 'programación'
      : taskMode === 'remote' ? 'supervisión/SSH'
        : taskMode === 'github' ? 'Git/GitHub'
          : 'código + servidor/Git';

    return (
      `═══ TAREA ═══\n` +
      `"${userPrompt}"\n\n` +
      `═══ ENTORNO ═══\n` +
      `SO local: ${env.localOs}\n` +
      (env.sshTarget ? `SSH remoto: ${this.formatSshDisplay(env)}\n` : 'SSH: no configurado (solo local)\n') +
      `Modo: ${modeLabel}\n\n` +
      (githubContext ? `═══ ESTADO GIT/GITHUB ═══\n${githubContext}\n\n` : '') +
      `═══ PROYECTO ═══\n` +
      `Ruta: ${rootPath}\n` +
      `Tipo: ${profile.type}\n` +
      `Archivo principal: **${profile.primaryEntry}**\n` +
      `${profile.hint}\n` +
      (profile.architecture
        ? `\n═══ ARQUITECTURA ESPERADA ═══\n${profile.architecture.summary}\n` +
          `Crear: ${profile.architecture.modulesToCreate.join(', ') || '(módulos según necesidad)'}\n` +
          `Modificar (solo cablear): ${profile.architecture.filesToModify.join(', ')}\n\n`
        : '\n') +
      (webContext ? `═══ INVESTIGACIÓN WEB ═══\n${webContext}\n\n` : '') +
      `═══ CÓDIGO ACTUAL (léelo antes de modificar) ═══\n` +
      (contextBlock || '(vacío — crea con ACCION: CREAR)') +
      `\n\n═══ INSTRUCCIÓN FINAL ═══\n` +
      this.buildFinalInstruction(profile, env, taskMode)
    );
  }

  private async generateSolutionWithRetry(
    userPrompt:   string,
    projectTree:  string[],
    fileContents: Record<string, string>,
    rootPath:     string,
    entryPoints:  string[],
    model?:       string,
    webContext = '',
    githubContext = '',
    projectName = 'proyecto',
    onProgress?:  (msg: string) => void
  ): Promise<AgentResult> {
    const contextBlock = Object.entries(fileContents)
      .map(([fp, content]) => {
        const relPath = fp.replace(rootPath, '').replace(/^\//, '');
        return `### Archivo: ${relPath}\n\`\`\`\n${content}\n\`\`\``;
      })
      .join('\n\n');

    const profile = this.buildProjectProfile(rootPath, entryPoints, fileContents, userPrompt, projectTree);
    const env = this.buildEnvironmentProfile();
    const taskMode = this.classifyTask(userPrompt);
    const baseUserMessage = this.buildAgentUserMessage(
      userPrompt, rootPath, profile, env, taskMode, contextBlock, webContext, githubContext
    );

    const attempts = [0, 1, 2];
    let lastResult: AgentResult = { explanation: '', actions: [], commands: [], githubTools: [] };

    for (const attempt of attempts) {
      const strict = attempt > 0;
      if (strict) {
        onProgress?.('🔄 Ollama no generó respuesta válida; reintentando con prompt estricto...');
      }
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: this.buildAgentSystemPrompt(strict, profile, env, taskMode, githubContext) },
        { role: 'user',   content: baseUserMessage },
      ];

      if (attempt === 1) {
        const archHint = profile.architecture?.summary ?? '';
        const retryHint = taskMode === 'github'
          ? `CORRECCIÓN: emite GITHUB: PUBLICAR, GITHUB: COMMIT_PUSH o GITHUB: STATUS según la petición. Sin decir al usuario que lo haga manualmente.`
          : taskMode === 'remote'
          ? `CORRECCIÓN: emite COMANDO(s) de diagnóstico` +
            (env.sshTarget ? ` con ssh a ${env.sshTarget}` : '') +
            ` y EXPLICACION con hallazgos. Sin .md.`
          : profile.moduleToCreate
            ? `CORRECCIÓN: CREAR ${profile.moduleToCreate} (lógica) + MODIFICAR ${profile.primaryEntry} (solo require). Dos ACCION.`
            : profile.architecture?.modulesToCreate.length
              ? `CORRECCIÓN ARQUITECTURA: ${archHint} ` +
                `CREA ${profile.architecture.modulesToCreate.join(' y ')} con la lógica. ` +
                `${profile.primaryEntry} solo registra/require — NO metas toda la funcionalidad ahí.`
              : `CORRECCIÓN: ACCION con <<CONTENIDO>> completo (sin \`\`\`). Módulos separados si la tarea es grande.`;
        messages.push({ role: 'user', content: retryHint });
      } else if (attempt === 2) {
        const sshPrefix = this.formatSshInvoke(env);
        const arch = profile.architecture;
        const modBlock = arch?.modulesToCreate.length
          ? arch.modulesToCreate.map((m) =>
              `ACCION: CREAR | RUTA: ${m} | MOTIVO: módulo\n<<CONTENIDO>>\n(module.exports…)\n<<FIN>>\n`
            ).join('\n') + '\n'
          : '';
        const folderBlock = arch?.folders.length
          ? arch.folders.map((f) =>
              `ACCION: CREAR | RUTA: ${f}/.gitkeep | MOTIVO: carpeta\n<<CONTENIDO>>\n# ${f}\n<<FIN>>\n`
            ).join('\n') + '\n'
          : '';
        const template = taskMode === 'github'
          ? `EXPLICACION:\nPublicando en GitHub.\n\n` +
            `GITHUB: PUBLICAR | REPO: ${projectName} | PRIVADO: no | MOTIVO: publicar proyecto\n`
          : taskMode === 'remote'
          ? `EXPLICACION:\nDiagnóstico del servidor.\n\n` +
            `COMANDO: ${sshPrefix ? `${sshPrefix} "uptime && df -h && free -m"` : 'uptime && df -h && free -m'} | MOTIVO: supervisión\n<<FIN>>\n`
          : profile.moduleToCreate
            ? `EXPLICACION:\nMódulo creado.\n\n` +
              `ACCION: CREAR | RUTA: ${profile.moduleToCreate} | MOTIVO: chatbot\n<<CONTENIDO>>\n\n<<FIN>>\n\n` +
              `ACCION: MODIFICAR | RUTA: ${profile.primaryEntry} | MOTIVO: conectar\n<<CONTENIDO>>\n\n<<FIN>>\n`
            : `EXPLICACION:\nImplementado.\n\n` +
              folderBlock + modBlock +
              `ACCION: MODIFICAR | RUTA: ${profile.primaryEntry} | MOTIVO: cablear módulos\n<<CONTENIDO>>\n`;
        messages.push({ role: 'user', content: `ÚLTIMO INTENTO — arquitectura modular:\n\n${template}` });
      }

      let fullResponse = '';
      await this.ollama.agentChatStream(
        messages,
        (token) => { fullResponse += token; },
        model
      );

      lastResult = this.parseAgentResponse(fullResponse, userPrompt, entryPoints, rootPath, projectName);
      const refused = this.isRefusalResponse(lastResult.explanation);
      const needsWork = taskMode === 'github'
        ? this.looksLikeGitHubTask(userPrompt)
        : this.looksLikeImplementationTask(userPrompt);
      const hasWork = lastResult.actions.length > 0 ||
        lastResult.commands.length > 0 ||
        lastResult.githubTools.length > 0;
      const moduleOk = !profile.moduleToCreate ||
        lastResult.actions.some((a) => a.filePath.includes(profile.moduleToCreate!));
      const foldersOk = this.foldersCovered(
        lastResult.actions,
        profile.foldersToCreate ?? []
      );
      const archOk = profile.architecture
        ? this.architectureSatisfied(lastResult.actions, profile.architecture, profile.primaryEntry)
        : true;

      if ((hasWork && moduleOk && foldersOk && archOk) || !needsWork || (!refused && attempt === attempts.length - 1)) {
        return lastResult;
      }

      if (!archOk) {
        onProgress?.('🔄 Ollama metió todo en index.js — reintentando con arquitectura modular...');
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
  private parseAgentResponse(
    raw: string,
    userPrompt: string,
    entryPoints: string[],
    rootPath: string,
    projectName = 'proyecto'
  ): AgentResult {
    const explanationMatch = raw.match(/EXPLICACI[OÓ]N:\s*([\s\S]*?)(?=ACCION:|COMANDO:|GITHUB:|$)/i);
    const explanation      = explanationMatch ? explanationMatch[1].trim() : raw.trim();

    const actions      = this.parseFileActions(raw);
    const commands     = this.parseCommandActions(raw);
    const githubTools  = this.parseGitHubToolActions(raw);

    if (actions.length === 0) {
      actions.push(...this.parseMarkdownFileFallback(raw));
    }

    if (actions.length === 0) {
      actions.push(...this.parseOrphanCodeBlocks(raw, entryPoints, rootPath, userPrompt));
    }

    const sanitized = this.sanitizeFileActions(actions, userPrompt, entryPoints, rootPath);
    const withFolders = this.injectFolderCreateActions(sanitized, userPrompt);
    const withCommands = this.injectFolderCommands(commands, userPrompt);
    const withGitHub = this.injectGitHubToolActions(githubTools, userPrompt, projectName);

    return {
      explanation,
      actions:     withFolders,
      commands:    withCommands,
      githubTools: withGitHub,
    };
  }

  private parseGitHubToolActions(raw: string): GitHubToolAction[] {
    const actions: GitHubToolAction[] = [];
    const lineRegex = /GITHUB:\s*(PUBLICAR|COMMIT_PUSH|STATUS)\s*(.+?)(?=\n|$)/gi;

    let match: RegExpExecArray | null;
    while ((match = lineRegex.exec(raw)) !== null) {
      const [, tipoRaw, rest] = match;
      const tipo = tipoRaw.toUpperCase();
      const parts = rest.split('|').map((p) => p.trim()).filter(Boolean);
      const fields: Record<string, string> = {};

      for (const part of parts) {
        const kv = part.match(/^([\wÁÉÍÓÚáéíóú]+):\s*(.+)$/i);
        if (kv) {
          fields[kv[1].toUpperCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
        }
      }

      const reason = fields.MOTIVO ?? fields.RAZON ?? 'Acción GitHub del agente';

      if (tipo === 'PUBLICAR') {
        actions.push({
          type:      'publish',
          repoName:  fields.REPO ?? fields.NOMBRE,
          isPrivate: /^(s[ií]|yes|true|1)$/i.test(fields.PRIVADO ?? fields.PRIVATE ?? 'no'),
          reason,
        });
      } else if (tipo === 'COMMIT_PUSH') {
        actions.push({
          type:    'commit_push',
          message: fields.MENSAJE ?? fields.MESSAGE ?? fields.MSG,
          reason,
        });
      } else if (tipo === 'STATUS') {
        actions.push({ type: 'status', reason });
      }
    }

    return actions;
  }

  /** Si el usuario pidió GitHub y Ollama no emitió GITHUB:, inyecta la acción. */
  private injectGitHubToolActions(
    tools: GitHubToolAction[],
    userPrompt: string,
    projectName: string
  ): GitHubToolAction[] {
    if (!this.github) { return tools; }

    const result = [...tools];

    const wantsPublish =
      /\b(publica(?:r)?|sube(?:r)?|subir|crea(?:r)?)\b.*\b(github|repositorio|repo)\b/i.test(userPrompt) ||
      /\b(github|repositorio)\b.*\b(publica(?:r)?|sube(?:r)?|crea(?:r)?)\b/i.test(userPrompt);

    if (wantsPublish && !result.some((t) => t.type === 'publish')) {
      result.push({
        type:      'publish',
        repoName:  projectName,
        isPrivate: /\b(privad[oa]|private)\b/i.test(userPrompt),
        reason:    'Publicar en GitHub (auto-inyectado)',
      });
    }

    const wantsCommitPush =
      /\b(commit|push|sube(?:r)?\s+(?:los\s+)?cambios|subir\s+cambios)\b/i.test(userPrompt) &&
      !/\b(solo\s+status|git\s+status|estado\s+git)\b/i.test(userPrompt);

    if (wantsCommitPush && !result.some((t) => t.type === 'commit_push')) {
      const msgMatch = userPrompt.match(/(?:mensaje|message)\s+["']([^"']+)["']/i) ??
        userPrompt.match(/commit\s+["']([^"']+)["']/i);
      result.push({
        type:    'commit_push',
        message: msgMatch?.[1] ?? 'Update from Local Copilot',
        reason:  'Commit y push (auto-inyectado)',
      });
    }

    if (/\b(git\s+status|estado\s+(?:de\s+)?git|cambios\s+pendientes)\b/i.test(userPrompt) &&
        !result.some((t) => t.type === 'status')) {
      result.push({ type: 'status', reason: 'Git status (auto-inyectado)' });
    }

    return result;
  }

  private async executeGitHubTools(
    tools: GitHubToolAction[],
    rootPath: string,
    projectName: string,
    onProgress: (msg: string) => void
  ): Promise<void> {
    if (!this.github) { return; }

    for (const tool of tools) {
      onProgress(`🐙 ${tool.type}: ${tool.reason}`);
      try {
        let ghResult;
        switch (tool.type) {
          case 'publish':
            ghResult = await this.github.publishForAgent(
              rootPath,
              tool.repoName ?? projectName,
              tool.isPrivate ?? false
            );
            break;
          case 'commit_push':
            ghResult = await this.github.commitAndPushForAgent(
              rootPath,
              tool.message ?? 'Update from Local Copilot'
            );
            break;
          case 'status':
            ghResult = await this.github.gitStatusForAgent(rootPath);
            break;
        }
        if (ghResult) {
          const icon = ghResult.ok ? '✅' : '❌';
          onProgress(`${icon} ${ghResult.message}`);
          if (ghResult.url) {
            onProgress(`🔗 ${ghResult.url}`);
          }
          this.outputChannel.appendLine(`[GITHUB ${tool.type}] ${ghResult.message}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        onProgress(`❌ GitHub error: ${msg}`);
        this.outputChannel.appendLine(`[GITHUB error] ${msg}`);
      }
    }

    if (tools.length > 0) {
      this.outputChannel.show(true);
    }
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

    if (actions.length === 0) {
      const noMotivoRegex =
        /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\n<<CONTENIDO>>([\s\S]*?)<<FIN>>/gi;
      while ((match = noMotivoRegex.exec(raw)) !== null) {
        const [, tipoRaw, rutaRaw, contenido] = match;
        actions.push({
          type:     ACTION_TYPE_MAP[tipoRaw.toUpperCase()] ?? 'modify',
          filePath: rutaRaw.trim(),
          content:  contenido.replace(/^\n/, '').replace(/\n$/, ''),
          reason:   'Ollama: ACCION sin MOTIVO',
        });
      }
    }

    if (actions.length === 0) {
      const inlineRegex =
        /ACCION:\s*(CREAR|MODIFICAR|ELIMINAR)\s*\|\s*RUTA:\s*(.+?)\s*\|\s*CONTENIDO:\s*(.+?)\s*\|\s*MOTIVO:\s*(.+?)(?=\n|$)/gi;
      while ((match = inlineRegex.exec(raw)) !== null) {
        const [, tipoRaw, rutaRaw, contenido, motivo] = match;
        actions.push({
          type:     ACTION_TYPE_MAP[tipoRaw.toUpperCase()] ?? 'modify',
          filePath: rutaRaw.trim(),
          content:  contenido.trim(),
          reason:   motivo.trim(),
        });
      }
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

  /** Fallback: extrae bloques markdown solo si el comentario indica ruta válida. */
  private parseMarkdownFileFallback(raw: string): FileAction[] {
    const actions: FileAction[] = [];
    const blockRegex = /```[\w]*\s*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(raw)) !== null) {
      const block = match[1];
      const explicitMatch = block.match(
        /^(?:\/\/|#|<!--)\s*(?:file:|archivo:)\s*([^\n*]+)/im
      );
      const filePath = explicitMatch?.[1]?.trim();
      if (!filePath || !this.isValidFilePath(filePath)) { continue; }

      const content = block.replace(explicitMatch![0], '').trim();
      if (!content) { continue; }

      actions.push({
        type:     'modify',
        filePath,
        content,
        reason:   'Código generado por el agente (bloque markdown con file:)'
      });
    }

    return actions;
  }

  /**
   * Si el modelo pegó código en un bloque ``` sin ACCION, lo asigna al archivo principal.
   */
  private parseOrphanCodeBlocks(
    raw: string,
    entryPoints: string[],
    rootPath: string,
    userPrompt: string
  ): FileAction[] {
    if (!entryPoints.length) { return []; }

    const primaryEntry = path.relative(rootPath, entryPoints[0]).replace(/\\/g, '/');
    const actions: FileAction[] = [];
    const blockRegex = /```[\w]*\s*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(raw)) !== null) {
      const content = match[1].trim();
      if (!this.looksLikeSourceCode(content) || this.looksLikeDocumentationOnly(content)) {
        continue;
      }

      const isChatbotModule =
        /\b(chatbotResponses|findChatbotResponse|module\.exports)\b/.test(content) &&
        !/require\(['"]discord\.js['"]\)/.test(content);

      if (this.wantsNewModuleFile(userPrompt) && isChatbotModule) {
        actions.push({
          type:     'create',
          filePath: 'chatbot.js',
          content,
          reason:   'Ollama: módulo chatbot (bloque sin ACCION)',
        });
        continue;
      }

      actions.push({
        type:     'modify',
        filePath: primaryEntry,
        content,
        reason:   'Ollama: código aplicado en archivo principal',
      });
      break;
    }

    return actions;
  }

  /** Punto(s) de entrada del proyecto (package.json main, index.js, etc.). */
  private async getProjectEntryPoints(rootPath: string): Promise<string[]> {
    const candidates: string[] = [];

    for (const name of ['index.js', 'index.ts', 'main.py', 'app.py', 'src/index.js', 'src/index.ts']) {
      const full = path.join(rootPath, name);
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(full));
        candidates.push(full);
      } catch { /* no existe */ }
    }

    try {
      const pkgUri = vscode.Uri.file(path.join(rootPath, 'package.json'));
      const raw = Buffer.from(await vscode.workspace.fs.readFile(pkgUri)).toString('utf-8');
      const main = JSON.parse(raw).main as string | undefined;
      if (main) {
        const full = path.join(rootPath, main);
        if (!candidates.includes(full)) { candidates.push(full); }
      }
    } catch { /* sin package.json */ }

    return candidates;
  }

  private isValidFilePath(filePath: string): boolean {
    const normalized = filePath.trim().replace(/\\/g, '/');
    if (!normalized || normalized.includes('..')) { return false; }

    const base = path.posix.basename(normalized);
    if (base.includes(' ')) { return false; }

    if (KNOWN_FILENAMES.has(base)) { return true; }

    const ext = path.posix.extname(base);
    if (ext && RELEVANT_EXTENSIONS.has(ext.toLowerCase())) { return true; }

    return PATH_HINT_RE.test(normalized);
  }

  private wantsDocumentation(userPrompt: string): boolean {
    return /\b(readme|documentaci[oó]n|documentar|changelog|gu[ií]a|manual|\.md\b)\b/i.test(userPrompt);
  }

  private isValidCodeWritePath(filePath: string, userPrompt: string): boolean {
    if (!this.isValidFilePath(filePath)) { return false; }

    const base = path.posix.basename(filePath.trim().replace(/\\/g, '/'));
    const ext  = path.posix.extname(base).toLowerCase();

    if (DOC_EXTENSIONS.has(ext) && !this.wantsDocumentation(userPrompt)) {
      return false;
    }

    const infraExt = new Set(['.sh', '.bash', '.ps1', '.bat', '.conf', '.cfg', '.ini', '.service', '.timer', '.yml', '.yaml']);
    if (this.wantsInfraFiles(userPrompt) && infraExt.has(ext)) { return true; }

    if (ext && CODE_EXTENSIONS.has(ext)) { return true; }
    if (KNOWN_FILENAMES.has(base) && base !== 'README.md') { return true; }
    if (base === '.gitkeep' || base === '.keep') { return true; }

    return PATH_HINT_RE.test(filePath);
  }

  /** ¿Las carpetas pedidas tienen al menos un archivo en las acciones? */
  private foldersCovered(actions: FileAction[], folders: string[]): boolean {
    if (folders.length === 0) { return true; }
    const paths = actions.map((a) => a.filePath.replace(/\\/g, '/').toLowerCase());
    return folders.every((f) =>
      paths.some((p) => p === f || p.startsWith(`${f}/`))
    );
  }

  /** Si el modelo no emitió mkdir, la extensión lo añade. */
  private injectFolderCommands(
    commands: CommandAction[],
    userPrompt: string
  ): CommandAction[] {
    const folders = this.extractRequestedFolders(userPrompt);
    if (folders.length === 0) { return commands; }

    const result = [...commands];
    for (const folder of folders) {
      const hasMkdir = result.some((c) =>
        /\bmkdir\b/.test(c.command) && c.command.includes(folder)
      );
      if (!hasMkdir) {
        result.unshift({
          command: `mkdir -p ${folder}`,
          reason:  `Crear carpeta ${folder} (auto por Local Copilot)`,
        });
      }
    }
    return result;
  }

  /** MODIFICAR en archivo inexistente → CREAR. */
  private async normalizeActionTypes(
    actions: FileAction[],
    rootPath: string
  ): Promise<FileAction[]> {
    const out: FileAction[] = [];
    for (const action of actions) {
      if (action.type === 'delete') {
        out.push(action);
        continue;
      }
      const fullPath = path.isAbsolute(action.filePath)
        ? action.filePath
        : path.join(rootPath, action.filePath);
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
        out.push(action);
      } catch {
        out.push({ ...action, type: 'create' });
        this.outputChannel.appendLine(
          `[CREATE] ${action.filePath} no existía — tratado como CREAR`
        );
      }
    }
    return out;
  }

  private looksLikeSourceCode(content: string): boolean {
    return /\b(require\s*\(|import\s+[\w{]|module\.exports|export\s+(default\s+)?|function\s+\w+|const\s+\w+\s*=|class\s+\w+|def\s+\w+|public\s+(static\s+)?void)\b/m
      .test(content);
  }

  private looksLikeDocumentationOnly(content: string): boolean {
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) { return true; }

    const markdownLines = lines.filter((l) =>
      /^\s*(#{1,6}\s|\*\*|[-*]\s|\d+\.\s+\*\*)/.test(l)
    ).length;

    return !this.looksLikeSourceCode(content) &&
      (markdownLines >= 2 || /^(para|vamos a|pasos:|acciones:)/i.test(content.trim()));
  }

  /**
   * Filtra documentación y rutas inválidas; redirige código suelto al archivo principal.
   */
  private sanitizeFileActions(
    actions: FileAction[],
    userPrompt: string,
    entryPoints: string[],
    rootPath: string
  ): FileAction[] {
    const impl = this.looksLikeImplementationTask(userPrompt);
    const primaryEntry = entryPoints[0]
      ? path.relative(rootPath, entryPoints[0]).replace(/\\/g, '/')
      : null;

    const result: FileAction[] = [];

    for (let action of actions) {
      let filePath = action.filePath.trim();

      if (action.content && this.looksLikeDocumentationOnly(action.content)) {
        this.outputChannel.appendLine(
          `[SKIP] Contenido es documentación, no código: "${filePath}"`
        );
        continue;
      }

      if (!this.isValidCodeWritePath(filePath, userPrompt)) {
        const archModule = this.inferModulePathFromPrompt(userPrompt);
        if (impl && archModule && action.content && this.looksLikeSourceCode(action.content)) {
          this.outputChannel.appendLine(
            `[REDIRECT] "${filePath}" → ${archModule} (módulo dedicado, no index.js)`
          );
          filePath = archModule;
          action = { ...action, filePath, type: 'create' };
        } else if (impl && primaryEntry && action.content && this.looksLikeSourceCode(action.content)) {
          this.outputChannel.appendLine(
            `[REDIRECT] "${filePath}" → ${primaryEntry} (código válido, ruta inválida)`
          );
          filePath = primaryEntry;
          action = { ...action, filePath, type: 'modify' };
        } else {
          this.outputChannel.appendLine(
            `[SKIP] Ruta no válida para código: "${filePath}" — ${action.reason}`
          );
          continue;
        }
      }

      if (impl && !this.isValidCodeWritePath(filePath, userPrompt)) {
        continue;
      }

      const content = action.content
        ? this.stripMarkdownFromContent(action.content)
        : action.content;

      result.push({ ...action, filePath, content });
    }

    return result;
  }

  private looksLikeImplementationTask(prompt: string): boolean {
    return /\b(crea|crear|arregla|arreglar|fix|corrige|publica|publicar|sube|subir|implementa|modifica|escribe|genera|deploy|commit|push|github|git|revisa|revisar|analiza|analizar|inspecciona|programa|programar|mejora|mejorar|refactoriza|refactorizar|añade|agrega|instala|configura|actualiza|chatbot|bot|api|endpoint|componente|funci[oó]n|carpeta|caperta|directorio|folder|multimedia)\b/i
      .test(prompt);
  }

  private wantsInfraFiles(userPrompt: string): boolean {
    return this.looksLikeRemoteTask(userPrompt) ||
      /\b(nginx|apache|systemd|docker|compose|cron|firewall|ufw|\.sh|script|backup)\b/i.test(userPrompt);
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
      result.commands.length > 0 ? `${result.commands.length} comando(s)` : '',
      result.githubTools.length > 0 ? `${result.githubTools.length} acción(es) GitHub` : '',
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
    const blocked = /\b(rm\s+-rf\s+\/|rm\s+-rf\s+~\s*$|mkfs|dd\s+if=|:(){ :|:& };:|>\s*\/dev\/sd|shutdown\s+-h\s+now|init\s+0|format\s+c:)\b/;
    if (blocked.test(normalized)) { return false; }
    if (/^sudo\s+(rm|mkfs|dd|shutdown|reboot|init|halt)\b/.test(normalized)) { return false; }

    const allowedPrefixes = [
      // Desarrollo
      'git ', 'gh ', 'npm ', 'npx ', 'node ', 'yarn ', 'pnpm ', 'bun ',
      'python ', 'python3 ', 'pip ', 'pip3 ', 'cargo ', 'go ', 'ollama ',
      'mkdir ', 'cp ', 'mv ', 'touch ', 'chmod ', 'make ', 'cmake ',
      // Contenedores
      'docker ', 'docker-compose ', 'podman ', 'kubectl ', 'helm ',
      // SSH y remoto
      'ssh ', 'scp ', 'rsync ', 'sftp ',
      // Linux / Ubuntu
      'sudo ', 'systemctl ', 'journalctl ', 'service ', 'apt ', 'apt-get ',
      'dpkg ', 'ufw ', 'firewall-cmd ', 'nginx ', 'apache2ctl ', 'a2enmod ',
      'crontab ', 'timedatectl ', 'hostnamectl ', 'lsb_release ', 'uname ',
      'df ', 'du ', 'free ', 'top ', 'htop ', 'ps ', 'pgrep ', 'kill ',
      'ss ', 'netstat ', 'lsof ', 'ip ', 'ifconfig ', 'ping ', 'curl ', 'wget ',
      'cat ', 'grep ', 'find ', 'ls ', 'head ', 'tail ', 'wc ', 'sort ', 'awk ',
      'sed ', 'tar ', 'gzip ', 'gunzip ', 'zip ', 'unzip ', 'certbot ',
      'fail2ban-client ', 'redis-cli ', 'mysql ', 'mariadb ', 'psql ',
      // Windows
      'powershell ', 'pwsh ', 'cmd ', 'wsl ', 'ipconfig ', 'systeminfo ',
      'get-service ', 'get-process ', 'get-eventlog ', 'test-netconnection ',
      // macOS
      'brew ', 'launchctl ',
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
  /** Comprueba en disco que los cambios de Ollama se aplicaron de verdad. */
  private async verifyAppliedActions(
    actions: FileAction[],
    rootPath: string,
    onProgress: (msg: string) => void
  ): Promise<void> {
    for (const action of actions) {
      if (action.type === 'delete') { continue; }
      const fullPath = path.isAbsolute(action.filePath)
        ? action.filePath
        : path.join(rootPath, action.filePath);
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
        onProgress(`✅ En disco: ${action.filePath}`);
      } catch {
        onProgress(`❌ NO creado: ${action.filePath} — reintenta o revisa Output → Local Copilot`);
      }
    }
  }

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
