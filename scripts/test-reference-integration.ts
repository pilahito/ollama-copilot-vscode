#!/usr/bin/env npx tsx
/**
 * Integración real de ReferenceLearner: mock search, caché en disco, modo offline combinado.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ok = (m: string) => console.log(`  ✅ ${m}`);
const fail = (m: string) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };
const info = (m: string) => console.log(`  ℹ️  ${m}`);

async function main(): Promise<void> {
  const TEST_HOME = path.join(os.tmpdir(), `lc-ref-int-${Date.now()}`);
  process.env.HOME = TEST_HOME;

  const {
    ReferenceLearner,
    buildSimilarProjectQueries,
    extractFeatureKeywords,
    prioritizeGitHubHits,
    shouldLearnFromReferences,
  } = await import('../src/referenceLearner.ts');

  const { detectBlueprint } = await import('../src/projectBlueprints.ts');

  console.log('\n═══ Integración ReferenceLearner v1.0.36 ═══\n');
  info(`HOME temporal: ${TEST_HOME}`);

  const PROMPT =
    'Crea un bot de Discord completo con música, trivia y economía — estructura modular commands/ events/ musica/';

  const blueprint = detectBlueprint(PROMPT, [], false, false, 'index.js');
  if (!blueprint || blueprint.kind !== 'discord-bot') {
    fail(`blueprint esperado discord-bot, got ${blueprint?.kind}`);
  } else {
    ok(`Blueprint: ${blueprint.label}`);
  }

  const features = extractFeatureKeywords(PROMPT);
  if (!features.includes('music') || !features.includes('trivia') || !features.includes('economy')) {
    fail(`features incompletas: ${features.join(', ')}`);
  } else {
    ok(`Features: ${features.join(', ')}`);
  }

  const queries = buildSimilarProjectQueries(PROMPT, blueprint);
  const ghQueries = queries.filter((q) => q.includes('site:github.com'));
  if (ghQueries.length < 3) {
    fail(`pocas queries GitHub: ${ghQueries.length}`);
  } else {
    ok(`${ghQueries.length}/${queries.length} queries orientadas a GitHub`);
  }

  if (!shouldLearnFromReferences(PROMPT, blueprint)) {
    fail('shouldLearnFromReferences debería ser true');
  } else {
    ok('shouldLearnFromReferences activo');
  }

  const mockHits = [
    { title: 'Medium article', url: 'https://medium.com/discord-bot-guide', snippet: 'tutorial básico' },
    { title: 'discord-music-bot', url: 'https://github.com/example/discord-music-bot', snippet: 'commands/ events/ musica/ player.js @discordjs/voice' },
    { title: 'trivia-discord', url: 'https://github.com/example/trivia-bot', snippet: 'opentdb trivia commands/trivia.js' },
    { title: 'economy-bot', url: 'https://github.com/example/economy-discord', snippet: 'economy shop daily balance sqlite' },
  ];

  const ranked = prioritizeGitHubHits(mockHits);
  if (!ranked[0].url.includes('github.com')) {
    fail('prioritizeGitHubHits no puso GitHub primero');
  } else {
    ok(`GitHub primero: ${ranked[0].title}`);
  }

  const learner = new ReferenceLearner();

  const online = await learner.resolveReferences(PROMPT, blueprint, {
    internetEnabled: true,
    searchMulti: async () => mockHits,
  });

  if (!online?.context || !online.saved) {
    fail('resolveReferences online no guardó contexto');
  } else {
    ok(`Online: ${online.hitCount} hits, ${online.patternCount} patrones, source=${online.source}`);
    ok(`Summary: ${online.summary.slice(0, 80)}...`);
  }

  const cacheFile = path.join(TEST_HOME, '.local-copilot', 'learned-references.json');
  if (!fs.existsSync(cacheFile)) {
    fail(`caché no creada en ${cacheFile}`);
  } else {
    const store = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const entry = store.entries?.find((e: { kind: string }) => e.kind === 'discord-bot');
    if (!entry) {
      fail('entrada discord-bot no en caché');
    } else if (!entry.features?.includes('music')) {
      fail('caché sin feature music');
    } else if (entry.patterns.length < 5) {
      fail(`pocos patrones guardados: ${entry.patterns.length}`);
    } else {
      ok(`Caché: ${entry.patterns.length} patrones, features=[${entry.features.join(', ')}]`);
      const ghPattern = entry.patterns.find((p: string) =>
        /github|Repo GitHub|Referencia GitHub/i.test(p)
      );
      const structPattern = entry.patterns.find((p: string) => /commands\/|@discordjs\/voice/i.test(p));
      ghPattern ? ok('Patrón GitHub en caché') : fail('sin patrón GitHub en caché');
      structPattern ? ok('Patrón estructural (commands/voice) en caché') : fail('sin patrón estructural');
    }
  }

  const offline = await learner.resolveReferences(PROMPT, blueprint, {
    internetEnabled: false,
  });

  if (!offline?.context) {
    fail('resolveReferences offline sin contexto');
  } else if (offline.source !== 'combined' && offline.source !== 'cache') {
    fail(`offline source esperado combined/cache, got ${offline.source}`);
  } else {
    ok(`Offline: source=${offline.source}, ${offline.patternCount} patrones combinados`);
    if (!offline.context.includes('REFERENCIAS')) {
      fail('contexto offline sin header REFERENCIAS');
    } else {
      ok('Contexto offline con referencias aprendidas + builtin');
    }
  }

  info('Probando búsqueda real DDG (1 query)...');
  try {
    const q = encodeURIComponent('site:github.com discord.js bot modular');
    const res = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_redirect=1`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const data = await res.json() as { RelatedTopics?: { Text?: string; FirstURL?: string }[] };
      const topics = data.RelatedTopics?.filter((t) => t.FirstURL) ?? [];
      if (topics.length > 0) {
        ok(`DDG respondió: ${topics.length} resultado(s)`);
      } else {
        info('DDG sin resultados (normal con API limitada) — searchWebMulti usa fallbacks');
      }
    }
  } catch (e) {
    info(`DDG no disponible: ${e instanceof Error ? e.message : e}`);
  }

  try {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  } catch { /* ok */ }

  console.log(process.exitCode ? '\n❌ Integración falló\n' : '\n✅ Integración ReferenceLearner OK\n');
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => {
  console.error(e);
  process.exit(1);
});