/**
 * Búsqueda dinámica en el registro npm (registry.npmjs.org).
 */

export interface NpmPackageHit {
  name: string;
  version: string;
  description: string;
  url: string;
  keywords: string[];
  score: number;
}

export interface NpmPackageDetail {
  name: string;
  version: string;
  description: string;
  homepage: string;
  repository?: string;
  license?: string;
  dependencies: string[];
}

const CACHE = new Map<string, { at: number; hits: NpmPackageHit[] }>();
const CACHE_MS = 10 * 60 * 1000;

function keywordsFromPrompt(prompt: string): string[] {
  const q = prompt.toLowerCase();
  const terms: string[] = [];

  if (/\b(discord|bot)\b/.test(q)) { terms.push('discord bot', 'discord.js'); }
  if (/\b(web|p[aá]gina|landing|sitio)\b/.test(q)) { terms.push('landing page', 'animation css'); }
  if (/\b(express|api|rest|backend)\b/.test(q)) { terms.push('express middleware', 'rest api'); }
  if (/\b(react|vue|svelte)\b/.test(q)) { terms.push(q.match(/\b(react|vue|svelte)\b/i)?.[1] ?? 'react'); }
  if (/\b(minecraft|spigot|paper|bukkit)\b/.test(q)) { terms.push('minecraft plugin'); }
  if (/\b(telegram)\b/.test(q)) { terms.push('telegraf', 'telegram bot'); }
  if (/\b(animaci[oó]n|din[aá]mico|parallax|gsap|framer)\b/.test(q)) { terms.push('gsap', 'framer-motion', 'aos animation'); }
  if (/\b(animal|naturaleza|wildlife)\b/.test(q)) { terms.push('nature animation', 'particle effects'); }

  const words = q.replace(/[^a-z0-9áéíóúüñ\s.-]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(crea|crear|hazme|quiero|mejor|para|como|todo|esto)$/.test(w));
  terms.push(...words.slice(0, 4));

  return [...new Set(terms)].slice(0, 5);
}

export async function searchNpmPackages(query: string, limit = 6): Promise<NpmPackageHit[]> {
  const cacheKey = `${query}:${limit}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.hits;
  }

  const terms = keywordsFromPrompt(query);
  const searchText = terms.length ? terms.join(' ') : query.slice(0, 80);
  const hits: NpmPackageHit[] = [];
  const seen = new Set<string>();

  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(searchText)}&size=${limit + 4}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) { return []; }

    const data = await res.json() as {
      objects?: Array<{
        package: {
          name: string;
          version: string;
          description?: string;
          keywords?: string[];
          links?: { npm?: string; homepage?: string };
        };
        score?: { final?: number };
      }>;
    };

    for (const obj of data.objects ?? []) {
      const pkg = obj.package;
      if (!pkg?.name || seen.has(pkg.name)) { continue; }
      seen.add(pkg.name);
      hits.push({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description ?? '',
        url: pkg.links?.homepage ?? pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
        keywords: pkg.keywords ?? [],
        score: obj.score?.final ?? 0,
      });
      if (hits.length >= limit) { break; }
    }
  } catch { /* sin red */ }

  CACHE.set(cacheKey, { at: Date.now(), hits });
  return hits;
}

export async function getNpmPackageDetail(name: string): Promise<NpmPackageDetail | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) { return null; }

    const data = await res.json() as {
      name: string;
      'dist-tags'?: { latest?: string };
      description?: string;
      homepage?: string;
      repository?: { url?: string };
      license?: string;
      versions?: Record<string, { dependencies?: Record<string, string> }>;
    };

    const version = data['dist-tags']?.latest ?? 'latest';
    const deps = Object.keys(data.versions?.[version]?.dependencies ?? {});

    return {
      name: data.name,
      version,
      description: data.description ?? '',
      homepage: data.homepage ?? `https://www.npmjs.com/package/${data.name}`,
      repository: data.repository?.url,
      license: typeof data.license === 'string' ? data.license : undefined,
      dependencies: deps.slice(0, 12),
    };
  } catch {
    return null;
  }
}

export function formatNpmHitsForPrompt(hits: NpmPackageHit[]): string {
  if (!hits.length) { return ''; }

  const lines = ['## Paquetes npm recomendados (búsqueda en tiempo real)', ''];
  for (const h of hits) {
    lines.push(`- **${h.name}**@${h.version} — ${h.description || 'sin descripción'}`);
    lines.push(`  ${h.url}`);
  }
  lines.push('');
  lines.push('Usa estos paquetes si encajan con el proyecto; valida compatibilidad antes de instalar.');
  return lines.join('\n');
}

export async function gatherNpmContext(prompt: string): Promise<string> {
  const hits = await searchNpmPackages(prompt, 5);
  return formatNpmHitsForPrompt(hits);
}