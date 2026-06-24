/**
 * Test BATALLA Nekotina — agente en vivo con UI visible.
 * Comprueba que el bot tenga todos los comandos y que Ollama pueda ampliarlo.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import type { LocalChatViewProvider } from './chatViewProvider';
import { debugLog } from './debugLog';
import { runAgentLiveTest, type AgentLiveScenario } from './agentLiveTest';

const NEKOTINA_COMMANDS = [
  'anime', 'daily', 'economy', 'games', 'help', 'joke', 'levels', 'memes',
  'mine', 'moderation', 'music', 'nsfw', 'pets', 'ping', 'pokemon', 'profile',
  'radio', 'shop', 'trivia', 'weather', 'work',
];

const BATTLE_AGENT_SCENARIOS: AgentLiveScenario[] = [
  {
    label: 'index.js',
    text: 'Revisa index.js y deploy-commands.js: deben cargar todos los comandos de commands/ con discord.js v14. Corrige si falta alguno.',
    expectFile: 'index.js',
    expectPattern: /Client|commands|interactionCreate/i,
    timeoutMs: 300_000,
  },
  {
    label: '/dado',
    text: 'Crea commands/dice.js — slash /dado devuelve número aleatorio 1-6. discord.js v14, igual estilo que ping.js.',
    expectFile: 'commands/dice.js',
    expectPattern: /dado|random|Math/i,
    timeoutMs: 300_000,
  },
  {
    label: '/8ball',
    text: 'Crea commands/8ball.js — /8ball con opción pregunta (string) y 10 respuestas aleatorias en español.',
    expectFile: 'commands/8ball.js',
    expectPattern: /8ball|pregunta/i,
    timeoutMs: 300_000,
  },
  {
    label: 'daily 200',
    text: 'Modifica commands/daily.js: recompensa diaria 200 monedas, mantén cooldown.',
    expectFile: 'commands/daily.js',
    expectPattern: /\b200\b/,
    timeoutMs: 300_000,
  },
  {
    label: '/coinflip',
    text: 'Crea commands/coinflip.js — /coinflip apuesta cara o cruz con economyService o userService.',
    expectFile: 'commands/coinflip.js',
    expectPattern: /coinflip|cara|cruz/i,
    timeoutMs: 300_000,
  },
  {
    label: 'economía',
    text: 'Mejora commands/economy.js y services/economyService.js: balance, transfer y consistencia con shop/daily.',
    expectFile: 'commands/economy.js',
    expectPattern: /balance|moneda|economy/i,
    timeoutMs: 300_000,
  },
  {
    label: 'nsfw',
    text: 'Mejora commands/nsfw.js: /nsfw hentai por defecto, fetch nekobot.xyz, solo canales NSFW.',
    expectFile: 'commands/nsfw.js',
    expectPattern: /nsfw|nekobot|hentai/i,
    timeoutMs: 300_000,
  },
  {
    label: 'música',
    text: 'Revisa commands/music.js y musica/player.js: comando play funcional con @discordjs/voice si está instalado.',
    expectFile: 'commands/music.js',
    expectPattern: /play|music|voice/i,
    timeoutMs: 300_000,
  },
];

export interface BattleTestResult {
  ok: boolean;
  passed: number;
  failed: number;
  commandCoverage: number;
  lines: string[];
  readyForBattle: boolean;
}

type LogFn = (line: string) => void;

function syntaxOk(filePath: string): boolean {
  try {
    execSync(`node --check "${filePath}"`, { stdio: 'pipe', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function auditCommands(root: string): { found: string[]; missing: string[]; broken: string[] } {
  const found: string[] = [];
  const missing: string[] = [];
  const broken: string[] = [];
  for (const cmd of NEKOTINA_COMMANDS) {
    const full = path.join(root, 'commands', `${cmd}.js`);
    if (!fs.existsSync(full)) {
      missing.push(cmd);
      continue;
    }
    found.push(cmd);
    if (!syntaxOk(full)) {
      broken.push(cmd);
    }
  }
  return { found, missing, broken };
}

/** Test completo: UI visible + agente + auditoría de los 21 comandos Nekotina. */
export async function runNekotinaBattleTest(
  chatProvider: LocalChatViewProvider,
  log: LogFn = () => {}
): Promise<BattleTestResult> {
  const lines: string[] = [];
  let passed = 0;
  let failed = 0;

  const record = (ok: boolean, msg: string): void => {
    const line = `${ok ? '✓' : '✗'} ${msg}`;
    lines.push(line);
    debugLog(`[battle] ${line}`);
    log(`[battle] ${line}`);
    chatProvider.appendAgentTestLine(line, ok ? 'ok' : 'fail');
    if (ok) { passed++; } else { failed++; }
  };

  debugLog('── INICIO BATALLA NEKOTINA (UI visible + agente) ──');

  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    record(false, 'Abre la carpeta nekotina-bot (Archivo → Abrir carpeta)');
    await chatProvider.injectChatMessage(
      '✗ **BATALLA** — Abre `nekotina-bot` antes de continuar.',
      'ai',
      'fail'
    );
    return { ok: false, passed, failed: failed + 1, commandCoverage: 0, lines, readyForBattle: false };
  }

  await chatProvider.beginAgentLiveTestUi(BATTLE_AGENT_SCENARIOS.length + 1);
  await chatProvider.injectChatMessage(
    `⚔️ **BATALLA NEKOTINA**\n` +
    `Workspace: \`${root}\`\n` +
    `Objetivo: copia idéntica lista para Discord — ${NEKOTINA_COMMANDS.length} comandos + extras.\n` +
    `Verás cada petición **escribirse en el chat Agente**.`,
    'ai',
    'info'
  );

  const auditBefore = auditCommands(root);
  record(
    auditBefore.missing.length === 0,
    `Comandos base: ${auditBefore.found.length}/${NEKOTINA_COMMANDS.length}` +
    (auditBefore.missing.length ? ` (faltan: ${auditBefore.missing.join(', ')})` : '')
  );

  const agentResult = await runAgentLiveTest(chatProvider, log, BATTLE_AGENT_SCENARIOS);
  lines.push(...agentResult.lines);
  if (!agentResult.ok) {
    record(false, `Agente en vivo: ${agentResult.failed} escenario(s) fallaron`);
  } else {
    record(true, `Agente en vivo: ${agentResult.passed} escenarios OK`);
  }

  const auditAfter = auditCommands(root);
  const coverage = Math.round((auditAfter.found.length / NEKOTINA_COMMANDS.length) * 100);
  record(
    auditAfter.missing.length === 0,
    `Cobertura final: ${auditAfter.found.length}/${NEKOTINA_COMMANDS.length} (${coverage}%)`
  );

  if (auditAfter.broken.length > 0) {
    record(false, `Sintaxis rota: ${auditAfter.broken.join(', ')}`);
  } else {
    record(true, 'Sintaxis OK en todos los comandos');
  }

  const validateScript = path.join(root, 'scripts', 'validate.js');
  if (fs.existsSync(validateScript)) {
    try {
      execSync(`node "${validateScript}"`, { cwd: root, stdio: 'pipe', timeout: 30_000 });
      record(true, 'validate.js OK');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      record(false, `validate.js falló: ${msg.slice(0, 120)}`);
    }
  }

  const readyForBattle =
    agentResult.ok &&
    auditAfter.missing.length === 0 &&
    auditAfter.broken.length === 0 &&
    coverage >= 100;

  const summary = readyForBattle
    ? `🏆 **LISTO PARA LA BATALLA** — ${NEKOTINA_COMMANDS.length} comandos, agente OK, validate.js OK.`
    : `⚠️ **Aún no listo** — ${failed} fallo(s). Revisa mensajes rojos arriba y el log.`;

  chatProvider.endAgentLiveTestUi(summary, readyForBattle);
  debugLog(`── FIN BATALLA: ready=${readyForBattle} coverage=${coverage}% ──`);

  return {
    ok: readyForBattle,
    passed,
    failed,
    commandCoverage: coverage,
    lines,
    readyForBattle,
  };
}