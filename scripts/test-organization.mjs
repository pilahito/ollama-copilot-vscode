#!/usr/bin/env node
/** Prueba blueprints de organización (servidor MC, Discord, web+DB). */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };

const bp = readFileSync(join(ROOT, 'src/projectBlueprints.ts'), 'utf8');
const org = readFileSync(join(ROOT, 'src/projectOrganization.ts'), 'utf8');
const layout = readFileSync(join(ROOT, 'src/copilotLayout.ts'), 'utf8');
const ext = readFileSync(join(ROOT, 'dist/extension.js'), 'utf8');

console.log('\n🧪 Organización + dock toggle v1.0.37\n');

bp.includes('wantsMinecraftServer') && bp.includes("'minecraft-server'") ? ok('Blueprint servidor Minecraft') : fail('falta minecraft-server');
bp.includes('web-fullstack') && bp.includes('database/schema.sql') ? ok('Blueprint web fullstack + DB') : fail('falta web-fullstack');
bp.includes("'admin'") && bp.includes('services/') ? ok('Discord: admin + services') : fail('falta carpetas Discord');

org.includes('world/') && org.includes('plugins/') ? ok('Guía organización MC') : fail('guía MC');
layout.includes('hideCopilotChat') && layout.includes('chatPanelOpen') ? ok('Toggle ocultar chat') : fail('toggle chat');

ext.includes('runEditorQuickAction') && ext.includes('quickAction') ? ok('Botones editor en bundle') : fail('quickAction');
ext.includes('buildOrganizationBlock') ? ok('Organización en agente') : fail('buildOrganizationBlock');

console.log(process.exitCode ? '\n❌ Fallos\n' : '\n✅ OK\n');