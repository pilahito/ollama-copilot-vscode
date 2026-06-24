/**
 * Ollama Build Loop — agente autónomo multi-ronda estilo Cursor/Grok Build.
 * El modelo usa herramientas (READ/WRITE/RUN/…) y recibe resultados hasta terminar.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { OllamaChatMessage } from './ollamaClient';
import type { OllamaClient } from './ollamaClient';
import {
  executeAgentTool,
  formatToolResults,
  parseAgentToolCalls,
  type AgentToolCall,
  type ToolContext,
} from './agentTools';
import { buildOllamaBuildSystemBlock, isBuildLoopEnabled, getBuildMaxRounds } from './grokMode';
import { buildUserAutonomyBlock } from './userAutonomy';
import { buildAgentExpertBlock } from './designProfiles/universalExpertProfile';
import { buildOllamaDefenseBlock } from './ollamaDefense';
import type { FileAction, AgentResult } from './agent';

export interface BuildLoopOptions {
  task: string;
  rootPath: string;
  projectTree: string[];
  model?: string;
  onProgress: (msg: string) => void;
  onToken?: (token: string) => void;
  maxRounds?: number;
}

export interface BuildLoopResult {
  rounds: number;
  complete: boolean;
  summary: string;
  actions: FileAction[];
  lastResponse: string;
}

function scanTreeBrief(root: string, max = 120): string {
  const lines: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (lines.length >= max || depth > 3) { return; }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') { continue; }
      const rel = path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/');
      lines.push(e.isDirectory() ? `📁 ${rel}/` : `📄 ${rel}`);
      if (e.isDirectory() && depth < 2) { walk(path.join(dir, e.name), depth + 1); }
      if (lines.length >= max) { break; }
    }
  };
  walk(root, 0);
  return lines.join('\n');
}

function collectFileActions(rootPath: string, since: number): FileAction[] {
  const actions: FileAction[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') { continue; }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs >= since - 2000) {
          const rel = path.relative(rootPath, full).replace(/\\/g, '/');
          if (rel.endsWith('.gitkeep')) { continue; }
          actions.push({
            type: 'modify',
            filePath: rel,
            content: fs.readFileSync(full, 'utf8'),
            reason: 'Modificado por Ollama Build Loop',
          });
        }
      } catch { /* */ }
    }
  };
  walk(rootPath);
  return actions.slice(0, 60);
}

export function shouldUseBuildLoop(prompt: string): boolean {
  if (!isBuildLoopEnabled()) { return false; }
  if (/\b(solo explica|explícame|explicame|qué hace|que hace|sin modificar|no modifiques)\b/i.test(prompt)) {
    return false;
  }
  return true;
}

export class OllamaBuildLoop {
  constructor(private readonly ollama: OllamaClient) {}

  async run(opts: BuildLoopOptions): Promise<BuildLoopResult> {
    const maxRounds = opts.maxRounds ?? getBuildMaxRounds();
    const model = opts.model ?? this.ollama.getModelForTask('agent');
    const allowTerminal = vscode.workspace.getConfiguration('local').get<boolean>('agentRunTerminal', true);
    const ctx: ToolContext = { rootPath: opts.rootPath, allowTerminal };
    const startedAt = Date.now();

    const system =
      buildOllamaDefenseBlock('agent') +
      buildUserAutonomyBlock() +
      buildAgentExpertBlock() +
      buildOllamaBuildSystemBlock();

    const tree = opts.projectTree.length > 0
      ? opts.projectTree.slice(0, 80).join('\n')
      : scanTreeBrief(opts.rootPath);

    const messages: OllamaChatMessage[] = [
      { role: 'system', content: system },
      {
        role: 'user',
        content:
          `TAREA:\n${opts.task}\n\n` +
          `PROYECTO: ${path.basename(opts.rootPath)}\n` +
          `RUTA: ${opts.rootPath}\n\n` +
          `ÁRBOL:\n${tree}\n\n` +
          `Empieza: LIST el proyecto, READ archivos clave, luego WRITE/EDIT/RUN hasta completar. ` +
          `Termina con TOOL: DONE cuando compile y funcione.`,
      },
    ];

    let lastResponse = '';
    let complete = false;
    let summary = '';

    for (let round = 1; round <= maxRounds; round++) {
      opts.onProgress(`🔁 Ollama Build — ronda ${round}/${maxRounds}…`);

      lastResponse = await this.ollama.agentChatStream(
        messages,
        (t) => opts.onToken?.(t),
        model
      );

      const calls = parseAgentToolCalls(lastResponse);
      if (calls.length === 0) {
        opts.onProgress('ℹ️ Sin herramientas — pidiendo acción concreta…');
        messages.push({ role: 'assistant', content: lastResponse });
        messages.push({
          role: 'user',
          content:
            'No emitiste TOOL:. Usa herramientas ahora:\n' +
            'TOOL: LIST | PATH: .\nTOOL: READ | PATH: <archivo>\nTOOL: WRITE | PATH: ... | MOTIVO: ...\n<<CONTENIDO>>\n...\n<<FIN>>',
        });
        continue;
      }

      const doneCall = calls.find((c) => c.tool === 'done');
      const workCalls = calls.filter((c) => c.tool !== 'done');

      const results = [];
      for (const call of workCalls.slice(0, 8)) {
        opts.onProgress(`🔧 ${call.tool.toUpperCase()}${call.path ? ` → ${call.path}` : ''}${call.command ? ` → ${call.command.slice(0, 60)}` : ''}`);
        const result = await executeAgentTool(call, ctx);
        results.push(result);
        if (result.output.length < 500) {
          opts.onProgress(result.output.split('\n')[0]);
        }
      }

      messages.push({ role: 'assistant', content: lastResponse });
      messages.push({
        role: 'user',
        content: formatToolResults(results) + '\n\nContinúa con la siguiente herramienta o TOOL: DONE si terminaste.',
      });

      if (doneCall) {
        complete = true;
        summary = doneCall.summary ?? lastResponse.slice(0, 2000);
        opts.onProgress(`✅ ${summary.slice(0, 200)}`);
        break;
      }
    }

    if (!summary) {
      summary = lastResponse.slice(0, 2000) || `Completadas ${maxRounds} rondas de Ollama Build.`;
    }

    const actions = collectFileActions(opts.rootPath, startedAt);

    return {
      rounds: Math.min(maxRounds, messages.filter((m) => m.role === 'user').length),
      complete,
      summary,
      actions,
      lastResponse,
    };
  }
}

export function buildLoopToAgentResult(build: BuildLoopResult): AgentResult {
  return {
    explanation: build.summary,
    actions: build.actions,
    commands: [],
    githubTools: [],
    vscodeActions: [],
  };
}