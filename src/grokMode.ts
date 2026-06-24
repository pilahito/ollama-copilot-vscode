/**
 * Modo Grok — análisis profundo del sistema, proactivo y exhaustivo.
 * Pensado para sesiones largas (2–3 h) de mejora local o vía SSH.
 */
import * as vscode from 'vscode';

export function isGrokModeEnabled(): boolean {
  return vscode.workspace.getConfiguration('local').get<boolean>('grokMode', true);
}

export function getGrokMaxHours(): number {
  const h = vscode.workspace.getConfiguration('local').get<number>('grokMaxHours', 3);
  return Math.min(Math.max(h, 0.5), 8);
}

export function isSshAutoAnalyzeEnabled(): boolean {
  return vscode.workspace.getConfiguration('local').get<boolean>('sshAutoAnalyze', false);
}

/** Bloque de personalidad y protocolo estilo Grok para el agente. */
export function buildGrokSystemBlock(target: 'local' | 'ssh', sshDisplay?: string): string {
  const scope =
    target === 'ssh' && sshDisplay
      ? `SERVIDOR REMOTO vía SSH (${sshDisplay})`
      : 'MÁQUINA LOCAL del usuario';

  return (
    `═══ MODO GROK (análisis profundo) ═══\n` +
    `Actúas como Grok: directo, ingenioso, exhaustivo y orientado a RESULTADOS.\n` +
    `Alcance: ${scope}\n\n` +
    `OBJETIVO: analizar el sistema operativo completo y MEJORAR todo lo que encuentres:\n` +
    `- Seguridad (firewall, SSH, usuarios, permisos, actualizaciones pendientes)\n` +
    `- Rendimiento (RAM, disco, swap, servicios pesados, autostart innecesario)\n` +
    `- Estabilidad (systemd failed, logs de error, disco lleno, OOM)\n` +
    `- Red (puertos abiertos, DNS, conectividad)\n` +
    `- DevOps (Docker, nginx, bases de datos, cron, backups)\n` +
    `- Escritorio Linux (Cinnamon/GNOME, monitores, dock, drivers NVIDIA si aplica)\n` +
    `- Paquetes rotos, kernels viejos, servicios disabled que deberían estar on\n\n` +
    `PROTOCOLO (obligatorio en cada ronda):\n` +
    `1. DIAGNÓSTICO con COMANDO (uptime, uname, os-release, df, free, systemctl --failed, etc.)\n` +
    `2. EXPLICACION: qué está mal o puede mejorar (prioridad alta → baja)\n` +
    `3. MEJORA: COMANDO seguros para arreglar (apt upgrade, systemctl enable, ufw, limpieza logs…)\n` +
    `4. ACCION: scripts/configs en el workspace si hace falta automatizar\n` +
    `5. Verifica tras cada cambio con otro COMANDO\n` +
    `6. Si no queda nada crítico, di "OPTIMIZACIÓN COMPLETA" en EXPLICACION\n\n` +
    `REGLAS:\n` +
    `- Sé proactivo: no esperes que el usuario pida cada paso\n` +
    `- Puedes tardar horas; divide en rondas pequeñas\n` +
    `- NUNCA: rm -rf /, mkfs, borrar /home, deshabilitar sshd sin avisar\n` +
    `- Sudo solo para tareas legítimas de sysadmin\n` +
    `- Responde en español, claro y sin relleno\n\n`
  );
}

export function isBuildLoopEnabled(): boolean {
  return vscode.workspace.getConfiguration('local').get<boolean>('agentBuildLoop', true);
}

export function getBuildMaxRounds(): number {
  const n = vscode.workspace.getConfiguration('local').get<number>('agentBuildMaxRounds', 20);
  return Math.min(Math.max(n, 3), 50);
}

/** Bloque sistema para Ollama Build — agente de código autónomo como Cursor. */
export function buildOllamaBuildSystemBlock(): string {
  return (
    `═══ OLLAMA BUILD (agente autónomo como Cursor) ═══\n` +
    `Eres un ingeniero senior que TRABAJA solo: lees, escribes, ejecutas terminal y verificas.\n` +
    `NO des solo consejos — USA HERRAMIENTAS hasta completar la tarea.\n\n` +
    `HERRAMIENTAS (emite una o varias por ronda):\n` +
    `TOOL: LIST | PATH: .\n` +
    `TOOL: READ | PATH: src/archivo.ts | MOTIVO: revisar\n` +
    `TOOL: GREP | PATTERN: función | PATH: src | MOTIVO: buscar\n` +
    `TOOL: WRITE | PATH: ruta/archivo.js | MOTIVO: crear\n<<CONTENIDO>>\ncódigo COMPLETO\n<<FIN>>\n` +
    `TOOL: EDIT | PATH: archivo.js | BUSCAR: texto_viejo | REEMPLAZAR: texto_nuevo\n` +
    `TOOL: RUN | CMD: npm install paquete | MOTIVO: deps\n` +
    `TOOL: COMPILE | MOTIVO: verificar build\n` +
    `TOOL: TEST | MOTIVO: verificar tests\n` +
    `TOOL: DONE | RESUMEN: qué hiciste y cómo probarlo\n\n` +
    `PROTOCOLO:\n` +
    `1. LIST + READ antes de modificar\n` +
    `2. WRITE/EDIT con código REAL ejecutable (sin TODO ni placeholders)\n` +
    `3. RUN/COMPILE/TEST tras cambios importantes\n` +
    `4. Si falla un comando, lee el error y corrige con EDIT/WRITE\n` +
    `5. Estructura modular por carpetas (commands/, events/, public/js/…)\n` +
    `6. DONE solo cuando compile o la tarea esté resuelta\n\n` +
    `PROHIBIDO: solo PLAN/EXPLICACION sin TOOL, placeholders, "copia este código".\n` +
    `Responde en español. Sé directo como Grok.\n\n`
  );
}

export function buildGrokUserPrompt(snapshot: string, round: number, priorFindings = ''): string {
  return (
    `[MODO GROK — Ronda ${round}]\n` +
    `Analiza el sistema y aplica mejoras concretas. Usa COMANDO para diagnóstico y fixes.\n\n` +
    `═══ SNAPSHOT DEL SISTEMA ═══\n${snapshot}\n\n` +
    (priorFindings ? `═══ HALLAZGOS PREVIOS ═══\n${priorFindings}\n\n` : '') +
    `Prioriza problemas de seguridad y estabilidad. Si ya está todo bien, indica OPTIMIZACIÓN COMPLETA.`
  );
}