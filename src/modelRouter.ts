/** Selección automática del mejor modelo Ollama por tarea. */

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
  'local-copilot-turbo',
  'qwen2.5:14b',
  'qwen2.5-coder:7b',
  'mistral:7b',
  'llama3.1:8b',
  'llama3.2',
  'deepseek-coder:6.7b',
  'gemma2:9b',
];

const AGENT_ORDER = [
  'qwen2.5-coder:14b',
  'qwen2.5-coder:7b',
  'deepseek-coder:6.7b',
  'codellama:13b',
  'local-copilot-turbo',
  'starcoder2:15b',
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

/** Elige el mejor modelo instalado para cada tarea. */
export function pickTaskModels(installed: string[]): TaskModels | null {
  if (!installed.length) { return null; }
  const completion = pickFromOrder(installed, COMPLETION_ORDER) ?? installed[0];
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

  return {
    chat: pick(hwPlan.chat, CHAT_ORDER),
    completion: pick(hwPlan.completion, COMPLETION_ORDER),
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