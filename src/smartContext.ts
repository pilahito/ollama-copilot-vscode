/**
 * Contexto inteligente: npm, APIs gratis, plantillas GitHub y hardware Ollama.
 */

import type { GitHubService } from './githubService';
import type { HardwareProfile } from './hardwareProfile';
import { formatFreeApisForPrompt } from './freeApiRegistry';
import { gatherNpmContext } from './npmRegistry';
import { buildHardwareAdviceBlock } from './hardwareProfile';
import type { ProjectBlueprint } from './projectBlueprints';

export interface SmartContextOptions {
  prompt: string;
  blueprint?: ProjectBlueprint | null;
  internetEnabled: boolean;
  github?: GitHubService;
  hardware?: HardwareProfile;
}

export interface SmartContextResult {
  block: string;
  summary: string;
}

export async function gatherSmartContext(opts: SmartContextOptions): Promise<SmartContextResult | null> {
  const parts: string[] = [];
  const summaries: string[] = [];

  if (opts.hardware) {
    const hwBlock = buildHardwareAdviceBlock(opts.hardware, opts.prompt);
    if (hwBlock) {
      parts.push(hwBlock);
      summaries.push('modelo Ollama');
    }
  }

  parts.push(formatFreeApisForPrompt(opts.prompt));
  summaries.push('APIs gratis');

  if (opts.internetEnabled) {
    const npm = await gatherNpmContext(opts.prompt);
    if (npm) {
      parts.push(npm);
      summaries.push('npm');
    }

    if (opts.github && opts.blueprint) {
      try {
        const templates = await opts.github.searchTemplateRepos(opts.blueprint.kind, opts.prompt, 5);
        const tplBlock = opts.github.formatTemplatesForPrompt(templates);
        if (tplBlock) {
          parts.push(tplBlock);
          summaries.push(`${templates.length} plantilla(s) GitHub`);
        }
      } catch { /* sin auth o límite API */ }
    }
  }

  const block = parts.filter(Boolean).join('\n\n');
  if (!block.trim()) { return null; }

  return {
    block,
    summary: `📦 Contexto: ${summaries.join(', ')}`,
  };
}