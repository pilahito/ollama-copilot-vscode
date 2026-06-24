/**
 * Asistente para elegir tipo de proyecto (web, Discord, WhatsApp…) y recopilar requisitos.
 */

import * as vscode from 'vscode';
import type { ProjectBlueprint, ProjectKind } from './projectBlueprints';
import { detectBlueprint } from './projectBlueprints';
import {
  buildClarificationMessage,
  startRequirementsSession,
  type RequirementsSession,
} from './requirementsGatherer';

export interface ProjectTypeChoice {
  kind: ProjectKind;
  label: string;
  seed: string;
  detail: string;
}

export const PROJECT_TYPE_CHOICES: ProjectTypeChoice[] = [
  {
    kind: 'web-static',
    label: '🌐 Página web / landing',
    seed: 'Crea una página web profesional con HTML, CSS y JavaScript',
    detail: 'Sitios, landings, portfolios',
  },
  {
    kind: 'web-fullstack',
    label: '🗄️ Web + base de datos',
    seed: 'Crea una aplicación web fullstack con frontend, API y base de datos',
    detail: 'React/Vue + Express + SQLite/Postgres',
  },
  {
    kind: 'discord-bot',
    label: '💬 Bot de Discord',
    seed: 'Crea un bot de Discord con discord.js y comandos slash',
    detail: 'Música, moderación, economía, juegos…',
  },
  {
    kind: 'whatsapp-bot',
    label: '📱 Bot de WhatsApp',
    seed: 'Crea un bot de WhatsApp con respuestas automáticas y menú',
    detail: 'whatsapp-web.js o Baileys',
  },
  {
    kind: 'telegram-bot',
    label: '✈️ Bot de Telegram',
    seed: 'Crea un bot de Telegram con telegraf y comandos',
    detail: 'Handlers, teclados, notificaciones',
  },
  {
    kind: 'api-rest',
    label: '🔌 API REST',
    seed: 'Crea una API REST con endpoints documentados',
    detail: 'Express, FastAPI, autenticación JWT',
  },
  {
    kind: 'minecraft-plugin',
    label: '⛏️ Plugin Minecraft',
    seed: 'Crea un plugin de Minecraft para servidor Paper',
    detail: 'Comandos, eventos, configuración YAML',
  },
  {
    kind: 'vscode-extension',
    label: '🧩 Extensión VS Code',
    seed: 'Crea una extensión de Visual Studio Code',
    detail: 'Comandos, webview, package.json',
  },
  {
    kind: 'web-game',
    label: '🎮 Juego web',
    seed: 'Crea un juego web jugable en el navegador',
    detail: 'Canvas, controles teclado/ratón',
  },
];

const KIND_LABELS: Partial<Record<ProjectKind, string>> = {
  'web-static': 'Página web',
  'web-fullstack': 'Web fullstack',
  'discord-bot': 'Bot de Discord',
  'whatsapp-bot': 'Bot de WhatsApp',
  'telegram-bot': 'Bot de Telegram',
  'api-rest': 'API REST',
  'minecraft-plugin': 'Plugin Minecraft',
  'vscode-extension': 'Extensión VS Code',
  'web-game': 'Juego web',
};

function minimalBlueprint(choice: ProjectTypeChoice): ProjectBlueprint {
  return {
    kind: choice.kind,
    label: KIND_LABELS[choice.kind] ?? choice.label.replace(/^[^\s]+\s/, ''),
    folders: [],
    modulesToCreate: [],
    filesToModify: [],
    commands: [],
    planSteps: [],
    summary: choice.seed,
    hint: choice.detail,
  };
}

/** Paleta VS Code: elige qué quieres programar. */
export async function pickProjectType(): Promise<ProjectTypeChoice | undefined> {
  const picked = await vscode.window.showQuickPick(
    PROJECT_TYPE_CHOICES.map((c) => ({
      label: c.label,
      description: c.detail,
      detail: c.seed,
      choice: c,
    })),
    {
      title: 'Local Copilot — ¿Qué quieres programar?',
      placeHolder: 'Web, Discord, WhatsApp, API, plugin Minecraft…',
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );
  return picked?.choice;
}

export function beginRequirementsForChoice(choice: ProjectTypeChoice): RequirementsSession | null {
  const detected = detectBlueprint(choice.seed, [], false, false, 'index.js');
  const blueprint =
    detected?.kind === choice.kind ? detected : minimalBlueprint(choice);
  return startRequirementsSession(choice.seed, blueprint);
}

export function clarificationForChoice(choice: ProjectTypeChoice): string | null {
  const session = beginRequirementsForChoice(choice);
  if (!session) { return null; }
  return buildClarificationMessage(session);
}

export function sessionForChoice(choice: ProjectTypeChoice): RequirementsSession | null {
  return beginRequirementsForChoice(choice);
}