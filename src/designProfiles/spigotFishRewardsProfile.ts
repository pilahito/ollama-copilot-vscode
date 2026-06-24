/**
 * Perfil Spigot/Paper — FishRewards y plugins YAML de Minecraft.
 * Referencia: https://www.spigotmc.org/resources/fishrewards.111966/
 */
export function wantsMinecraftPluginHelp(prompt: string): boolean {
  return /\b(fishrewards|fish.?reward|spigot|paper|bukkit|plugin.?minecraft|pack_|entitypack|minecraft.?plugin)\b/i.test(prompt);
}

export function buildSpigotFishRewardsBlock(): string {
  return (
    '═══ SPIGOT/PAPER — FishRewards 1.6.9 ═══\n' +
    'Al editar packs YAML del plugin FishRewards:\n' +
    '- Efectos cofre: BALL, BALL_LARGE, BURST, CREEPER, FIREWORKS_SPARK, DRIP_WATER, FLAME, SPELL_WITCH\n' +
    '- PROHIBIDO: STAR (rompe en Paper 26.1), SPELL_MOB (inválido)\n' +
    '- Items: `material: NETHER_STAR` + `amount:` O bloque ItemStack con `id: minecraft:nether_star`\n' +
    '- Comandos: `eco give {player} 1000` (Vault), `effect give {player} minecraft:luck 600 1`\n' +
    '- Mobs: `type: mob` + `entitytype: WARDEN` + `amount:` + `chance:`\n' +
    '- Tras cambios: `/fishrewards reload` en consola del servidor\n' +
    '- Servidor Solaris: packs en `plugins/FishRewards/packs/`\n' +
    '- Valida con: `node scripts/validate-fishrewards.mjs packs/`\n' +
    '- Despliega fixed/ → packs/ y ejecuta INSTALAR-EN-SOLARIS.sh como usuario amp\n\n'
  );
}