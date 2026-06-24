/**
 * Extrae contexto de Google Maps (fotos contribuidor) para páginas web.
 */

const CONTRIB_RE = /https?:\/\/(?:www\.)?google\.com\/maps\/contrib\/(\d+)/i;

export interface MapsPhotoContext {
  contributorId: string;
  profileUrl: string;
  photosUrl: string;
  embedBlock: string;
}

export function extractMapsContext(prompt: string): MapsPhotoContext | null {
  const m = prompt.match(CONTRIB_RE);
  if (!m) { return null; }
  const contributorId = m[1];
  const profileUrl = `https://www.google.com/maps/contrib/${contributorId}`;
  const photosUrl = `${profileUrl}/photos`;
  const embedBlock = [
    '═══ FOTOS GOOGLE MAPS (Apartamento Pilahito) ═══',
    `Perfil contribuidor: ${profileUrl}`,
    `Galería de fotos: ${photosUrl}`,
    '',
    'En la web animalista FUTURISTA (cyber-orgánica) DEBES incluir:',
    '1. Dark mode + canvas animado (public/js/canvas-bg.js) + cursor rings + SVG animales flotantes.',
    '2. Estética WebGL/Three.js sin frameworks pesados: partículas, parallax, neón cyan/verde, glassmorphism.',
    '3. Sección "Apartamento Pilahito" con enlace visible a la galería de fotos de Google Maps.',
    '4. iframe de Google Maps embed Chalet Pilahito Cádiz + enlace al contribuidor.',
    '5. Galería responsive: mínimo 3 tarjetas glass con gradientes y enlace a la galería del contribuidor.',
    '6. Tipografía Syne/Space Grotesk — NO Nunito verde pastoral (estilo antiguo).',
    '7. NO inventes coordenadas falsas; usa el enlace del contribuidor como fuente principal.',
  ].join('\n');
  return { contributorId, profileUrl, photosUrl, embedBlock };
}

export function buildAnimalistWebFileList(): string[] {
  return [
    'public/index.html',
    'public/css/styles.css',
    'public/js/canvas-bg.js',
    'public/js/main.js',
    'README.md',
  ];
}