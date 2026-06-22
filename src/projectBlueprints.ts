/**
 * Plantillas de proyecto con sentido común — el agente crea por capas ordenadas.
 */

export type ProjectKind =
  | 'discord-bot'
  | 'web-static'
  | 'web-game'
  | 'api-rest'
  | 'minecraft-plugin'
  | 'minecraft-mod-fabric'
  | 'minecraft-mod-forge'
  | 'android-rom'
  | 'vscode-extension'
  | 'generic';

export interface BlueprintFile {
  path: string;
  role: string;
}

export interface BlueprintCommand {
  command: string;
  reason: string;
}

export interface ProjectBlueprint {
  kind: ProjectKind;
  label: string;
  folders: string[];
  modulesToCreate: string[];
  filesToModify: string[];
  commands: BlueprintCommand[];
  planSteps: string[];
  summary: string;
  hint: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, '');

/** Carpetas y módulos por funcionalidad (radio, música, juegos…) — una carpeta = una feature. */
export interface FeatureModules {
  folders: string[];
  modules: string[];
}

/** Detecta features del prompt y devuelve carpetas + archivos modulares (no todo en index.js). */
export function inferFeatureModules(prompt: string, cmdBase = 'commands/'): FeatureModules {
  const folders: string[] = [];
  const modules: string[] = [];
  const preferSpanish = /\b(musica|música|juegos?|caperta|carpeta|bot\s+de\s+discord)\b/i.test(prompt);

  if (/\b(radio|emisora|fm|streaming\s+radio)\b/i.test(prompt)) {
    folders.push('radio');
    modules.push('radio/player.js', `${cmdBase}radio.js`);
  }
  if (/\b(musica|música|music|spotify|playlist|cancion|canción|reproducir|cola\s+de\s+música)\b/i.test(prompt)) {
    const f = preferSpanish ? 'musica' : 'music';
    folders.push(f);
    modules.push(`${f}/player.js`, `${cmdBase}${f}.js`);
  }
  if (/\b(juegos?|games?|minijuegos?|trivia|quiz|adivina|piedra\s+papel|tres\s+en\s+raya)\b/i.test(prompt)) {
    const f = preferSpanish ? 'juegos' : 'games';
    folders.push(f);
    const gameFile = prompt.match(/\b(trivia|quiz|adivina|snake|pong|tres\s+en\s+raya)\b/i)?.[1];
    modules.push(
      gameFile ? `${f}/${slug(gameFile)}.js` : `${f}/trivia.js`,
      `${cmdBase}${f}.js`
    );
  }
  if (/\b(multimedia|im[aá]genes?|fotos?|galer[ií]a)\b/i.test(prompt)) {
    folders.push('multimedia');
    modules.push('multimedia/storage.js', `${cmdBase}multimedia.js`);
  }

  return {
    folders: [...new Set(folders)],
    modules: [...new Set(modules)],
  };
}

export function wantsDiscordBot(prompt: string): boolean {
  return /\b(bot\s+(?:de\s+)?discord|discord\s+bot|bot\s+discord|discordjs|discord\.js|bot\s+para\s+discord|bot\s+impresionante|bot\s+flipante|bot\s+completo)\b/i.test(prompt);
}

export function wantsWebPage(prompt: string): boolean {
  return /\b(p[aá]gina\s+web|sitio\s+web|landing\s+page|crea(?:r|me)?\s+(?:una\s+)?(?:p[aá]gina|web|sitio)|p[aá]gina\s+html|website|front[- ]?end)\b/i.test(prompt);
}

export function wantsGame(prompt: string): boolean {
  return /\b(juego|game|snake|tetris|pong|ahorcado|tres\s+en\s+raya|tic\s+tac\s+toe|memory\s+game|quiz\s+game|adivina|runner)\b/i.test(prompt);
}

export function wantsRestApi(prompt: string): boolean {
  return /\b(api\s+rest|rest\s+api|backend\s+express|servidor\s+express|crea(?:r|me)?\s+una\s+api|endpoints?\s+api)\b/i.test(prompt);
}

export function wantsMinecraftPlugin(prompt: string): boolean {
  return /\b(plugin\s+(?:de\s+)?minecraft|minecraft\s+plugin|papermc|paper\s*mc|spigot|bukkit|servidor\s+minecraft|plugin\s+para\s+(?:el\s+)?servidor)\b/i.test(prompt) ||
    (/\b(minecraft|mc)\b/i.test(prompt) && /\bplugin\b/i.test(prompt));
}

export function wantsMinecraftModFabric(prompt: string): boolean {
  return /\b(fabric|quilt)\b/i.test(prompt) && /\b(mod|minecraft|mc)\b/i.test(prompt);
}

export function wantsMinecraftModForge(prompt: string): boolean {
  return /\b(forge|neoforge|neo\s*forge)\b/i.test(prompt) && /\b(mod|minecraft|mc)\b/i.test(prompt);
}

export function wantsMinecraftMod(prompt: string): boolean {
  return wantsMinecraftModFabric(prompt) || wantsMinecraftModForge(prompt) ||
    (/\b(mod\s+(?:de\s+)?minecraft|minecraft\s+mod|mod\s+para\s+minecraft)\b/i.test(prompt));
}

export function wantsAndroidRom(prompt: string): boolean {
  return /\b(rom\s+custom|custom\s+rom|lineage\s*os|lineageos|aosp|compilar\s+rom|build\s+rom|android\s+rom|rom\s+android|rom\s+para\s+|port\s+rom|gsi\s+rom)\b/i.test(prompt);
}

export function wantsVscodeExtension(prompt: string): boolean {
  return /\b(extensi[oó]n\s+(?:de\s+)?vscode|extensi[oó]n\s+vs\s*code|vs\s*code\s+extension|vscode\s+extension|plugin\s+(?:de\s+)?vscode|crea(?:r|me)?\s+una\s+extensi[oó]n)\b/i.test(prompt);
}

export function wantsGenericModOrPlugin(prompt: string): boolean {
  return /\b(crea(?:r|me)?\s+(?:un\s+)?(?:mod|plugin|addon|add-on)|mod\s+para|plugin\s+para|addon\s+para)\b/i.test(prompt) &&
    !wantsDiscordBot(prompt) && !wantsVscodeExtension(prompt);
}

/** Nombre Java-safe derivado del prompt (paquete/clase). */
function javaProjectName(prompt: string, fallback: string): string {
  const m = prompt.match(/\b(?:plugin|mod|llamado?|nombre)\s+['"]?([a-zA-Z][\w-]{2,24})/i);
  const raw = m?.[1] ?? fallback;
  const parts = raw.replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('') || 'MyProject';
}

export function detectBlueprint(
  userPrompt: string,
  stack: string[],
  hasPackageJson: boolean,
  hasIndexJs: boolean,
  primaryEntry: string
): ProjectBlueprint | null {
  const isDiscord = stack.includes('Discord.js') || wantsDiscordBot(userPrompt);
  const cmdBase = 'commands/';
  const evtBase = 'events/';

  if (wantsVscodeExtension(userPrompt)) {
    const extName = slug(userPrompt.match(/\bextensi[oó]n\s+(\w+)/i)?.[1] ?? 'my-extension');
    return {
      kind: 'vscode-extension',
      label: 'Extensión VS Code',
      folders: ['src'],
      modulesToCreate: ['package.json', 'tsconfig.json', 'src/extension.ts'],
      filesToModify: [],
      commands: [{ command: 'npm install', reason: 'Dependencias @types/vscode y esbuild' }],
      planSteps: [
        '1. package.json con contributes.commands',
        '2. src/extension.ts con activate/deactivate',
        '3. npm run compile + vsce package',
      ],
      summary:
        `Extensión VS Code "${extName}": package.json + src/extension.ts. ` +
        'Patrón oficial VS Code Extension API.',
      hint:
        'OBLIGATORIO: CREAR package.json (engines.vscode, contributes) + src/extension.ts con registerCommand. ' +
        'COMANDO npm install. Usa @types/vscode. NO extension.js monolítico sin package.json.',
    };
  }

  if (wantsAndroidRom(userPrompt)) {
    const device = slug(userPrompt.match(/\b(?:para|device|dispositivo)\s+([a-z0-9_-]+)/i)?.[1] ?? 'generic');
    return {
      kind: 'android-rom',
      label: 'ROM Android (AOSP/Lineage)',
      folders: ['scripts', `device/${device}`, 'vendor', 'kernel'],
      modulesToCreate: [
        'scripts/setup-aosp.sh',
        'scripts/build-rom.sh',
        `device/${device}/device.mk`,
        `device/${device}/BoardConfig.mk`,
        `device/${device}/lineage_${device}.mk`,
      ],
      filesToModify: [],
      commands: [],
      planSteps: [
        '1. Scripts de entorno (repo, deps Ubuntu)',
        '2. Esqueleto device tree (device.mk, BoardConfig.mk)',
        '3. README de pasos: kernel, vendor blobs, breakfast/brunch',
        '4. Advertir: ROM completa requiere blobs del fabricante',
      ],
      summary:
        `Scaffold ROM Android para "${device}": scripts de build AOSP/Lineage + device tree base. ` +
        'Una ROM flashable necesita kernel + vendor blobs del dispositivo real.',
      hint:
        'OBLIGATORIO ROM: CREAR scripts/setup-aosp.sh y scripts/build-rom.sh (repo init, sync, breakfast). ' +
        `CREAR device/${device}/ con device.mk y BoardConfig.mk (plantilla comentada). ` +
        'EXPLICACION debe listar: 1) requisitos 100GB+ RAM 2) blobs propietarios 3) kernel device-specific. ' +
        'NO prometas ZIP flashable sin blobs — sé honesto. Usa APIs/build system oficiales (repo, soong, lineage).',
    };
  }

  if (wantsMinecraftModFabric(userPrompt) || (wantsMinecraftMod(userPrompt) && !wantsMinecraftModForge(userPrompt))) {
    const name = javaProjectName(userPrompt, 'MyMod');
    const pkg = `com.example.${name.toLowerCase()}`;
    return {
      kind: 'minecraft-mod-fabric',
      label: 'Mod Minecraft (Fabric)',
      folders: ['src/main/java', 'src/main/resources'],
      modulesToCreate: [
        'build.gradle',
        'gradle.properties',
        'settings.gradle',
        `src/main/java/${pkg.replace(/\./g, '/')}/${name}Mod.java`,
        'src/main/resources/fabric.mod.json',
      ],
      filesToModify: [],
      commands: [{ command: './gradlew build', reason: 'Compilar mod Fabric' }],
      planSteps: [
        '1. Gradle + fabric-loom',
        '2. fabric.mod.json con entrypoints',
        '3. Clase Mod principal + features en paquetes',
        '4. ./gradlew build → jar en build/libs/',
      ],
      summary:
        `Mod Fabric "${name}": Gradle + fabric.mod.json + ${name}Mod.java. ` +
        'Usa Fabric API oficial — no Spigot ni Bukkit.',
      hint:
        'OBLIGATORIO Fabric: CREAR build.gradle con fabric-loom, fabric.mod.json, clase Java con ModInitializer. ' +
        'Registrar items/blocks/events en paquetes separados. COMANDO ./gradlew build al final.',
    };
  }

  if (wantsMinecraftModForge(userPrompt)) {
    const name = javaProjectName(userPrompt, 'MyMod');
    const pkg = `com.example.${name.toLowerCase()}`;
    return {
      kind: 'minecraft-mod-forge',
      label: 'Mod Minecraft (Forge)',
      folders: ['src/main/java', 'src/main/resources/META-INF'],
      modulesToCreate: [
        'build.gradle',
        'gradle.properties',
        `src/main/java/${pkg.replace(/\./g, '/')}/${name}Mod.java`,
        'src/main/resources/META-INF/mods.toml',
      ],
      filesToModify: [],
      commands: [{ command: './gradlew build', reason: 'Compilar mod Forge' }],
      planSteps: [
        '1. Gradle + ForgeGradle',
        '2. mods.toml con modId',
        '3. @Mod clase principal',
        '4. ./gradlew build',
      ],
      summary: `Mod Forge/NeoForge "${name}": mods.toml + clase @Mod + Gradle.`,
      hint:
        'OBLIGATORIO Forge: CREAR mods.toml, build.gradle con ForgeGradle, clase @Mod. ' +
        'Paquetes por feature (items/, events/). ./gradlew build genera el jar.',
    };
  }

  if (wantsMinecraftPlugin(userPrompt)) {
    const name = javaProjectName(userPrompt, 'MyPlugin');
    const pkg = `com.example.${name.toLowerCase()}`;
    return {
      kind: 'minecraft-plugin',
      label: 'Plugin Minecraft (Paper/Spigot)',
      folders: ['src/main/java', 'src/main/resources'],
      modulesToCreate: [
        'build.gradle',
        'settings.gradle',
        `src/main/java/${pkg.replace(/\./g, '/')}/${name}Plugin.java`,
        'src/main/resources/plugin.yml',
        `src/main/java/${pkg.replace(/\./g, '/')}/commands/PingCommand.java`,
      ],
      filesToModify: [],
      commands: [{ command: './gradlew build', reason: 'Compilar plugin Paper' }],
      planSteps: [
        '1. Gradle + paper-api',
        '2. plugin.yml (main, commands, permissions)',
        '3. JavaPlugin + comandos en commands/',
        '4. Copiar jar a plugins/',
      ],
      summary:
        `Plugin Paper/Spigot "${name}": plugin.yml + ${name}Plugin.java + comandos en commands/.`,
      hint:
        'OBLIGATORIO Plugin: CREAR plugin.yml con main y commands, clase extends JavaPlugin, ' +
        'comandos en commands/*.java (CommandExecutor). build.gradle con paper-api. ' +
        'COMANDO ./gradlew build. jar final va a servidor/plugins/.',
    };
  }

  if (isDiscord) {
    const features = inferFeatureModules(userPrompt, cmdBase);
    const modules = [
      `${cmdBase}ping.js`,
      `${evtBase}ready.js`,
      ...features.modules,
    ];
    const cmdMatch = userPrompt.match(/\bcomando\s+!?([\w-]+)/i);
    if (cmdMatch) {
      modules.push(`${cmdBase}${slug(cmdMatch[1])}.js`);
    }

    const folders = ['commands', 'events', 'utils', 'data', ...features.folders];

    const commands: BlueprintCommand[] = [];
    if (!hasPackageJson) {
      commands.push({ command: 'npm init -y', reason: 'Inicializar proyecto Node para el bot' });
    }
    if (!stack.includes('Discord.js')) {
      commands.push({
        command: 'npm install discord.js dotenv',
        reason: 'Instalar Discord.js y variables de entorno',
      });
    }

    return {
      kind: 'discord-bot',
      label: 'Bot de Discord',
      folders,
      modulesToCreate: [...new Set(modules)],
      filesToModify: [primaryEntry],
      commands,
      planSteps: [
        '1. npm init + discord.js',
        '2. Carpetas base: commands/ events/ utils/',
        features.folders.length
          ? `3. Carpetas por feature: ${features.folders.map((f) => f + '/').join(', ')}`
          : '3. Una carpeta por funcionalidad (radio/, musica/, juegos/…)',
        '4. Lógica en su carpeta; commands/*.js solo invoca el módulo',
        `5. ${primaryEntry} solo arranca Client y carga handlers`,
      ],
      summary:
        `Bot Discord modular: ${[...new Set(folders)].map((f) => f + '/').join(', ')}. ` +
        `Cada feature en su carpeta (radio/player.js, musica/player.js, juegos/*.js). ` +
        `Comandos en ${cmdBase}*.js delegan al módulo. ${primaryEntry} SOLO login + load handlers.`,
      hint:
        'OBLIGATORIO Discord: COMANDO npm install discord.js dotenv si falta. ' +
        'CREAR commands/ping.js + events/ready.js + carpetas por feature (radio/, musica/, juegos/ si aplica). ' +
        'APIs externas en services/ (ej. services/triviaApi.js con fetch a Open Trivia DB, services/weatherApi.js). ' +
        'La lógica va DENTRO de la carpeta de la feature, NO toda en index.js. ' +
        'CREAR .env.example (DISCORD_TOKEN=) — nunca hardcodear secretos. Un módulo = una responsabilidad.',
    };
  }

  if (wantsWebPage(userPrompt) && !wantsGame(userPrompt)) {
    const folders = ['public', 'public/css', 'public/js', 'public/assets'];
    const modules = [
      'public/index.html',
      'public/css/styles.css',
      'public/js/main.js',
    ];
    return {
      kind: 'web-static',
      label: 'Página web',
      folders,
      modulesToCreate: modules,
      filesToModify: [],
      commands: [],
      planSteps: [
        '1. Estructura public/ css/ js/ assets/',
        '2. index.html semántico y enlaces',
        '3. CSS en styles.css (no inline masivo)',
        '4. JS en main.js (interactividad)',
      ],
      summary:
        'Web estática organizada: public/index.html + public/css/styles.css + public/js/main.js. ' +
        'HTML estructura, CSS presentación, JS comportamiento — archivos separados.',
      hint:
        'OBLIGATORIO web: CREAR public/index.html + public/css/styles.css + public/js/main.js. ' +
        'Diseño responsive básico. Sin meter todo el CSS/JS dentro del HTML.',
    };
  }

  if (wantsGame(userPrompt)) {
    const gameName = userPrompt.match(/\b(snake|tetris|pong|ahorcado|tres\s+en\s+raya|quiz|memory)\b/i)?.[1] ?? 'juego';
    const gameFile = `public/js/${slug(gameName)}.js`;
    const folders = ['public', 'public/css', 'public/js'];
    const modules = [
      'public/index.html',
      'public/css/game.css',
      gameFile,
      'public/js/main.js',
    ];
    return {
      kind: 'web-game',
      label: 'Juego web',
      folders,
      modulesToCreate: modules,
      filesToModify: [],
      commands: [],
      planSteps: [
        '1. Canvas/HTML para el juego en index.html',
        '2. Lógica del juego en public/js/' + slug(gameName) + '.js',
        '3. main.js solo inicializa y enlaza UI',
        '4. game.css para el tablero/estilos',
      ],
      summary:
        `Juego modular: lógica en ${gameFile}, UI en index.html, estilos en public/css/game.css, ` +
        'main.js solo arranca el juego.',
      hint:
        `OBLIGATORIO juego: CREAR ${gameFile} con la lógica completa, ` +
        'public/index.html con canvas o DOM del juego, public/css/game.css, public/js/main.js mínimo.',
    };
  }

  if (wantsRestApi(userPrompt)) {
    const folders = ['routes', 'controllers', 'middleware', 'data'];
    const modules = [
      'routes/index.js',
      'controllers/healthController.js',
    ];
    const commands: BlueprintCommand[] = [];
    if (!hasPackageJson) {
      commands.push({ command: 'npm init -y', reason: 'Inicializar API Node' });
    }
    if (!stack.includes('Express')) {
      commands.push({ command: 'npm install express cors dotenv', reason: 'Express + CORS + env' });
    }

    return {
      kind: 'api-rest',
      label: 'API REST',
      folders,
      modulesToCreate: modules,
      filesToModify: [hasIndexJs ? primaryEntry : 'index.js'],
      commands,
      planSteps: [
        '1. npm init + express',
        '2. routes/ + controllers/',
        '3. index.js solo app.listen y monta rutas',
        '4. Un controlador por recurso',
      ],
      summary:
        'API REST: routes/ + controllers/. index.js solo monta express y rutas. ' +
        'Sin lógica de negocio en index.js.',
      hint:
        'OBLIGATORIO API: COMANDO npm install express. CREAR routes/index.js + controllers/*.js. ' +
        'index.js solo require rutas y listen.',
    };
  }

  if (wantsGenericModOrPlugin(userPrompt)) {
    return {
      kind: 'generic',
      label: 'Mod / Plugin (detectar plataforma)',
      folders: ['src'],
      modulesToCreate: [],
      filesToModify: [primaryEntry],
      commands: [],
      planSteps: [
        '1. Identificar plataforma (Minecraft Paper/Fabric/Forge, VS Code, juego concreto)',
        '2. Usar SDK/API oficial de esa plataforma',
        '3. Estructura modular por feature',
      ],
      summary:
        'Mod/plugin genérico: pregunta o infiere la plataforma y usa su API oficial (no código inventado).',
      hint:
        'Si no especifica plataforma: EXPLICACION debe aclarar Minecraft (plugin Paper vs mod Fabric), ' +
        'VS Code extension, o motor del juego. Luego CREAR con el stack correcto.',
    };
  }

  return null;
}

/** Ordena acciones: carpetas → configs → módulos → entry point al final. */
export function sortActionsByDependency(
  actions: Array<{ filePath: string; type: string }>,
  primaryEntry: string
): typeof actions {
  const score = (fp: string): number => {
    const n = fp.replace(/\\/g, '/');
    if (n.endsWith('.gitkeep')) { return 0; }
    if (n === 'package.json' || n.endsWith('tsconfig.json')) { return 1; }
    if (n.includes('/commands/') || n.includes('/events/') || n.includes('/routes/') ||
        n.includes('/controllers/') || n.includes('public/css/') || n.includes('public/js/') ||
        n.includes('/radio/') || n.includes('/music/') || n.includes('/musica/') ||
        n.includes('/games/') || n.includes('/juegos/') || n.includes('/multimedia/') ||
        n.endsWith('.java') || n.endsWith('.gradle') || n.endsWith('.kts') ||
        n.includes('fabric.mod.json') || n.includes('plugin.yml') || n.includes('mods.toml') ||
        n.includes('device/') || n.includes('scripts/')) {
      return 3;
    }
    if (n.includes('public/index.html')) { return 2; }
    if (n === primaryEntry || n.endsWith('/index.js') || n === 'index.js') { return 5; }
    return 4;
  };

  return [...actions].sort((a, b) => score(a.filePath) - score(b.filePath));
}