/**
 * Acciones rápidas del editor: explicar, generar, arreglar, refactorizar.
 */

export type EditorQuickAction = 'explain' | 'generate' | 'fix' | 'refactor';

export interface EditorActionSpec {
  mode: 'chat' | 'teacher' | 'agent';
  prompt: string;
  attachEditor: boolean;
  teacherFix: boolean;
}

const SPECS: Record<EditorQuickAction, EditorActionSpec> = {
  explain: {
    mode: 'chat',
    prompt: 'Explica qué hace este código paso a paso, en lenguaje claro',
    attachEditor: true,
    teacherFix: false,
  },
  generate: {
    mode: 'chat',
    prompt:
      'Genera código completo y funcional relacionado con la selección o el archivo abierto. ' +
      'Si falta contexto, propón una implementación útil y organizada por carpetas si aplica.',
    attachEditor: true,
    teacherFix: false,
  },
  fix: {
    mode: 'teacher',
    prompt: 'Arregla los errores de este código y escribe la corrección en el archivo',
    attachEditor: true,
    teacherFix: true,
  },
  refactor: {
    mode: 'agent',
    prompt:
      'Refactoriza el código del archivo abierto: misma funcionalidad, mejor organización, ' +
      'nombres claros y módulos separados. Aplica los cambios en el proyecto.',
    attachEditor: true,
    teacherFix: false,
  },
};

export function getEditorActionSpec(action: EditorQuickAction): EditorActionSpec {
  return SPECS[action];
}

export function editorActionFromSuggestion(text: string): EditorQuickAction | null {
  const t = text.toLowerCase();
  if (/explica/.test(t)) { return 'explain'; }
  if (/genera/.test(t)) { return 'generate'; }
  if (/arregla|fix|error/.test(t)) { return 'fix'; }
  if (/refactor/.test(t)) { return 'refactor'; }
  return null;
}