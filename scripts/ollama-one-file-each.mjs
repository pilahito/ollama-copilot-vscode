#!/usr/bin/env node
/** Genera UN archivo por llamada Ollama — máxima tasa de éxito */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';

const OLLAMA = 'http://127.0.0.1:11434';
const DIR = process.argv[2] || '/home/david/nekotina-ollama-build';
const MODEL = 'qwen2.5-coder:14b';

const FILES = [
  'commands/ping.js', 'commands/help.js', 'commands/trivia.js', 'commands/weather.js',
  'commands/joke.js', 'commands/pokemon.js', 'commands/economy.js', 'commands/daily.js',
  'commands/moderation.js', 'commands/games.js', 'commands/levels.js', 'commands/memes.js',
  'index.js', 'deploy-commands.js',
];

const SYS =
  'Responde SOLO con esto, nada más:\nACCION: CREAR | RUTA: ARCHIVO | MOTIVO: x\n<<CONTENIDO>>\ncódigo\n<<FIN>>';

async function genOne(file) {
  const raw = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYS },
        {
          role: 'user',
          content:
            `ARCHIVO=${file}\nBot Nekotina discord.js v14. APIs gratis (opentdb, open-meteo, jokeapi, pokeapi). ` +
            `SlashCommandBuilder de "discord.js". module.exports con data y execute.`,
        },
      ],
      stream: false,
      options: { temperature: 0.05, num_predict: 4000 },
    }),
  }).then((r) => r.json()).then((d) => d.message?.content || '');

  const m = raw.match(/<<CONTENIDO>>([\s\S]*?)<<FIN>>/);
  if (!m) return false;
  let c = m[1].trim();
  if (c.startsWith('```')) c = c.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '');
  const full = join(DIR, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, c);
  try { execSync(`node --check "${full}"`, { stdio: 'pipe' }); return true; }
  catch { return false; }
}

for (const f of FILES) {
  if (existsSync(join(DIR, f)) && f.startsWith('commands/')) {
    try { execSync(`node --check "${join(DIR, f)}"`, { stdio: 'pipe' }); console.log(`⏭ ${f} OK`); continue; }
    catch { /* regenerate */ }
  }
  process.stdout.write(`🧠 ${f}… `);
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) ok = await genOne(f);
  console.log(ok ? '✅' : '❌');
}