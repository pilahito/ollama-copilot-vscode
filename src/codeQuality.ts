/**
 * Exige código que FUNCIONE — no esqueletos, placeholders ni funciones vacías.
 */

import type { ProjectBlueprint } from './projectBlueprints';

interface CodeFileAction {
  type: string;
  filePath: string;
  content?: string;
  reason?: string;
}

const SKELETON_PATTERNS: RegExp[] = [
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bIMPLEMENT\b/i,
  /\bYOUR\s+CODE\s+HERE\b/i,
  /\bAQU[IÍ]\s+TU\s+C[OÓ]DIGO\b/i,
  /\bimplementa(?:r)?\s+aqu[ií]\b/i,
  /\bpor\s+implementar\b/i,
  /\bcoming\s+soon\b/i,
  /\bplaceholder\b/i,
  /\/\/\s*\.\.\./,
  /#\s*\.\.\./,
  /\{\s*\.\.\.\s*\}/,
  /\(\s*\.\.\.\s*\)/,
  /module\.exports\s*=\s*\{\s*\}\s*;?\s*$/m,
  /export\s+default\s*\{\s*\}\s*;?\s*$/m,
];

const EMPTY_BODY_PATTERNS: RegExp[] = [
  /function\s+\w+\s*\([^)]*\)\s*\{\s*\}/,
  /=>\s*\{\s*\}/,
  /async\s+\w+\s*\([^)]*\)\s*\{\s*\}/,
  /def\s+\w+\s*\([^)]*\)\s*:\s*\n\s*pass\b/,
  /public\s+void\s+\w+\s*\([^)]*\)\s*\{\s*\}/,
];

/** Petición de crear/implementar algo que debe funcionar al ejecutar. */
export function wantsWorkingImplementation(prompt: string): boolean {
  return /\b(crea|crear|creame|créame|hazme|implementa|programa|genera|modifica|añade|agrega|plugin|mod\b|bot\b|extensi[oó]n|api\b|comando|funci[oó]n|feature|sistema)\b/i.test(prompt) ||
    /\b(que\s+funcione|funcional|operativo|usable|que\s+sirva|que\s+ande|de verdad|completo)\b/i.test(prompt);
}

export function isSkeletonOrPlaceholder(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 25) { return true; }

  const nonCommentLines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('*'));

  if (nonCommentLines.length <= 2) {
    const onlyComments = /^(#|\/\/|\/\*|\*)/.test(trimmed);
    if (onlyComments || /^<\?xml|^<!DOCTYPE/i.test(trimmed)) {
      return false;
    }
    if (trimmed.length < 80) { return true; }
  }

  for (const re of SKELETON_PATTERNS) {
    if (re.test(trimmed)) { return true; }
  }

  const fnCount = (trimmed.match(/\bfunction\b|=>\s*\{|def\s+\w+/g) || []).length;
  const emptyCount = EMPTY_BODY_PATTERNS.filter((re) => re.test(trimmed)).length;
  if (fnCount > 0 && emptyCount >= fnCount) { return true; }

  return false;
}

export interface FunctionalScore {
  ok: boolean;
  issues: string[];
  skeletonFiles: string[];
}

export function scoreFunctionalQuality(
  actions: CodeFileAction[],
  userPrompt: string
): FunctionalScore {
  const issues: string[] = [];
  const skeletonFiles: string[] = [];

  if (!wantsWorkingImplementation(userPrompt)) {
    return { ok: true, issues: [], skeletonFiles: [] };
  }

  const codeActions = actions.filter((a) => {
    if (!a.content || a.type === 'delete') { return false; }
    const ext = a.filePath.split('.').pop()?.toLowerCase() ?? '';
    return ['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'go', 'rs', 'sh', 'html', 'css', 'gradle', 'yml', 'yaml', 'toml', 'json'].includes(ext) ||
      a.filePath.endsWith('plugin.yml') || a.filePath.includes('fabric.mod.json');
  });

  if (codeActions.length === 0 && actions.length > 0) {
    issues.push('No hay archivos de código con implementación');
    return { ok: false, issues, skeletonFiles };
  }

  for (const action of codeActions) {
    const content = action.content ?? '';
    if (isSkeletonOrPlaceholder(content)) {
      skeletonFiles.push(action.filePath);
      issues.push(`${action.filePath}: esqueleto o placeholder (sin lógica real)`);
    }
  }

  const mainFiles = codeActions.filter((a) =>
    /index\.(js|ts)|extension\.ts|Plugin\.java|Mod\.java|main\.(js|py)|app\.py/i.test(a.filePath)
  );
  for (const main of mainFiles) {
    if ((main.content?.length ?? 0) < 120) {
      issues.push(`${main.filePath}: entry point demasiado corto para ser funcional`);
      skeletonFiles.push(main.filePath);
    }
  }

  if (/\bcomando|command|slash|\/\w+/i.test(userPrompt)) {
    const hasHandler = codeActions.some((a) =>
      /\b(interaction|CommandExecutor|SlashCommandBuilder|registerCommand|on\(|client\.on|bot\.command|telegraf)/i.test(a.content ?? '')
    );
    if (!hasHandler && codeActions.length > 0) {
      issues.push('Pides comandos pero no hay handlers registrados en el código');
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    skeletonFiles: [...new Set(skeletonFiles)],
  };
}

export function buildFunctionalRequirementsBlock(
  userPrompt: string,
  blueprint?: ProjectBlueprint | null
): string {
  if (!wantsWorkingImplementation(userPrompt)) { return ''; }

  const lines = [
    '═══ CÓDIGO QUE FUNCIONE (OBLIGATORIO) ═══',
    'El usuario pide algo que **funcione al ejecutar/compilar** — no un esqueleto ni tutorial.',
    '',
    'PROHIBIDO:',
    '- Funciones vacías, TODO, "implementa aquí", "...", body vacío {}',
    '- Solo comentarios o estructura de carpetas sin lógica',
    '- Respuestas mock cuando existe API real (fetch/axios/discord.js/Paper API)',
    '- Decir al usuario "añade la lógica" — TÚ la escribes completa',
    '',
    'OBLIGATORIO:',
    '- Cada comando/feature pedido tiene **implementación real** (handler + lógica)',
    '- Entry point **arranca** el programa (login bot, listen(), main())',
    '- Manejo básico de errores (try/catch o .catch)',
    '- Si hay deps: COMANDO npm install / ./gradlew build',
    '- EXPLICACION breve + **cómo probarlo** (1 línea: npm start, copiar jar a plugins/, etc.)',
  ];

  if (blueprint) {
    lines.push('', `Checklist ${blueprint.label}:`);
    switch (blueprint.kind) {
      case 'discord-bot':
        lines.push('- Client.login + interactionCreate/command handlers');
        lines.push('- Cada slash command responde (reply/editReply)');
        break;
      case 'minecraft-server':
        lines.push('- server.properties + eula.txt + carpetas world/, plugins/, config/');
        lines.push('- start.sh ejecutable; README con árbol de carpetas');
        break;
      case 'minecraft-plugin':
        lines.push('- JavaPlugin onEnable + getCommand().setExecutor');
        lines.push('- plugin.yml con commands que existen en Java');
        break;
      case 'web-fullstack':
        lines.push('- public/ + server/routes + database/schema separados');
        break;
      case 'minecraft-mod-fabric':
      case 'minecraft-mod-forge':
        lines.push('- ModInitializer/@Mod con registro de items/events');
        break;
      case 'vscode-extension':
        lines.push('- activate() registra comandos con subscribe');
        break;
      case 'api-rest':
        lines.push('- Rutas responden JSON real (app.get/post)');
        break;
      case 'web-static':
      case 'web-game':
        lines.push('- JS con event listeners y lógica ejecutable');
        break;
      default:
        break;
    }
  }

  if (/\b(que\s+funcione|funcional|operativo|que\s+sirva)\b/i.test(userPrompt)) {
    lines.push('', '⚠ El usuario dijo explícitamente QUE FUNCIONE — prioridad máxima.');
  }

  return lines.join('\n') + '\n\n';
}

export function functionalUnderstandingRules(): string {
  return (
    '**Entrega funcional (no solo crear archivos):**\n' +
    '- "Créame X" = X **ejecutable y probado en diseño**, no carpeta vacía.\n' +
    '- Cada función/comando/feature pedido debe **hacer algo visible** al usarse.\n' +
    '- Si falta token/.env, crea .env.example y el código lee process.env — no hardcodees secretos.\n' +
    '- Tras ACCION, indica en EXPLICACION cómo probar (npm start, /comando en Discord, etc.).\n'
  );
}