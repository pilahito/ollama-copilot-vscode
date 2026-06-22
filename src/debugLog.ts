import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const DEBUG_LOG_PATH = path.join(os.tmpdir(), 'local-copilot-debug.log');
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'local-copilot-screenshots');

let fileLog: ((line: string) => void) | undefined;

/** Registra líneas en archivo + callback opcional (p. ej. Output Channel). */
export function initDebugLog(forward?: (line: string) => void): void {
  fileLog = forward;
  try {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(DEBUG_LOG_PATH, `[${iso()}] ── Local Copilot debug iniciado ──\n`);
  } catch {
    /* sin permisos de escritura */
  }
}

export function getScreenshotDir(): string {
  return SCREENSHOT_DIR;
}

export function debugLog(line: string): void {
  const entry = `[${iso()}] ${line}`;
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, `${entry}\n`);
  } catch {
    /* ignore */
  }
  fileLog?.(entry);
}

function iso(): string {
  return new Date().toISOString();
}