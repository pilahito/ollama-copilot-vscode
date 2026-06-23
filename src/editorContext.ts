/**
 * Contexto del editor activo para el chat y el agente.
 * Guarda el último editor de código aunque el foco esté en el chat (webview).
 */
import * as vscode from 'vscode';

const MAX_EDITOR_CHARS = 8_000;

let lastCodeEditor: vscode.TextEditor | undefined;

export interface EditorContext {
  code:     string;
  filePath: string;
  language: string;
  source:   'selection' | 'visible' | 'file' | 'none';
}

/** Registrar al activar la extensión — imprescindible para leer código con foco en el chat. */
export function initEditorContextTracking(context: vscode.ExtensionContext): void {
  lastCodeEditor = resolveCodeEditor() ?? undefined;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isCodeEditor(editor)) {
        lastCodeEditor = editor;
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      const found = editors.find(isCodeEditor);
      if (found) { lastCodeEditor = found; }
    })
  );
}

function isCodeEditor(editor: vscode.TextEditor): boolean {
  const scheme = editor.document.uri.scheme;
  return scheme === 'file' || scheme === 'untitled' || scheme === 'vscode-remote';
}

/** Editor activo o último editor de código (el chat roba el foco). */
export function resolveCodeEditor(): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active && isCodeEditor(active)) { return active; }

  if (lastCodeEditor && !lastCodeEditor.document.isClosed && isCodeEditor(lastCodeEditor)) {
    return lastCodeEditor;
  }

  const visible = vscode.window.visibleTextEditors.filter(isCodeEditor);
  if (visible.length === 0) { return undefined; }
  if (visible.length === 1) { return visible[0]; }

  const withContent = visible
    .filter((e) => e.document.getText().trim().length > 0)
    .sort((a, b) => b.document.getText().length - a.document.getText().length);
  return withContent[0] ?? visible[0];
}

/** El usuario pide diagnosticar o corregir algo que falla (modo Profesor). */
export function wantsTeacherFix(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /\b(falla|fallando|falla|error|errores|no funciona|no marcha|no va|roto|bug|bugs|corregir|corrige|corrije|arregla|arreglar|arreglame|fix|fixed|repara|reparar|est[aá]\s+mal|mal\s+esto|no compila|syntax|typeerror|referenceerror|excepci[oó]n|crash|depura|debug|debuggear|soluciona|solucionar|qu[eé]\s+est[aá]\s+mal|por\s+qu[eé]\s+falla|por\s+qu[eé]\s+no)\b/i
    .test(t);
}

/** Errores y avisos del Problems panel para un archivo. */
export function getDiagnosticsBlock(filePath: string): string {
  if (!filePath) { return ''; }
  try {
    const uri = vscode.Uri.file(filePath);
    const diags = vscode.languages.getDiagnostics(uri);
    if (!diags.length) { return ''; }

    return diags
      .map((d) => {
        const icon = d.severity === vscode.DiagnosticSeverity.Error
          ? '❌ ERROR'
          : d.severity === vscode.DiagnosticSeverity.Warning
            ? '⚠️ AVISO'
            : 'ℹ️ INFO';
        const line = d.range.start.line + 1;
        const col  = d.range.start.character + 1;
        const code = d.code ? ` [${d.code}]` : '';
        return `${icon} línea ${line}:${col}${code} — ${d.message}`;
      })
      .join('\n');
  } catch {
    return '';
  }
}

/** Peticiones que requieren código del editor abierto (solo modo Chat). */
export function needsEditorContext(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (/explica.*c[oó]digo|explain.*code|qu[eé] hace este/i.test(t)) { return true; }
  return /\b(explica|explain|qué hace|que hace|what does|para qué sirve|genera|generar|arregla|fix|corrige|refactoriza|refactor|este código|this code|el código|la función|analiza este|revisa este|mejora este|optimiza este|genera tests|documenta este|debug|depura)\b/i
    .test(text);
}

function guessLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', java: 'java', kt: 'kotlin', go: 'go', rs: 'rust',
    php: 'php', rb: 'ruby', cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c',
    sh: 'bash', sql: 'sql', json: 'json', yml: 'yaml', yaml: 'yaml',
    html: 'html', css: 'css', scss: 'scss', vue: 'vue', svelte: 'svelte',
    md: 'markdown', xml: 'xml', toml: 'toml', dockerfile: 'dockerfile',
  };
  if (filePath.toLowerCase().endsWith('dockerfile')) { return 'dockerfile'; }
  return map[ext] ?? (ext || 'text');
}

/** Lee selección, zona visible o archivo activo (en ese orden). */
export function getEditorContext(): EditorContext {
  const editor = resolveCodeEditor();
  if (!editor) {
    return { code: '', filePath: '', language: 'text', source: 'none' };
  }

  const doc = editor.document;
  const filePath = doc.uri.fsPath;
  const language = guessLanguage(filePath);

  if (!editor.selection.isEmpty) {
    return {
      code: doc.getText(editor.selection).trim(),
      filePath,
      language,
      source: 'selection',
    };
  }

  const visible = editor.visibleRanges
    .map((r) => doc.getText(r))
    .join('\n')
    .trim();

  if (visible.length > 0) {
    return {
      code: visible.slice(0, MAX_EDITOR_CHARS),
      filePath,
      language,
      source: 'visible',
    };
  }

  const full = doc.getText().trim();
  return {
    code: full.slice(0, MAX_EDITOR_CHARS),
    filePath,
    language,
    source: full ? 'file' : 'none',
  };
}

export interface EnrichedMessage {
  text:     string;
  attached: boolean;
  filePath: string;
  source:   EditorContext['source'];
}

/** Añade el código del editor si la petición lo necesita (o force=true). */
export function enrichMessageWithEditor(userText: string, force = false): EnrichedMessage {
  if (!force && !needsEditorContext(userText)) {
    return { text: userText, attached: false, filePath: '', source: 'none' };
  }

  const ctx = getEditorContext();
  if (!ctx.code) {
    return {
      text: userText,
      attached: false,
      filePath: '',
      source: 'none',
    };
  }

  const relPath = vscode.workspace.asRelativePath(ctx.filePath);
  const sourceLabel = ctx.source === 'selection'
    ? 'Código seleccionado'
    : ctx.source === 'visible'
      ? 'Código visible en el editor'
      : 'Archivo abierto en el editor';

  const enriched =
    `${userText}\n\n` +
    `**${sourceLabel}** — \`${relPath}\`:\n` +
    '```' + ctx.language + '\n' +
    ctx.code + '\n' +
    '```\n\n' +
    'Analiza el bloque de código anterior.';

  return { text: enriched, attached: true, filePath: relPath, source: ctx.source };
}

/** Contexto completo del archivo abierto (para corrección del Profesor). */
export function getEditorContextForFix(): EditorContext {
  const editor = resolveCodeEditor();
  if (!editor) {
    return { code: '', filePath: '', language: 'text', source: 'none' };
  }
  const doc = editor.document;
  const filePath = doc.uri.fsPath;
  const full = doc.getText().trim();
  return {
    code: full.slice(0, MAX_EDITOR_CHARS),
    filePath,
    language: guessLanguage(filePath),
    source: 'file',
  };
}