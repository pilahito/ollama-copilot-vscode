/**
 * Analiza la petición del usuario (expresiones coloquiales, énfasis, prohibiciones)
 * y genera un bloque estructurado para que el modelo no simplifique ni ignore matices.
 */

export type IntentUrgency = 'high' | 'normal' | 'low';
export type IntentQuality = 'production' | 'standard';
export type IntentTone = 'frustrated' | 'enthusiastic' | 'casual' | 'neutral';

export interface ParsedUserIntent {
  raw: string;
  goal: string;
  urgency: IntentUrgency;
  qualityBar: IntentQuality;
  tone: IntentTone;
  prohibitions: string[];
  mustInclude: string[];
  scopeNotes: string[];
  seriousnessScore: number;
  blockForModel: string;
}

const URGENCY_RE =
  /\b(ya|ahora|urgente|rápido|rápida|rapido|rapida|de una|directo|sin vueltas|no me des vueltas|no divagues|inmediato|cuanto antes|lo antes posible)\b/i;

const QUALITY_RE =
  /\b(impresionante|profesional|completo|completa|de verdad|en serio|bien hecho|bien hecha|calidad|producción|produccion|robusto|pulido|top|premium|nivel pro|sin chapuzas?|no chapuza|no a medias|no simplifiques|no lo tomes a la ligera|a la ligera|decente|funcional|operativo|usable|que funcione|que sirva|que ande|listo para usar|que corra|que arranque)\b/i;

const IMPLEMENTATION_RE =
  /\b(crea|crear|creame|créame|hazme|implementa|programa|genera|modifica|añade|plugin|mod\b|bot\b|comando|funci[oó]n|sistema|extensi[oó]n)\b/i;

const FRUSTRATED_RE =
  /\b(no entiendes|no me entiendes|mal|fatal|horrible|no funciona|no sirve|otra vez|de nuevo|arreglalo|arréglalo|esto está mal|está mal|me decepciona|me frustra|toma todo a la ligera|al ligera|ignoras|no haces caso)\b/i;

const ENTHUSIASTIC_RE =
  /\b(genial|increíble|increible|brutal|épico|epico|bestial|mola|guay|flipante)\b/i;

const PROHIBITION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bno\s+uses?\s+\.gitkeep\b/i, label: 'No crear archivos .gitkeep' },
  { re: /\bsin\s+\.gitkeep\b/i, label: 'No crear archivos .gitkeep' },
  { re: /\bno\s+carpetas?\s+vac[ií]as?\b/i, label: 'No dejar carpetas vacías — cada carpeta con código real' },
  { re: /\bno\s+(?:solo|solamente)\s+expliques?\b/i, label: 'No solo explicar — implementar' },
  { re: /\bno\s+me\s+digas?\s+(?:que\s+)?copie\b/i, label: 'No pedir al usuario que copie código manualmente' },
  { re: /\bno\s+(?:uses?|metas?)\s+todo\s+en\s+index\b/i, label: 'No concentrar toda la lógica en index.js' },
  { re: /\bno\s+(?:uses?|crees?)\s+(?:un\s+)?(?:solo\s+)?\.md\b/i, label: 'No crear solo documentación .md sin código' },
];

const MUST_INCLUDE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(modular|por carpetas?|organizado|estructura)\b/i, label: 'Estructura modular por carpetas' },
  { re: /\b(musica|música|music|playlist|reproducir)\b/i, label: 'Módulo de música/reproducción' },
  { re: /\b(radio|emisora|streaming)\b/i, label: 'Módulo de radio/streaming' },
  { re: /\b(juegos?|minijuegos?|trivia|quiz)\b/i, label: 'Minijuegos o trivia' },
  { re: /\b(econom[ií]a|monedas?|daily|leaderboard)\b/i, label: 'Sistema de economía/puntuación' },
  { re: /\b(embeds?|bonito|diseño|ui|interfaz)\b/i, label: 'UI/embeds cuidados' },
  { re: /\b(manejo de errores|try\s*catch|errores)\b/i, label: 'Manejo de errores explícito' },
  { re: /\b(readme|documentaci[oó]n de uso)\b/i, label: 'README con instrucciones de uso' },
  { re: /\b(plugin|mod\b|mods\b|rom\b|minecraft|fabric|forge)\b/i, label: 'Usar SDK/API oficial de la plataforma (Paper, Fabric, Forge, AOSP…)' },
  { re: /\b(\.env|variables de entorno|token)\b/i, label: 'Configuración con .env (sin hardcodear secretos)' },
];

const SCOPE_ONLY_RE = /\b(?:solo|solamente|únicamente|unicamente|nada más|nada mas)\s+([^.,;!\n]{3,60})/gi;

const GOAL_PATTERNS: { re: RegExp; goal: string }[] = [
  { re: /\b(bot\s+(?:de\s+)?discord|discord\s+bot)\b/i, goal: 'Crear o mejorar un bot de Discord funcional y modular' },
  { re: /\b(bot\s+telegram|telegram\s+bot)\b/i, goal: 'Crear o mejorar un bot de Telegram funcional' },
  { re: /\b(p[aá]gina\s+web|sitio\s+web|landing|website)\b/i, goal: 'Crear o mejorar una página/sitio web' },
  { re: /\b(api\s+rest|backend|express)\b/i, goal: 'Crear o mejorar una API/backend' },
  { re: /\b(plugin\s+minecraft|minecraft\s+plugin|spigot|papermc)\b/i, goal: 'Crear plugin Minecraft (Paper/Spigot) compilable' },
  { re: /\b(mod\s+minecraft|minecraft\s+mod|fabric|forge)\b/i, goal: 'Crear mod Minecraft (Fabric/Forge) compilable' },
  { re: /\b(rom\s+custom|lineage|aosp)\b/i, goal: 'Scaffold ROM Android (scripts + device tree; blobs/kernel aparte)' },
  { re: /\b(extensi[oó]n\s+vscode|vs\s*code\s+extension)\b/i, goal: 'Crear extensión VS Code con Extension API' },
  { re: /\b(mod|plugin|addon)\b/i, goal: 'Crear mod/plugin usando SDK oficial de la plataforma indicada' },
  { re: /\b(juego|game|snake|tetris)\b/i, goal: 'Crear o mejorar un juego' },
  { re: /\b(arregla|arreglar|fix|corrige|corregir)\b/i, goal: 'Corregir errores existentes — diagnóstico serio y fix real' },
  { re: /\b(mejorar?|mejora|refactor)\b/i, goal: 'Mejorar código existente sin simplificar requisitos' },
  { re: /\b(crea|crear|hazme|genera)\b/i, goal: 'Implementar lo pedido de forma completa' },
];

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function detectGoal(prompt: string): string {
  for (const { re, goal } of GOAL_PATTERNS) {
    if (re.test(prompt)) { return goal; }
  }
  const trimmed = prompt.replace(/\s+/g, ' ').trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed || 'Atender la petición del usuario con precisión';
}

function detectScopeNotes(prompt: string): string[] {
  const notes: string[] = [];
  let match: RegExpExecArray | null;
  SCOPE_ONLY_RE.lastIndex = 0;
  while ((match = SCOPE_ONLY_RE.exec(prompt)) !== null) {
    const scope = match[1]?.trim();
    if (scope) { notes.push(`Alcance limitado a: ${scope}`); }
  }
  if (/\btodo\b/i.test(prompt) && /\b(completo|entero|íntegro|integro)\b/i.test(prompt)) {
    notes.push('El usuario pide implementación completa, no un esqueleto');
  }
  return unique(notes);
}

function detectSeriousness(prompt: string): number {
  let score = 0;
  if (FRUSTRATED_RE.test(prompt)) { score += 3; }
  if (QUALITY_RE.test(prompt)) { score += 2; }
  if (URGENCY_RE.test(prompt)) { score += 1; }
  if (/\b(?:!{2,}|IMPORTANTE|OBLIGATORIO)\b/i.test(prompt)) { score += 2; }
  if (prompt.length > 200) { score += 1; }
  return score;
}

export function parseUserIntent(prompt: string): ParsedUserIntent {
  const raw = prompt.trim();
  const prohibitions = unique(
    PROHIBITION_PATTERNS.filter((p) => p.re.test(raw)).map((p) => p.label)
  );
  const mustInclude = unique(
    MUST_INCLUDE_PATTERNS.filter((p) => p.re.test(raw)).map((p) => p.label)
  );
  const scopeNotes = detectScopeNotes(raw);
  const seriousnessScore = detectSeriousness(raw);

  let tone: IntentTone = 'neutral';
  if (FRUSTRATED_RE.test(raw)) { tone = 'frustrated'; }
  else if (ENTHUSIASTIC_RE.test(raw)) { tone = 'enthusiastic'; }
  else if (/\b(nose|ns|xd|tio|tío|bro|pls|porfa)\b/i.test(raw)) { tone = 'casual'; }

  const urgency: IntentUrgency = URGENCY_RE.test(raw) || tone === 'frustrated' ? 'high' : 'normal';
  const qualityBar: IntentQuality =
    QUALITY_RE.test(raw) || seriousnessScore >= 3 || tone === 'frustrated' ? 'production' : 'standard';

  const lines: string[] = [
    '═══ ANÁLISIS DE INTENCIÓN (OBLIGATORIO — léelo antes de responder) ═══',
    `Objetivo interpretado: ${detectGoal(raw)}`,
    `Urgencia: ${urgency === 'high' ? 'ALTA — actúa ya, sin rodeos ni respuestas vacías' : 'Normal'}`,
    `Nivel exigido: ${qualityBar === 'production' ? 'PRODUCCIÓN — código completo, funcional, sin placeholders ni atajos' : 'Estándar — cumple todo lo pedido'}`,
  ];

  if (tone === 'frustrated') {
    lines.push(
      'Tono del usuario: FRUSTRADO — trata el pedido con máxima seriedad.',
      'NO minimices, NO simplifiques de más, NO ignores requisitos por informalidad del lenguaje.',
      'NO respondas con generalidades ("puedes hacer X") si pidió implementación concreta.'
    );
  } else if (tone === 'enthusiastic') {
    lines.push('Tono: entusiasta — entrega algo que realmente impresione, no un demo mínimo.');
  } else if (tone === 'casual') {
    lines.push(
      'Tono: informal/coloquial — el lenguaje relajado NO reduce el alcance del trabajo.',
      'Interpreta expresiones coloquiales con el significado técnico real (ej. "bot flipante" = bot completo y pulido).'
    );
  }

  if (prohibitions.length) {
    lines.push(`Prohibiciones explícitas: ${prohibitions.join('; ')}`);
  }
  if (mustInclude.length) {
    lines.push(`Debe incluir: ${mustInclude.join('; ')}`);
  }
  if (scopeNotes.length) {
    lines.push(...scopeNotes);
  }

  lines.push(
    `Petición literal del usuario: "${raw}"`,
    'INSTRUCCIÓN: Cumple TODOS los matices. Si algo es ambiguo, elige la opción más completa y profesional, no la más perezosa.'
  );

  return {
    raw,
    goal: detectGoal(raw),
    urgency,
    qualityBar,
    tone,
    prohibitions,
    mustInclude,
    scopeNotes,
    seriousnessScore,
    blockForModel: lines.join('\n'),
  };
}

/** Bloque corto para inyectar en system prompt (todos los modos). */
export function intentUnderstandingRules(): string {
  return (
    '**Comprensión de intención (CRÍTICO):**\n' +
    '- El usuario puede escribir en español coloquial, con faltas o expresiones informales — interpreta el **significado real**, no las palabras sueltas.\n' +
    '- Expresiones como "impresionante", "de verdad", "en serio", "no a la ligera", "que funcione" = **calidad de producción**, no un demo mínimo.\n' +
    '- Si el tono es frustrado ("no entiendes", "otra vez", "mal"), responde con **acción concreta** y sin minimizar el problema.\n' +
    '- Respeta prohibiciones explícitas ("no .gitkeep", "no todo en index.js", "no solo expliques").\n' +
    '- "Crea un bot" ≠ esqueleto vacío: implica código **ejecutable** con cada función/comando **implementado**.\n' +
    '- "Créame tal" sin más detalle = implementación mínima **funcional** de "tal", no archivos vacíos.\n' +
    '- NUNCA trates el pedido como una pregunta teórica si pidió crear, arreglar o implementar algo.\n' +
    '- Para bots y apps: **usa APIs y librerías existentes** (discord.js, telegraf, Open-Meteo, Open Trivia DB, octokit…) — no reinventes ni datos mock si hay API gratuita.\n' +
    '- GitHub: publica/commit/clona **solo cuando tenga sentido** (usuario lo pide, proyecto listo, hay cambios reales).\n' +
    '- Con +Internet al crear: **investiga** proyectos similares y aplica su estructura; sin internet usa patrones ya aprendidos.\n'
  );
}

export function enrichUserMessage(prompt: string): string {
  const intent = parseUserIntent(prompt);
  const needsEnrichment =
    intent.seriousnessScore > 0 ||
    intent.mustInclude.length > 0 ||
    intent.prohibitions.length > 0 ||
    IMPLEMENTATION_RE.test(prompt) ||
    /\b(que\s+funcione|funcional|operativo)\b/i.test(prompt);

  if (!needsEnrichment) {
    return prompt;
  }

  const functionalNote = IMPLEMENTATION_RE.test(prompt)
    ? '\n⚠ Debe **FUNCIONAR** al ejecutar — lógica completa en cada feature/comando, no esqueleto.\n'
    : '';

  return `${intent.blockForModel}${functionalNote}\n\n═══ PETICIÓN ═══\n${prompt}`;
}