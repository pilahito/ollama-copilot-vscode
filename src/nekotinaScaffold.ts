/**
 * Plantillas de respaldo para bot Nekotina cuando Ollama no genera un archivo crítico.
 */

export const NEKOTINA_INDEX_JS = `require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.commands = new Collection();

for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter((f) => f.endsWith('.js'))) {
  try {
    const cmd = require(path.join(__dirname, 'commands', file));
    if (cmd?.data?.name && cmd.execute) client.commands.set(cmd.data.name, cmd);
  } catch (e) {
    console.warn(\`⚠ \${file}:\`, e.message);
  }
}

for (const file of fs.readdirSync(path.join(__dirname, 'events')).filter((f) => f.endsWith('.js'))) {
  const ev = require(path.join(__dirname, 'events', file));
  if (!ev?.name || !ev.execute) continue;
  if (ev.once) client.once(ev.name, (...a) => ev.execute(...a));
  else client.on(ev.name, (...a) => ev.execute(...a));
}

const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!token) { console.error('❌ Falta DISCORD_TOKEN en .env'); process.exit(1); }
client.login(token);
`;

export const NEKOTINA_PACKAGE_JSON = `{
  "name": "nekotina-bot",
  "version": "1.0.0",
  "description": "Bot Discord estilo Nekotina — APIs gratuitas (Local Copilot)",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "deploy": "node deploy-commands.js",
    "check": "node scripts/validate.js"
  },
  "engines": { "node": ">=18.0.0" },
  "dependencies": {
    "discord.js": "^14.26.4",
    "dotenv": "^16.6.1"
  }
}
`;

export const NEKOTINA_ENV_EXAMPLE = `DISCORD_TOKEN=tu_token_aqui
CLIENT_ID=tu_client_id
GUILD_ID=id_servidor_opcional
`;

export const NEKOTINA_DEPLOY_COMMANDS = `require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(__dirname, 'commands', file));
  if (cmd?.data?.toJSON) commands.push(cmd.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

(async () => {
  if (!clientId) { console.error('Falta CLIENT_ID'); process.exit(1); }
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commands });
  console.log(\`✅ \${commands.length} comandos registrados\`);
})();
`;

export const NEKOTINA_READY = `module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    console.log(\`🐱 Nekotina-bot conectado como \${client.user.tag}\`);
    client.user.setActivity('🎮 /help', { type: 3 });
  },
};
`;

export const NEKOTINA_INTERACTION = `module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: 'Comando no encontrado.', ephemeral: true });
      return;
    }
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(\`Error en /\${interaction.commandName}:\`, err);
      const payload = { content: '❌ Error ejecutando el comando.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    }
  },
};
`;

export const NEKOTINA_DB = `const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback = {}) {
  ensureDataDir();
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

module.exports = { readJson, writeJson, DATA_DIR };
`;

const SCAFFOLDS: Record<string, string> = {
  'index.js': NEKOTINA_INDEX_JS,
  'package.json': NEKOTINA_PACKAGE_JSON,
  '.env.example': NEKOTINA_ENV_EXAMPLE,
  'deploy-commands.js': NEKOTINA_DEPLOY_COMMANDS,
  'events/ready.js': NEKOTINA_READY,
  'events/interactionCreate.js': NEKOTINA_INTERACTION,
  'utils/db.js': NEKOTINA_DB,
};

export function getNekotinaScaffold(filePath: string): string | null {
  return SCAFFOLDS[filePath] ?? null;
}

export function isNekotinaCriticalFile(filePath: string): boolean {
  return filePath in SCAFFOLDS;
}