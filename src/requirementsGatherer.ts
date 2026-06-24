/**
 * Recopila requisitos antes de crear proyectos (web, bots Discord, plugins/mods Minecraft…).
 * El asistente pregunta estilo, funciones y stack en lugar de adivinar.
 */

import type { ProjectBlueprint, ProjectKind } from './projectBlueprints';
import {
  detectBlueprint,
  wantsDiscordBot,
  wantsGame,
  wantsMinecraftModFabric,
  wantsMinecraftModForge,
  wantsMinecraftPlugin,
  wantsTelegramBot,
  wantsWebPage,
  wantsWhatsappBot,
} from './projectBlueprints';

export interface RequirementField {
  id: string;
  question: string;
  options?: string[];
  hint?: string;
  required: boolean;
}

export interface RequirementsSession {
  kind: ProjectKind;
  label: string;
  originalPrompt: string;
  answers: Record<string, string>;
  pendingFields: RequirementField[];
  complete: boolean;
  startedAt: number;
}

const FIELDS_BY_KIND: Partial<Record<ProjectKind, RequirementField[]>> = {
  'web-static': [
    {
      id: 'style',
      question: '¿Qué estilo visual quieres?',
      options: ['Animalista / naturaleza', 'Dinámico con animaciones', 'Minimalista moderno', 'Retro / pixel', 'Corporativo profesional', 'Otro (descríbelo)'],
      required: true,
    },
    {
      id: 'sections',
      question: '¿Qué secciones debe tener? (hero, galería, contacto, blog, tienda…)',
      options: ['Hero + servicios + contacto', 'Portfolio / galería', 'Landing de producto', 'Blog + noticias', 'Todo en una página scroll', 'Personalizado'],
      required: true,
    },
    {
      id: 'animations',
      question: '¿Nivel de interactividad?',
      options: ['Solo CSS (hover, transiciones)', 'Scroll animations (parallax)', 'Canvas / partículas', 'Sin animaciones pesadas'],
      required: false,
    },
    {
      id: 'colors',
      question: '¿Paleta de colores o referencia?',
      options: ['Verdes / naturaleza', 'Oscuro (dark mode)', 'Vivos / neón', 'Pastel suave', 'Tú eliges lo mejor'],
      required: false,
    },
    {
      id: 'stack',
      question: '¿Tecnología preferida?',
      options: ['HTML + CSS + JS vanilla', 'React / Vite', 'Next.js', 'Svelte', 'Sin preferencia — lo más simple'],
      required: false,
    },
  ],
  'web-game': [
    {
      id: 'gameType',
      question: '¿Qué tipo de juego web?',
      options: ['Snake / arcade clásico', 'Quiz / trivia', 'Plataformas', 'Puzzle', 'Runner infinito', 'Otro'],
      required: true,
    },
    {
      id: 'style',
      question: '¿Estilo gráfico?',
      options: ['Pixel art', 'Flat / minimal', 'Animalista / cartoon', 'Realista', 'Tú propones'],
      required: true,
    },
    {
      id: 'controls',
      question: '¿Controles?',
      options: ['Teclado', 'Ratón / touch', 'Ambos', 'Móvil primero'],
      required: false,
    },
  ],
  'web-fullstack': [
    {
      id: 'frontend',
      question: '¿Frontend?',
      options: ['React', 'Vue', 'Svelte', 'HTML estático + API', 'Sin preferencia'],
      required: true,
    },
    {
      id: 'backend',
      question: '¿Backend?',
      options: ['Node + Express', 'FastAPI (Python)', 'Sin backend (solo mock)', 'Supabase / Firebase'],
      required: true,
    },
    {
      id: 'db',
      question: '¿Base de datos?',
      options: ['SQLite', 'PostgreSQL', 'MongoDB', 'Sin BD por ahora', 'JSON / archivos'],
      required: false,
    },
  ],
  'whatsapp-bot': [
    {
      id: 'library',
      question: '¿Qué biblioteca prefieres?',
      options: ['whatsapp-web.js (QR)', 'Baileys (sin navegador)', 'Sin preferencia — la más estable'],
      required: true,
    },
    {
      id: 'features',
      question: '¿Funciones principales?',
      options: ['Respuestas automáticas', 'Menú de opciones (1, 2, 3…)', 'Envío de archivos/imágenes', 'Bot de soporte / FAQ', 'Varias — combo completo'],
      required: true,
    },
    {
      id: 'hosting',
      question: '¿Dónde lo ejecutarás?',
      options: ['PC local', 'VPS Linux', 'Railway / Render', 'Aún no sé'],
      required: false,
    },
  ],
  'telegram-bot': [
    {
      id: 'features',
      question: '¿Funciones principales?',
      options: ['Comandos /start y /help', 'Teclado inline (botones)', 'Envío de archivos', 'Notificaciones / alertas', 'Varias — combo completo'],
      required: true,
    },
    {
      id: 'language',
      question: '¿Lenguaje?',
      options: ['JavaScript (telegraf)', 'TypeScript', 'Python (python-telegram-bot)', 'Sin preferencia'],
      required: false,
    },
    {
      id: 'hosting',
      question: '¿Dónde lo ejecutarás?',
      options: ['PC local', 'VPS / webhook', 'Railway / Render', 'Aún no sé'],
      required: false,
    },
  ],
  'discord-bot': [
    {
      id: 'commands',
      question: '¿Tipo de comandos?',
      options: ['Slash commands (recomendado)', 'Prefijo (!)', 'Ambos', 'Solo eventos automáticos'],
      required: true,
    },
    {
      id: 'features',
      question: '¿Funciones principales?',
      options: ['Música / radio', 'Moderación (ban, kick)', 'Minijuegos / trivia', 'Economía / niveles', 'Utilidades (clima, memes)', 'Varias — combo completo'],
      required: true,
    },
    {
      id: 'language',
      question: '¿Lenguaje?',
      options: ['JavaScript (discord.js)', 'TypeScript', 'Python (discord.py)', 'Sin preferencia'],
      required: false,
    },
    {
      id: 'hosting',
      question: '¿Dónde lo vas a ejecutar?',
      options: ['PC local / npm start', 'VPS / servidor Linux', 'Railway / Render gratis', 'Aún no sé'],
      required: false,
    },
  ],
  'minecraft-plugin': [
    {
      id: 'platform',
      question: '¿Plataforma del servidor?',
      options: ['Paper (recomendado)', 'Spigot', 'Purpur', 'Bukkit'],
      required: true,
    },
    {
      id: 'mcVersion',
      question: '¿Versión de Minecraft?',
      options: ['1.21.x', '1.20.x', '1.19.x', 'La más reciente estable', 'No sé — usa la última LTS'],
      required: true,
    },
    {
      id: 'features',
      question: '¿Qué debe hacer el plugin?',
      options: ['Comandos custom', 'Economía / tienda', 'Protección de terrenos', 'Minijuegos', 'Habilidades / clases', 'Descríbelo en tu respuesta'],
      required: true,
    },
  ],
  'minecraft-mod-fabric': [
    {
      id: 'mcVersion',
      question: '¿Versión de Minecraft?',
      options: ['1.21.x', '1.20.x', '1.19.x', 'Última estable Fabric'],
      required: true,
    },
    {
      id: 'features',
      question: '¿Qué añade el mod?',
      options: ['Items / bloques nuevos', 'Mobs / criaturas', 'Mecánicas de juego', 'HUD / UI', 'Biomas / mundo', 'Descríbelo'],
      required: true,
    },
  ],
  'minecraft-mod-forge': [
    {
      id: 'mcVersion',
      question: '¿Versión de Minecraft?',
      options: ['1.21.x', '1.20.x', '1.19.x', 'Última estable Forge'],
      required: true,
    },
    {
      id: 'features',
      question: '¿Qué añade el mod?',
      options: ['Items / bloques', 'Mobs', 'Dimensiones', 'Magia / tech', 'Descríbelo'],
      required: true,
    },
  ],
  'api-rest': [
    {
      id: 'stack',
      question: '¿Stack del API?',
      options: ['Node + Express', 'FastAPI', 'NestJS', 'Sin preferencia'],
      required: true,
    },
    {
      id: 'auth',
      question: '¿Autenticación?',
      options: ['JWT', 'API keys', 'Sin auth (público)', 'OAuth / sesiones'],
      required: false,
    },
    {
      id: 'data',
      question: '¿Persistencia?',
      options: ['SQLite', 'PostgreSQL', 'MongoDB', 'En memoria / mock'],
      required: false,
    },
  ],
};

const CREATION_RE =
  /\b(crea(?:me|r)?|créame|hazme|genera(?:me)?|implementa(?:me)?|programa(?:me)?|diseña(?:me)?|monta(?:me)?|la\s+mejor|el\s+mejor|impresionante|completo|profesional|din[aá]mico|animalista)\b/i;

const SKIP_GATHER_RE =
  /\b(arregla|fix|corrige|refactor|modifica\s+(?:el\s+)?(?:archivo|código)|error|bug|no\s+funciona|commit|push|publica)\b/i;

const DETAIL_SIGNAL_PATTERNS = [
  /\b(react|vue|svelte|next\.?js)\b/i,
  /\b(discord\.js|typescript|telegraf)\b/i,
  /\b(fabric|forge|paper|spigot|purpur|bukkit)\b/i,
  /\b1\.\d{2}(?:\.\d+)?\b/,
  /\b(slash\s+command|slash|prefijo|prefix)\b/i,
  /\b(hero|galer[ií]a|dark\s*mode|parallax|canvas|gsap|aos|three\.js)\b/i,
  /\b(postgresql|mongodb|jwt|express|fastapi|sqlite|prisma)\b/i,
  /\b(animalista|din[aá]mico|animaciones?)\b/i,
  /\b(econom[ií]a|moderaci[oó]n|música|musica|trivia|minijuegos?)\b/i,
];

export function countDetailSignals(prompt: string): number {
  return DETAIL_SIGNAL_PATTERNS.filter((p) => p.test(prompt)).length;
}

export function isProjectCreationRequest(prompt: string): boolean {
  if (SKIP_GATHER_RE.test(prompt)) { return false; }
  return CREATION_RE.test(prompt) || wantsWebPage(prompt) || wantsDiscordBot(prompt) ||
    wantsWhatsappBot(prompt) || wantsTelegramBot(prompt) ||
    wantsMinecraftPlugin(prompt) || wantsMinecraftModFabric(prompt) ||
    wantsMinecraftModForge(prompt) || wantsGame(prompt) ||
    /\b(web|sitio|landing)\s+(con|usando|en)\b/i.test(prompt) ||
    /\b(plugin|mod)\s+minecraft\b/i.test(prompt);
}

export function promptHasEnoughDetail(prompt: string): boolean {
  const signals = countDetailSignals(prompt);
  if (signals >= 2) { return true; }
  if (signals >= 1 && prompt.length > 45 &&
    /\b(paper|fabric|forge|react|discord\.js|1\.\d{2}|spigot)\b/i.test(prompt)) {
    return true;
  }
  const detailHits = (prompt.match(/\b(y\s+que|con\s+|incluye|debe\s+tener|quiero\s+que|usando|con\s+animaciones?)\b/gi) ?? []).length;
  return detailHits >= 2 && prompt.length > 120;
}

export function startRequirementsSession(prompt: string, blueprint: ProjectBlueprint | null): RequirementsSession | null {
  const kind = blueprint?.kind ?? 'generic';
  const fields = FIELDS_BY_KIND[kind];
  if (!fields?.length) { return null; }

  return {
    kind,
    label: blueprint?.label ?? kind,
    originalPrompt: prompt,
    answers: {},
    pendingFields: [...fields],
    complete: false,
    startedAt: Date.now(),
  };
}

export function mergeUserAnswer(session: RequirementsSession, userText: string): RequirementsSession {
  const next = { ...session, answers: { ...session.answers }, pendingFields: [...session.pendingFields] };
  const field = next.pendingFields[0];
  if (!field) {
    next.complete = true;
    return next;
  }

  next.answers[field.id] = userText.trim();
  next.pendingFields.shift();

  if (next.pendingFields.length === 0) {
    next.complete = true;
  }
  return next;
}

export function buildClarificationMessage(session: RequirementsSession): string {
  const field = session.pendingFields[0];
  if (!field) { return ''; }

  const answered = Object.keys(session.answers).length;
  const total = answered + session.pendingFields.length;
  let msg = `### Configuración: ${session.label}\n\n`;
  msg += `Para darte un resultado **profesional y funcional**, necesito ${total} detalles.\n\n`;
  msg += `**Pregunta ${answered + 1} de ${total}** — ${field.question}\n`;

  if (field.options?.length) {
    msg += '\n**Opciones:**\n';
    field.options.forEach((opt, i) => {
      msg += `- **${i + 1}.** ${opt}\n`;
    });
    msg += '\nResponde con el número, el texto de la opción o una descripción breve.\n';
  }

  if (field.hint) {
    msg += `\n> ${field.hint}\n`;
  }

  if (answered === 0) {
    msg += '\n---\n';
    msg += 'Al terminar, generaré la estructura de carpetas, el código ejecutable y los pasos para probarlo.\n';
  }

  return msg;
}

export function buildRequirementsBlock(session: RequirementsSession): string {
  if (!session.complete || Object.keys(session.answers).length === 0) { return ''; }

  const lines = [
    '## Requisitos confirmados por el usuario',
    `Proyecto: ${session.label}`,
    `Petición original: ${session.originalPrompt}`,
  ];

  for (const [id, value] of Object.entries(session.answers)) {
    lines.push(`- **${id}**: ${value}`);
  }

  lines.push('');
  lines.push(
    'Genera una respuesta **profesional y completa**: árbol de carpetas, código ejecutable, ' +
    'dependencias (npm/pip) y comando para probar. Implementa exactamente lo acordado.'
  );
  return lines.join('\n');
}

export type RequirementsMode = 'chat' | 'agent' | 'teacher';

export interface GatherRequirementsOptions {
  mode?: RequirementsMode;
}

const IMPLEMENT_NOW_RE =
  /\b(implementa(?:r)?\s+ya|sin\s+preguntas|directo|ahora\s+mismo|skip\s+questions|no\s+preguntes)\b/i;

export function shouldGatherRequirements(
  prompt: string,
  session: RequirementsSession | null,
  hasOpenWorkspace: boolean,
  options?: GatherRequirementsOptions
): { gather: boolean; session: RequirementsSession | null; message?: string } {
  const mode = options?.mode ?? 'chat';

  if (session && !session.complete) {
    const updated = mergeUserAnswer(session, prompt);
    if (!updated.complete) {
      if (mode === 'agent') {
        updated.complete = true;
        return { gather: false, session: updated };
      }
      return { gather: true, session: updated, message: buildClarificationMessage(updated) };
    }
    return { gather: false, session: updated };
  }

  if (mode === 'agent' || IMPLEMENT_NOW_RE.test(prompt)) {
    return { gather: false, session: null };
  }

  if (!isProjectCreationRequest(prompt)) {
    return { gather: false, session: null };
  }

  if (promptHasEnoughDetail(prompt)) {
    return { gather: false, session: null };
  }

  const blueprint = detectBlueprint(prompt, [], false, hasOpenWorkspace, 'index.js');
  const newSession = startRequirementsSession(prompt, blueprint);
  if (!newSession) {
    return { gather: false, session: null };
  }

  return {
    gather: true,
    session: newSession,
    message: buildClarificationMessage(newSession),
  };
}

export const requirementsGatheringRules =
  '**Recopilación de requisitos (Chat / Profesor):**\n' +
  '- Si piden crear web, bot Discord, plugin/mod Minecraft o API **sin detalles** (estilo, funciones, stack), haz **2–5 preguntas concretas** antes de generar código.\n' +
  '- Pregunta: estilo visual, secciones/features, tecnología, versión (Minecraft), tipo de comandos (Discord).\n' +
  '- Si el usuario ya dio detalles suficientes, **no repitas preguntas** — implementa directo.\n' +
  '- En **modo Agente** la extensión **no hace cuestionario**: programa directo en disco.\n' +
  '- Recomienda APIs gratuitas (Open-Meteo, Open Trivia DB, discord.js) y plantillas GitHub que ahorren tiempo.\n' +
  '- Sugiere modelos Ollama compatibles con el hardware del usuario si la tarea es pesada (agente + proyecto grande).\n';