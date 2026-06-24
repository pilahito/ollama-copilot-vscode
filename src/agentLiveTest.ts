/**
 * Pruebas en vivo del modo Agente — escribe en el chat (simulateSend con typing)
 * para que el usuario vea letra a letra, el panel morado y los fallos en el chat.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import type { LocalChatViewProvider } from './chatViewProvider';
import { debugLog } from './debugLog';

export interface AgentLiveScenario {
  label: string;
  text: string;
  /** Archivo que debe existir o contener patrón tras la petición. */
  expectFile?: string;
  expectPattern?: RegExp;
  timeoutMs?: number;
}

export interface AgentLiveTestResult {
  ok: boolean;
  passed: number;
  failed: number;
  lines: string[];
}

const DEFAULT_SCENARIOS: AgentLiveScenario[] = [
  {
    label: '/dado',
    text: 'Crea commands/dice.js con slash command /dado que devuelva un número aleatorio del 1 al 6. discord.js v14.',
    expectFile: 'commands/dice.js',
    expectPattern: /dado|random|Math/i,
    timeoutMs: 300_000,
  },
  {
    label: '/8ball',
    text: 'Crea commands/8ball.js — slash /8ball con opción pregunta (string) y 10 respuestas aleatorias en español.',
    expectFile: 'commands/8ball.js',
    expectPattern: /8ball|pregunta/i,
    timeoutMs: 300_000,
  },
  {
    label: 'daily 200',
    text: 'Modifica commands/daily.js para que la recompensa diaria sea 200 monedas. Mantén la lógica de cooldown.',
    expectFile: 'commands/daily.js',
    expectPattern: /\b200\b/,
    timeoutMs: 300_000,
  },
  {
    label: '/coinflip',
    text: 'Crea commands/coinflip.js — /coinflip apuesta cara o cruz con monedas del usuario (userService o economyService).',
    expectFile: 'commands/coinflip.js',
    expectPattern: /coinflip|cara|cruz/i,
    timeoutMs: 300_000,
  },
  {
    label: 'nsfw',
    text: 'Crea o mejora commands/nsfw.js: /nsfw hentai por defecto, fetch nekobot.xyz, solo canales NSFW.',
    expectFile: 'commands/nsfw.js',
    expectPattern: /nsfw|nekobot|hentai/i,
    timeoutMs: 300_000,
  },
];

type LogFn = (line: string) => void;

function syntaxOk(filePath: string): boolean {
  try {
    execSync(`node --check "${filePath}"`, { stdio: 'pipe', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function uniqueEvents(events: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of events) {
    if (!seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

/** Ejecuta escenarios en el chat Agente (visible en webview) y registra todo en debug log. */
export async function runAgentLiveTest(
  chatProvider: LocalChatViewProvider,
  log: LogFn = () => {},
  scenarios: AgentLiveScenario[] = DEFAULT_SCENARIOS
): Promise<AgentLiveTestResult> {
  const lines: string[] = [];
  let passed = 0;
  let failed = 0;

  const record = (ok: boolean, msg: string, showInChat = true): void => {
    const line = `${ok ? '✓' : '✗'} ${msg}`;
    lines.push(line);
    debugLog(`[agent-live] ${line}`);
    log(`[agent-live] ${line}`);
    if (ok) { passed++; } else { failed++; }
    if (showInChat) {
      chatProvider.appendAgentTestLine(line, ok ? 'ok' : 'fail');
    }
  };

  debugLog('── Inicio test agente EN VIVO (chat visible + typing) ──');

  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    const msg = 'Abre una carpeta de proyecto (p. ej. nekotina-bot) antes del test';
    record(false, msg);
    await chatProvider.injectChatMessage(`✗ **FALLO**\n${msg}`, 'ai', 'fail');
    return { ok: false, passed, failed, lines };
  }

  await chatProvider.beginAgentLiveTestUi(scenarios.length);
  record(true, `Workspace: ${root}`, false);

  const pingOk = await chatProvider.testWebviewPing(10_000);
  record(pingOk, pingOk ? 'Ping↔Pong webview' : 'Webview no responde');
  if (!pingOk) {
    await chatProvider.injectChatMessage('✗ **Webview no responde** — recarga VS Code (Reload Window)', 'ai', 'fail');
    chatProvider.endAgentLiveTestUi('Test abortado: webview sin respuesta', false);
    return { ok: false, passed, failed, lines };
  }

  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    const stepLabel = `Escenario ${i + 1}/${scenarios.length}: ${sc.label}`;

    debugLog(`[agent-live] ── ${stepLabel} ──`);
    debugLog(`[agent-live] 📝 Usuario escribe: ${sc.text.slice(0, 160)}…`);

    chatProvider.appendAgentTestLine(`▶ ${stepLabel} — escribiendo en el input…`, 'info');
    await chatProvider.injectChatMessage(
      `**${stepLabel}**\n⌨️ Escribiendo en el input (como usuario real)…\n\n\`${sc.text.slice(0, 200)}${sc.text.length > 200 ? '…' : ''}\``,
      'ai',
      'info'
    );

    vscode.window.showInformationMessage(`🤖 ${stepLabel} — mira el chat Agente`);

    const result = await chatProvider.testWebviewUserSend(
      sc.text,
      'agent',
      sc.timeoutMs ?? 300_000,
      { typing: true, typingMs: 20 }
    );

    const keyEvents = uniqueEvents(result.events).filter((e) =>
      ['sendAck', 'responseStart', 'agentSync', 'agentDone', 'progress', 'codeStreamStart', 'response', 'responseEnd'].includes(e)
    );
    const eventSummary = keyEvents.join(' → ') || 'sin eventos';

    if (!result.ok) {
      const failDetail =
        `✗ **FALLO: ${sc.label}**\n\n` +
        `**Causa:** el agente no terminó correctamente.\n` +
        `**Eventos:** ${eventSummary}\n` +
        `**Última respuesta:** ${result.snippet || '(vacía)'}\n\n` +
        `_Revisa el panel morado, Output → Local Copilot y /tmp/local-copilot-debug.log_`;
      record(false, `${sc.label}: sin respuesta completa (${eventSummary})`);
      debugLog(`[agent-live] eventos completos: ${result.events.join(', ')}`);
      await chatProvider.injectChatMessage(failDetail, 'ai', 'fail');
      continue;
    }

    record(true, `${sc.label}: agente respondió`);
    await chatProvider.injectChatMessage(`✓ **${sc.label}** — agente terminó. Comprobando archivos…`, 'ai', 'ok');

    if (sc.expectFile) {
      const full = path.join(root, sc.expectFile);
      if (!fs.existsSync(full)) {
        const msg = `${sc.label}: no existe ${sc.expectFile} en disco`;
        record(false, msg);
        await chatProvider.injectChatMessage(
          `✗ **${sc.label}**\nArchivo esperado no creado: \`${sc.expectFile}\``,
          'ai',
          'fail'
        );
        continue;
      }
      const content = fs.readFileSync(full, 'utf8');
      if (sc.expectPattern && !sc.expectPattern.test(content)) {
        const msg = `${sc.label}: ${sc.expectFile} sin patrón esperado`;
        record(false, msg);
        await chatProvider.injectChatMessage(
          `✗ **${sc.label}**\n\`${sc.expectFile}\` existe pero no contiene el patrón esperado.`,
          'ai',
          'fail'
        );
        continue;
      }
      if (sc.expectFile.endsWith('.js') && !syntaxOk(full)) {
        const msg = `${sc.label}: sintaxis rota en ${sc.expectFile}`;
        record(false, msg);
        await chatProvider.injectChatMessage(
          `✗ **${sc.label}**\nSintaxis inválida en \`${sc.expectFile}\` (node --check falló).`,
          'ai',
          'fail'
        );
        continue;
      }
      record(true, `${sc.label}: ${sc.expectFile} OK (${content.length} bytes)`);
      await chatProvider.injectChatMessage(
        `✓ **${sc.label}** — \`${sc.expectFile}\` OK (${content.length} bytes)`,
        'ai',
        'ok'
      );
    }

    await new Promise<void>((r) => setTimeout(r, 1200));
  }

  const ok = failed === 0;
  const summary =
    ok
      ? `🎉 **Test completado: ${passed} OK, 0 fallos**\nLog: /tmp/local-copilot-debug.log`
      : `⚠️ **Test terminado: ${passed} OK, ${failed} fallo(s)**\nRevisa los mensajes rojos arriba y el log.`;

  debugLog(`── Fin test agente en vivo: ${passed} OK, ${failed} fallos ──`);
  debugLog(`Log: /tmp/local-copilot-debug.log`);

  chatProvider.endAgentLiveTestUi(summary, ok);

  return { ok, passed, failed, lines };
}