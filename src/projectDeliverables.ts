/**
 * Entrega automática de proyectos al Escritorio del usuario.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function resolveDesktopDir(): string {
  const home = os.homedir();
  const candidates = [
    process.env.XDG_DESKTOP_DIR,
    path.join(home, 'Escritorio'),
    path.join(home, 'Desktop'),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    if (fs.existsSync(dir)) { return dir; }
  }
  const fallback = path.join(home, 'Escritorio');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

export function wantsDesktopDelivery(prompt: string): boolean {
  return /\b(escritorio|desktop|mover\s+al\s+escritorio|poner\s+en\s+(?:mi\s+)?escritorio|ponlo\s+en\s+el\s+escritorio)\b/i.test(prompt) ||
    /google\.com\/maps\/contrib\//i.test(prompt);
}

export function detectDeliverableKind(prompt: string): 'nekotina-bot' | 'animalist-web' | 'generic' {
  if (/\b(nekotina|bot\s+(?:de\s+)?discord|discord\s+bot)\b/i.test(prompt) &&
      /\b(impresionante|completo|de\s+todo|música|musica|trivia)\b/i.test(prompt)) {
    return 'nekotina-bot';
  }
  if (/\b(animalista|p[aá]gina\s+web|sitio\s+web)\b/i.test(prompt)) {
    return 'animalist-web';
  }
  return 'generic';
}

export function desktopFolderName(kind: string, projectName: string): string {
  if (kind === 'nekotina-bot') { return 'nekotina-bot'; }
  if (kind === 'animalist-web') { return 'web-animalista-pilahito'; }
  const safe = projectName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'proyecto-local-copilot';
  return safe;
}

const SKIP_COPY = new Set(['node_modules', '.git', 'dist', 'out', '.vscode']);

export function copyProjectToDesktop(
  sourceRoot: string,
  destFolderName: string
): { destPath: string; fileCount: number } {
  const desktop = resolveDesktopDir();
  const destPath = path.join(desktop, destFolderName);
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath, { recursive: true, force: true });
  }
  fs.mkdirSync(destPath, { recursive: true });
  let fileCount = 0;

  const walk = (rel: string) => {
    const src = path.join(sourceRoot, rel);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const ent of entries) {
      if (SKIP_COPY.has(ent.name)) { continue; }
      const childRel = rel ? path.join(rel, ent.name) : ent.name;
      const srcChild = path.join(sourceRoot, childRel);
      const destChild = path.join(destPath, childRel);
      if (ent.isDirectory()) {
        fs.mkdirSync(destChild, { recursive: true });
        walk(childRel);
      } else if (ent.isFile()) {
        fs.mkdirSync(path.dirname(destChild), { recursive: true });
        fs.copyFileSync(srcChild, destChild);
        fileCount += 1;
      }
    }
  };
  walk('');
  return { destPath, fileCount };
}