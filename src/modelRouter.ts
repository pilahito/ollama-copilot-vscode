/** Selección automática del mejor modelo Ollama por tarea. */

import { MODEL_CATALOG } from './modelCatalog';

export type TaskKind = 'chat' | 'completion' | 'agent' | 'teacher';

export interface TaskModels {
  chat: string;
  completion: string;
  agent: string;
}

const norm = (n: string) => n.replace(/:latest$/i, '').trim().toLowerCase();

export const findInstalledModel = (installed: string[], needle: string): string | undefined => {
  if (!needle || !installed.length) { return undefined; }
  const n = norm(needle);
  return installed.find((m) => {
    const b = norm(m);
    return b === n || m === needle || m.startsWith(`${n}:`) || b.includes(n);
  });
};

/** Nombres conocidos de modelos con cadena de pensamiento (aunque no estén en el catálogo). */
const REASONING_NAME_RE =
  /(qwen3|deepseek-r1|deepseek-r2|deepseek-v3\.[12]|qwq|magistral|gpt-oss|nemotron|reasoning|thinking)/i;

/**
 * ¿El modelo razona antes de responder?
 *
 * Estos modelos escriben su cadena de pensamiento (`thinking`) y tardan: valen
 * para chat/agente, pero son **malos para autocompletado** (latencia alta y
 * riesgo de insertar `<think>`). Se consulta el catálogo y, para nombres no
 * catalogados (alias propios, cuantizaciones…), se deduce por el nombre.
 */
export function isReasoningModel(name: string): boolean {
  if (!name) { return false; }
  const n = norm(name);
  const entry = MODEL_CATALOG.find((m) => {
    const b = norm(m.name);
    return n === b || n.startsWith(`${b}:`);
  });
  if (entry?.reasoning) { return true; }
  return REASONING_NAME_RE.test(n);
}

const COMPLETION_ORDER = [
  'qwen2.5-coder:7b',
  'local-copilot-turbo',
  'starcoder2:7b',
  'deepseek-coder:6.7b',
  'codellama:7b',
  'qwen2.5-coder:3b',
  'qwen2.5-coder:1.5b',
  'phi3:mini',
  'gemma2:2b',
  'deepseek-coder:1.3b',
];

const CHAT_ORDER = [
  'qwen2.5-coder:14b',
  'qwen3:14b',
  'local-copilot-turbo',
  'qwen2.5:14b',
  'qwen2.5-coder:7b',
  'qwen3:8b',
  'mistral:7b',
  'llama3.1:8b',
  'llama3.2',
  'deepseek-coder:6.7b',
  'gemma2:9b',
];

const AGENT_ORDER = [
  'qwen2.5-coder:14b',
  'qwen3-coder:30b',
  'qwen3:14b',
  'qwen2.5-coder:7b',
  'gpt-oss:20b',
  'deepseek-coder:6.7b',
  'codellama:13b',
  'local-copilot-turbo',
  'starcoder2:15b',
  'qwen3:8b',
  'llama3.1:8b',
  'mistral:7b',
];

function pickFromOrder(installed: string[], order: string[]): string | null {
  if (!installed.length) { return null; }
  for (const name of order) {
    const hit = findInstalledModel(installed, name);
    if (hit) { return hit; }
  }
  const coder = installed.find((m) => /coder|codellama|deepseek-coder/i.test(m));
  if (coder) { return coder; }
  return installed[0];
}

/**
 * Modelo para autocompletado: descarta los que razonan y prefiere coder/pequeño.
 *
 * Antes se caía a `installed[0]`, que podía ser `deepseek-r1:14b`: el
 * autocompletado se volvía lentísimo e insertaba razonamiento.
 */
export function pickCompletionModel(installed: string[]): string {
  if (!installed.length) { return ''; }
  const fast = installed.filter((m) => !isReasoningModel(m));
  const pool = fast.length ? fast : installed;

  for (const name of COMPLETION_ORDER) {
    const hit = findInstalledModel(pool, name);
    if (hit) { return hit; }
  }
  const coder = pool.find((m) => /coder|codellama|starcoder/i.test(m));
  if (coder) { return coder; }
  const small = pool.find((m) => /(1\.5b|:2b|:3b|:4b|mini|:7b|:8b)/i.test(m));
  return small ?? pool[0];
}

/** Elige el mejor modelo instalado para cada tarea. */
export function pickTaskModels(installed: string[]): TaskModels | null {
  if (!installed.length) { return null; }
  const completion = pickCompletionModel(installed);
  const chat       = pickFromOrder(installed, CHAT_ORDER) ?? completion;
  const agent      = pickFromOrder(installed, AGENT_ORDER) ?? chat;
  return { chat, completion, agent };
}

/** Combina plan por hardware con modelos realmente instalados. */
export function pickTaskModelsWithHardware(
  installed: string[],
  hwPlan: TaskModels
): TaskModels | null {
  if (!installed.length) { return hwPlan; }

  const pick = (preferred: string, order: string[]) =>
    findInstalledModel(installed, preferred) ??
    pickFromOrder(installed, order) ??
    installed[0];

  // El plan por hardware puede proponer un modelo que razona para autocompletar:
  // si hay alternativa rápida instalada, se usa esa.
  const preferredCompletion = findInstalledModel(installed, hwPlan.completion);
  const completion =
    preferredCompletion && !isReasoningModel(preferredCompletion)
      ? preferredCompletion
      : pickCompletionModel(installed);

  return {
    chat: pick(hwPlan.chat, CHAT_ORDER),
    completion,
    agent: pick(hwPlan.agent, AGENT_ORDER),
  };
}

export function modelInstalled(installed: string[], name: string): boolean {
  if (!name) { return false; }
  const base = norm(name);
  return installed.some((m) => norm(m) === base || m.startsWith(`${base}:`) || base.includes(norm(m)));
}

export function resolveTaskModel(
  installed: string[],
  task: TaskKind,
  configured: Partial<TaskModels>
): string {
  const picked = pickTaskModels(installed);
  const fallback = installed[0] ?? 'qwen2.5-coder:7b';

  switch (task) {
    case 'completion':
      return configured.completion && modelInstalled(installed, configured.completion)
        ? configured.completion
        : (picked?.completion ?? fallback);
    case 'agent':
      return configured.agent && modelInstalled(installed, configured.agent)
        ? configured.agent
        : (picked?.agent ?? configured.chat ?? fallback);
    case 'teacher':
    case 'chat':
    default:
      return configured.chat && modelInstalled(installed, configured.chat)
        ? configured.chat
        : (picked?.chat ?? fallback);
  }
}
