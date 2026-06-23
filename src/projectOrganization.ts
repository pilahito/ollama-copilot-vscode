/**
 * Guías de organización por tipo de proyecto — siempre carpetas con sentido común.
 */

import type { ProjectBlueprint, ProjectKind } from './projectBlueprints';

const ORGANIZATION_BY_KIND: Partial<Record<ProjectKind, string[]>> = {
  'discord-bot': [
    'commands/ — un .js por slash command (solo delega)',
    'events/ — ready.js, interactionCreate.js',
    'admin/ — moderación, permisos, logs (ban, kick, warn)',
    'services/ — APIs externas (trivia, clima, APIs REST)',
    'data/ — economía, niveles, SQLite/JSON persistente',
    'musica/ o music/ — player.js, cola de reproducción',
    'radio/ — stream.js si hay emisora',
    'juegos/ o games/ — un .js por minijuego',
    'utils/ — helpers reutilizables',
    'index.js — SOLO Client + login + cargar handlers',
  ],
  'minecraft-server': [
    'world/ — mundo generado (NO versionar en git; .gitignore)',
    'plugins/ — .jar de Paper/Spigot (descargar o compilar)',
    'config/ — YAML de plugins (LuckPerms, Essentials…)',
    'logs/ — logs del servidor',
    'server.properties — puerto, gamemode, difficulty',
    'eula.txt — eula=true obligatorio',
    'start.sh / start.bat — arranque con memoria -Xmx',
    'README.md — cómo arrancar y dónde va cada cosa',
  ],
  'minecraft-plugin': [
    'src/main/java/.../commands/ — un CommandExecutor por comando',
    'src/main/java/.../listeners/ — eventos Bukkit',
    'src/main/resources/plugin.yml — main, commands, permissions',
    'build/libs/*.jar → copiar a servidor/plugins/',
  ],
  'web-static': [
    'public/index.html — estructura semántica',
    'public/css/ — estilos (un archivo por sección si crece)',
    'public/js/ — lógica (main.js solo inicia)',
    'public/assets/ — imágenes, fuentes, iconos',
  ],
  'web-game': [
    'public/js/game/ — lógica del juego',
    'public/js/controls.js — input del jugador',
    'public/css/game.css — tablero/canvas',
    'public/assets/sprites/ — gráficos',
  ],
  'api-rest': [
    'routes/ — define endpoints',
    'controllers/ — lógica por recurso',
    'middleware/ — auth, validación',
    'services/ — negocio y acceso a datos',
    'database/ o prisma/ — esquemas, migraciones, seeds',
    'index.js — SOLO app.listen + app.use(routes)',
  ],
  'web-fullstack': [
    'public/ — frontend (html, css, js)',
    'server/ — express/fastify API',
    'database/ — SQL, Prisma schema o models/',
    'server/routes/ + server/controllers/',
    '.env.example — DATABASE_URL, secrets',
  ],
  'vscode-extension': [
    'src/extension.ts — activate/deactivate',
    'src/commands/ — un handler por comando',
    'package.json — contributes.commands',
  ],
  'android-rom': [
    'device/<codename>/ — device tree',
    'kernel/ — fuentes del kernel',
    'vendor/ — blobs propietarios',
    'scripts/ — setup y build',
  ],
  generic: [
    'Una carpeta por feature o capa',
    'Entry point solo cablea — sin lógica monolítica',
    'config/ o .env.example para secretos',
    'README con árbol de carpetas explicado',
  ],
};

/** Bloque para el agente: siempre explicar dónde va cada cosa. */
export function buildOrganizationBlock(blueprint?: ProjectBlueprint | null): string {
  const kind = blueprint?.kind ?? 'generic';
  const lines = ORGANIZATION_BY_KIND[kind] ?? ORGANIZATION_BY_KIND.generic ?? [];

  let block =
    '\n\n═══ ORGANIZACIÓN OBLIGATORIA (SIEMPRE) ═══\n' +
    'Crea el proyecto **ordenado por carpetas**. En EXPLICACION incluye un árbol breve.\n' +
    'Nunca metas todo en un solo archivo si hay varias responsabilidades.\n\n';

  if (blueprint) {
    block += `Proyecto: **${blueprint.label}**\n`;
    if (blueprint.folders.length) {
      block += `Carpetas base: ${blueprint.folders.join(', ')}\n`;
    }
    block += '\n';
  }

  for (const line of lines) {
    block += `• ${line}\n`;
  }

  block +=
    '\nINSTRUCCIÓN: Antes de ACCION, el PLAN debe listar carpetas y qué archivo va en cada una.\n' +
    'Si el usuario pide servidor Minecraft: world/, plugins/, config/ — NO mezclar plugins dentro de world/.\n' +
    'Si pide web con base de datos: separar public/, server/, database/.\n' +
    'Si pide bot Discord: commands/, admin/, musica/, juegos/ — cada feature en su carpeta.\n';

  return block;
}

/** Resumen corto para Chat/Profesor. */
export function organizationTipForKind(kind: ProjectKind | 'generic'): string {
  const tips: Partial<Record<ProjectKind | 'generic', string>> = {
    'discord-bot': 'commands/, events/, admin/, musica/, juegos/ — un módulo por función',
    'minecraft-server': 'world/, plugins/, config/, server.properties, start.sh',
    'minecraft-plugin': 'Java commands/ + plugin.yml → jar en plugins/',
    'web-static': 'public/html + public/css + public/js separados',
    'api-rest': 'routes/ + controllers/ + database/ + index.js mínimo',
    'web-fullstack': 'public/ (front) + server/ (API) + database/ (datos)',
  };
  return tips[kind] ?? 'una carpeta por feature; entry point solo cablea';
}