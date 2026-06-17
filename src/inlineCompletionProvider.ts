/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ollama-copilot-vscode — Agente Autónomo Local
 *  (c) 2026 DavidPilahito7 · Licensed under the MIT License.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Author   : DavidPilahito7
 *  Project  : ollama-copilot-vscode
 *  Module   : InlineCompletionProvider — Autocompletado inline (código fantasma)
 *  Created  : 2026
 *  Contact  : https://github.com/pilahito
 *
 *  Este software es propiedad intelectual de DavidPilahito7.
 *  Queda prohibida su redistribución, modificación o uso comercial
 *  sin el consentimiento explícito del autor, salvo los términos
 *  permitidos por la licencia MIT adjunta.
 *
 *  This software is the intellectual property of DavidPilahito7.
 *  Redistribution, modification or commercial use without explicit
 *  consent of the author is prohibited, except as permitted by
 *  the MIT License terms herein.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';

// ── Constantes ────────────────────────────────────────────────────────────────

/** Líneas de contexto capturadas antes del cursor. */
const CONTEXT_LINES_BEFORE = 60;
/** Líneas de contexto capturadas después del cursor. */
const CONTEXT_LINES_AFTER  = 20;
/** Máximo de líneas que puede ocupar una sugerencia en el editor. */
const MAX_SUGGESTION_LINES = 25;
/** Prefijo de texto tras el cursor usado para detectar duplicados. */
const DEDUP_LOOKAHEAD_CHARS = 40;

// ── Tokens FIM de Qwen2.5-Coder ──────────────────────────────────────────────
const FIM_PREFIX   = '<|fim_prefix|>';
const FIM_SUFFIX   = '<|fim_suffix|>';
const FIM_MIDDLE   = '<|fim_middle|>';
const TOKEN_EOT    = '<|endoftext|>';
const TOKEN_FILESEP = '<|file_sep|>';

/**
 * Proveedor de "inline completions": el texto gris fantasma que aparece
 * mientras escribes, igual que GitHub Copilot, pero generado por el
 * modelo local de Ollama (qwen2.5-coder por defecto).
 *
 * @author DavidPilahito7
 * @license MIT
 */
export class LocalInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly ollama: OllamaClient;
  private lastRequestId = 0;

  constructor(ollama: OllamaClient) {
    this.ollama = ollama;
  }

  // ── API de VS Code ────────────────────────────────────────────────────────────

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token:    vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const cfg     = vscode.workspace.getConfiguration('local');
    const enabled = cfg.get('inlineSuggestionsEnabled', true);
    if (!enabled) { return undefined; }

    // Debounce: espera a que el usuario deje de escribir para no saturar Ollama.
    const delay     = cfg.get('completionDelay', 400);
    const requestId = ++this.lastRequestId;

    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    if (token.isCancellationRequested || requestId !== this.lastRequestId) {
      return undefined;
    }

    // Construir el contexto: código antes y después del cursor.
    const textBefore = document.getText(
      new vscode.Range(
        new vscode.Position(Math.max(0, position.line - CONTEXT_LINES_BEFORE), 0),
        position
      )
    );
    const textAfter = document.getText(
      new vscode.Range(
        position,
        new vscode.Position(
          Math.min(document.lineCount, position.line + CONTEXT_LINES_AFTER),
          0
        )
      )
    );

    const prompt = this.buildFimPrompt(textBefore, textAfter);

    try {
      const completion = await this.ollama.generateCompletion(prompt);

      if (token.isCancellationRequested || requestId !== this.lastRequestId) {
        return undefined;
      }

      const cleaned = this.cleanCompletion(completion, textAfter);
      if (!cleaned) { return undefined; }

      return [
        new vscode.InlineCompletionItem(
          cleaned,
          new vscode.Range(position, position)
        )
      ];
    } catch {
      // Si Ollama no responde, no se muestra sugerencia sin romper la edición.
      return undefined;
    }
  }

  // ── Helpers privados ──────────────────────────────────────────────────────────

  /**
   * Construye un prompt FIM (Fill-In-the-Middle) usando los tokens nativos
   * de Qwen2.5-Coder, forzando al modelo a rellenar únicamente el hueco central.
   */
  private buildFimPrompt(before: string, after: string): string {
    return `${FIM_PREFIX}${before}${FIM_SUFFIX}${after}${FIM_MIDDLE}`;
  }

  /**
   * Limpia la respuesta del modelo:
   * - Elimina bloques Markdown y tokens residuales del modelo.
   * - Evita duplicar texto que ya existe después del cursor.
   * - Limita la sugerencia a {@link MAX_SUGGESTION_LINES} líneas.
   */
  private cleanCompletion(raw: string, textAfter: string): string {
    let text = raw;

    // Quitar bloques Markdown y tokens especiales del modelo.
    text = text.replace(/```[\w]*\n?/g, '').replace(/```$/g, '');
    text = text.replace(TOKEN_EOT, '').replace(TOKEN_FILESEP, '');

    // Cortar si el modelo empieza a repetir el texto que ya viene después del cursor.
    const afterStart = textAfter.slice(0, DEDUP_LOOKAHEAD_CHARS).trim();
    if (afterStart.length > 5) {
      const idx = text.indexOf(afterStart);
      if (idx > -1) { text = text.slice(0, idx); }
    }

    // Limitar a un número razonable de líneas para no inundar el editor.
    const lines = text.split('\n');
    if (lines.length > MAX_SUGGESTION_LINES) {
      text = lines.slice(0, MAX_SUGGESTION_LINES).join('\n');
    }

    return text.trimEnd();
  }
}
