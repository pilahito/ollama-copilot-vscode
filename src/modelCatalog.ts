/** Catálogo de modelos Ollama con descripciones en español y casos de uso. */

export type UseCaseId =
  | 'programar'
  | 'servidor'
  | 'chat'
  | 'agente'
  | 'autocompletado'
  | 'enseñar'
  | 'general';

export type TaskAssign = 'chat' | 'completion' | 'agent';

export interface UseCaseInfo {
  id: UseCaseId;
  icon: string;
  label: string;
  description: string;
  bestTask: TaskAssign;
}

export interface ModelCatalogEntry {
  name: string;
  size: string;
  ram: string;
  speed: string;
  description: string;
  bestFor: UseCaseId[];
  tasks: Partial<Record<TaskAssign, boolean>>;
  minTier: 'basic' | 'normal' | 'good' | 'powerful';
  pullCmd: string;
}

export const USE_CASES: UseCaseInfo[] = [
  {
    id: 'programar',
    icon: '💻',
    label: 'Programar',
    description: 'Escribir, corregir y refactorizar código en cualquier lenguaje. Ideal para el día a día en el editor.',
    bestTask: 'chat',
  },
  {
    id: 'servidor',
    icon: '🖥️',
    label: 'Supervisar servidor',
    description: 'DevOps, SSH, Docker, Nginx, systemd, logs, firewalls y scripts de mantenimiento en Linux/Windows.',
    bestTask: 'agent',
  },
  {
    id: 'agente',
    icon: '🤖',
    label: 'Agente autónomo',
    description: 'Crea y modifica archivos del proyecto, ejecuta comandos y automatiza tareas sin intervención manual.',
    bestTask: 'agent',
  },
  {
    id: 'autocompletado',
    icon: '⌨️',
    label: 'Autocompletado',
    description: 'Sugerencias mientras escribes, como Copilot. Debe ser rápido y ligero para no ralentizar el editor.',
    bestTask: 'completion',
  },
  {
    id: 'chat',
    icon: '💬',
    label: 'Chat rápido',
    description: 'Preguntas generales, dudas rápidas y respuestas cortas sin tocar archivos.',
    bestTask: 'chat',
  },
  {
    id: 'enseñar',
    icon: '🎓',
    label: 'Enseñar (Profesor)',
    description: 'Explicaciones paso a paso, tutoriales, arquitectura y buenas prácticas para aprender.',
    bestTask: 'chat',
  },
  {
    id: 'general',
    icon: '📚',
    label: 'Uso general',
    description: 'Texto, resúmenes, traducción y tareas que no son código puro.',
    bestTask: 'chat',
  },
];

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    name: 'local-copilot-turbo',
    size: '4.7 GB',
    ram: '~6–8 GB',
    speed: '⚡⚡⚡⚡',
    description: 'Modelo optimizado para Local Copilot. Muy rápido en chat y buen equilibrio para código diario.',
    bestFor: ['programar', 'chat', 'autocompletado', 'general'],
    tasks: { chat: true, completion: true, agent: false },
    minTier: 'normal',
    pullCmd: 'ollama pull local-copilot-turbo',
  },
  {
    name: 'qwen2.5-coder:7b',
    size: '4.7 GB',
    ram: '~8 GB',
    speed: '⚡⚡⚡',
    description: 'Especialista en código. Bueno para programar, autocompletado y proyectos medianos.',
    bestFor: ['programar', 'autocompletado', 'agente'],
    tasks: { chat: true, completion: true, agent: true },
    minTier: 'normal',
    pullCmd: 'ollama pull qwen2.5-coder:7b',
  },
  {
    name: 'qwen2.5-coder:14b',
    size: '9 GB',
    ram: '~16 GB',
    speed: '⚡⚡',
    description: 'El más capaz para programar y agente. Mejor para proyectos grandes, refactors y supervisión de servidores.',
    bestFor: ['programar', 'servidor', 'agente', 'enseñar'],
    tasks: { chat: true, completion: false, agent: true },
    minTier: 'good',
    pullCmd: 'ollama pull qwen2.5-coder:14b',
  },
  {
    name: 'qwen2.5:14b',
    size: '9 GB',
    ram: '~16 GB',
    speed: '⚡⚡',
    description: 'Modelo general potente. Bueno para explicaciones largas, Profesor y razonamiento complejo.',
    bestFor: ['enseñar', 'general', 'chat'],
    tasks: { chat: true, completion: false, agent: false },
    minTier: 'good',
    pullCmd: 'ollama pull qwen2.5:14b',
  },
  {
    name: 'qwen2.5-coder:1.5b',
    size: '1.1 GB',
    ram: '~3 GB',
    speed: '⚡⚡⚡⚡⚡',
    description: 'Ultraligero. Solo para PCs con poca RAM; autocompletado básico y chat simple.',
    bestFor: ['autocompletado', 'chat'],
    tasks: { completion: true, chat: true },
    minTier: 'basic',
    pullCmd: 'ollama pull qwen2.5-coder:1.5b',
  },
  {
    name: 'llama3.2',
    size: '2.0 GB',
    ram: '~5 GB',
    speed: '⚡⚡⚡⚡',
    description: 'Chat general rápido y conversacional. No es el mejor para código complejo.',
    bestFor: ['chat', 'general'],
    tasks: { chat: true },
    minTier: 'normal',
    pullCmd: 'ollama pull llama3.2',
  },
  {
    name: 'llama3.1:8b',
    size: '4.7 GB',
    ram: '~10 GB',
    speed: '⚡⚡⚡',
    description: 'Versátil para texto y código moderado. Alternativa equilibrada si no tienes Qwen.',
    bestFor: ['general', 'programar', 'chat'],
    tasks: { chat: true, agent: true },
    minTier: 'normal',
    pullCmd: 'ollama pull llama3.1:8b',
  },
  {
    name: 'deepseek-coder:6.7b',
    size: '3.8 GB',
    ram: '~8 GB',
    speed: '⚡⚡⚡',
    description: 'Coder alternativo con buen rendimiento en scripts y APIs.',
    bestFor: ['programar', 'agente'],
    tasks: { chat: true, agent: true, completion: true },
    minTier: 'normal',
    pullCmd: 'ollama pull deepseek-coder:6.7b',
  },
  {
    name: 'phi3:mini',
    size: '2.2 GB',
    ram: '~4 GB',
    speed: '⚡⚡⚡⚡',
    description: 'Chat ligero para PCs modestas. Limitado en proyectos grandes.',
    bestFor: ['chat', 'general'],
    tasks: { chat: true },
    minTier: 'basic',
    pullCmd: 'ollama pull phi3:mini',
  },
];

const TIER_RANK: Record<string, number> = {
  basic: 0,
  normal: 1,
  good: 2,
  powerful: 3,
};

const norm = (n: string) => n.replace(/:latest$/i, '').trim().toLowerCase();

export function isModelInstalled(installed: string[], name: string): boolean {
  if (!name || !installed.length) { return false; }
  const base = norm(name);
  return installed.some((m) => norm(m) === base || m.startsWith(`${base}:`));
}

export function resolveInstalledName(installed: string[], name: string): string | undefined {
  if (!name || !installed.length) { return undefined; }
  const base = norm(name);
  return installed.find((m) => norm(m) === base || m.startsWith(`${base}:`));
}

/** Mejor modelo del catálogo para un caso de uso (instalados primero, luego por tier). */
export function pickModelForUseCase(
  useCase: UseCaseId,
  installed: string[],
  tier: keyof typeof TIER_RANK = 'normal'
): ModelCatalogEntry | undefined {
  const tierRank = TIER_RANK[tier] ?? 1;
  const candidates = MODEL_CATALOG
    .filter((m) => m.bestFor.includes(useCase) && TIER_RANK[m.minTier] <= tierRank + 1)
    .sort((a, b) => {
      const aInst = isModelInstalled(installed, a.name) ? 0 : 1;
      const bInst = isModelInstalled(installed, b.name) ? 0 : 1;
      if (aInst !== bInst) { return aInst - bInst; }
      return TIER_RANK[b.minTier] - TIER_RANK[a.minTier];
    });
  return candidates[0];
}

/** Asignación sugerida chat / completion / agent para un perfil de uso. */
export function buildUseCaseProfile(
  useCase: UseCaseId,
  installed: string[],
  tier: keyof typeof TIER_RANK = 'normal'
): Partial<Record<TaskAssign, string>> {
  const info = USE_CASES.find((u) => u.id === useCase);
  const primary = pickModelForUseCase(useCase, installed, tier);
  if (!primary) { return {}; }

  const profile: Partial<Record<TaskAssign, string>> = {};
  const resolved = resolveInstalledName(installed, primary.name) ?? primary.name;

  if (info) {
    profile[info.bestTask] = resolved;
  }

  if (useCase === 'servidor' || useCase === 'agente') {
    const agent = pickModelForUseCase('agente', installed, tier);
    if (agent) {
      profile.agent = resolveInstalledName(installed, agent.name) ?? agent.name;
    }
    const chat = pickModelForUseCase('programar', installed, tier);
    if (chat) {
      profile.chat = resolveInstalledName(installed, chat.name) ?? chat.name;
    }
  } else if (useCase === 'autocompletado') {
    const comp = pickModelForUseCase('autocompletado', installed, tier);
    if (comp) {
      profile.completion = resolveInstalledName(installed, comp.name) ?? comp.name;
    }
  } else if (useCase === 'programar') {
    const comp = pickModelForUseCase('autocompletado', installed, tier);
    if (comp) {
      profile.completion = resolveInstalledName(installed, comp.name) ?? comp.name;
    }
    profile.chat = resolved;
  } else {
    profile.chat = resolved;
  }

  return profile;
}

export function getUseCaseLabel(id: UseCaseId): string {
  return USE_CASES.find((u) => u.id === id)?.label ?? id;
}