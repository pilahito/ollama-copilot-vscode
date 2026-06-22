/**
 * Cuándo usar Git/GitHub con sentido común (no en cada tarea).
 */

import type { GitHubAgentContext } from './githubService';

export interface GitHubSuggestion {
  action: 'publish' | 'commit_push' | 'status' | 'init' | 'clone_example' | 'none';
  reason: string;
  block?: string;
}

export function detectGitHubIntent(prompt: string): GitHubSuggestion['action'][] {
  const intents: GitHubSuggestion['action'][] = [];
  if (/\b(publica|publicar|sube?\s+a?\s*github|crea(?:r)?\s+repo|nuevo\s+repositorio)\b/i.test(prompt)) {
    intents.push('publish');
  }
  if (/\b(commit|push|sube?\s+cambios|guarda?\s+en\s+git)\b/i.test(prompt)) {
    intents.push('commit_push');
  }
  if (/\b(status|estado\s+git|qué\s+cambió)\b/i.test(prompt)) {
    intents.push('status');
  }
  if (/\b(clona?|clone|fork|ejemplo\s+de\s+github|repo\s+de\s+ejemplo|starter)\b/i.test(prompt)) {
    intents.push('clone_example');
  }
  if (/\b(git\s+init|inicializa?\s+git)\b/i.test(prompt)) {
    intents.push('init');
  }
  return intents;
}

export function buildGitHubCommonSenseBlock(
  ctx: GitHubAgentContext,
  userPrompt: string,
  isImplementationTask: boolean
): string {
  const explicit = detectGitHubIntent(userPrompt);
  const lines = [
    '═══ GITHUB — SENTIDO COMÚN (no abuses; solo cuando aporte valor) ═══',
    '',
    'CUÁNDO SÍ usar GitHub:',
    '• Usuario pide publicar/subir/clonar/commit → ejecuta GITHUB o COMANDO git/gh',
    '• Proyecto nuevo terminado y usuario dijo "sube a github" → GITHUB: PUBLICAR',
    '• Cambios de código en repo con remote → GITHUB: COMMIT_PUSH tras ACCION',
    '• Necesitas ejemplo oficial → COMANDO: gh repo clone owner/repo --depth 1',
    '',
    'CUÁNDO NO:',
    '• Proyecto local de prueba sin pedir git → no publiques ni hagas commit',
    '• dirtyCount=0 → no COMMIT_PUSH vacío',
    '• Sin auth (gh ni VS Code GitHub) → indica conectar primero, no inventes push',
    '',
    `Estado actual: git=${ctx.isGitRepo ? 'sí' : 'no'}, dirty=${ctx.dirtyCount}, remote=${ctx.remote}`,
    ctx.userLogin ? `Usuario GitHub: @${ctx.userLogin}` : 'Usuario GitHub: no conectado',
    '',
  ];

  if (explicit.includes('clone_example')) {
    lines.push(
      'Petición de clonar: usa COMANDO gh repo clone <owner/repo> o git clone.',
      'Ejemplos útiles: discordjs/discord.js (docs), o repos de referencia del stack pedido.',
    );
  }

  if (isImplementationTask && !ctx.isGitRepo && /\b(subir|publicar|github|repo)\b/i.test(userPrompt)) {
    lines.push('Tras crear archivos: COMANDO git init → GITHUB: PUBLICAR si el usuario quiere remoto.');
  } else if (
    isImplementationTask &&
    ctx.isGitRepo &&
    ctx.dirtyCount === 0 &&
    !explicit.includes('commit_push') &&
    !explicit.includes('publish')
  ) {
    lines.push('No hagas commit/push automático hasta que haya cambios (ACCION) aplicados.');
  } else if (
    isImplementationTask &&
    ctx.isGitRepo &&
    ctx.remote !== '(sin origin)' &&
    explicit.length === 0
  ) {
    lines.push(
      'Si modificas archivos con ACCION y agentAutoCommitPush está activo, puedes emitir GITHUB: COMMIT_PUSH al final.',
    );
  }

  if (!ctx.ghAuthenticated && !ctx.vscodeGitHubAuth) {
    lines.push('⚠ Sin sesión GitHub — PUBLICAR/COMMIT_PUSH fallará hasta conectar (Local: Conectar GitHub o gh auth login).');
  }

  return lines.join('\n') + '\n\n';
}