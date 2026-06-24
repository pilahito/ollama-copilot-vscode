/**
 * Perfil de diseño aprendido: web animalista futurista cyber-orgánica (Apartamento Pilahito).
 * Usado por Chat, Profesor y Agente cuando el usuario pide web animalista / UI inmersiva.
 */

import { wantsWebPage } from '../projectBlueprints';

const ANIMALISTA_RE =
  /\b(animalista|pilahito|bienestar\s+animal|refugio\s+animal|apartamento\s+pilahito|chalet\s+pilahito|web\s+animalista)\b/i;

const FUTURISTIC_RE =
  /\b(futurista|futurístico|futuristico|cyber[\s-]?organic|cyber[\s-]?org[aá]nic[oa]|webgl|three\.js|parallax|ne[oó]n|inmersiv|immersive|8k|lottie|glassmorphism|cursor\s+track|part[ií]culas?)\b/i;

export function wantsFuturisticAnimalWeb(prompt: string): boolean {
  return ANIMALISTA_RE.test(prompt) ||
    (FUTURISTIC_RE.test(prompt) && wantsWebPage(prompt)) ||
    (FUTURISTIC_RE.test(prompt) && /\b(landing|hero|galer[ií]a|dark\s*mode)\b/i.test(prompt));
}

export const FUTURISTIC_ANIMAL_WEB_PATTERNS: string[] = [
  'Estructura: public/index.html + public/css/styles.css + public/js/main.js + public/js/canvas-bg.js (fondo animado separado)',
  'Dark mode obligatorio: fondo #050a0f–#0a1218, texto #e8f4f0, acentos neón cyan #00f5d4 y verde #39ff14',
  'Tipografía: Syne o Space Grotesk (Google Fonts) — NUNCA Nunito/verde pastoral para "animalista futurista"',
  'Fondo inmersivo: canvas fullscreen con requestAnimationFrame — partículas orgánicas, orbes gradiente, líneas de red tipo cyber-nature',
  'Parallax profundo: capas data-depth en scroll + movimiento sutil del canvas según mouse (lerp)',
  'Cursor interactivo: 2–3 círculos con mix-blend-mode screen que siguen el puntero con easing distinto',
  'Animales flotantes: SVG inline minimalistas (gato, pájaro, hoja) con CSS @keyframes float — estilo Lottie vector, sin imágenes pesadas',
  'UI: glassmorphism (backdrop-filter blur 12–20px), bordes 1px rgba(0,245,212,.25), box-shadow neón suave',
  'Secciones: hero cinematográfico, about cyber-orgánico, galería en cards glass, mapa embed con marco neón',
  'Google Maps Pilahito: contribuidor 117329176880207012989 — galería + iframe Chalet Pilahito Cádiz (conservar siempre)',
  'Accesibilidad: prefers-reduced-motion desactiva animaciones pesadas; canvas sigue visible estático',
  'Sin frameworks obligatorios: vanilla JS + CSS; Three.js solo si el usuario lo pide explícitamente',
  'Responsive: clamp() en tipografía, grid auto-fit en galería, nav fija con blur',
];

export const FUTURISTIC_COLOR_TOKENS = {
  bgDeep: '#050a0f',
  bgPanel: 'rgba(8, 18, 28, 0.72)',
  neonCyan: '#00f5d4',
  neonGreen: '#39ff14',
  neonMagenta: '#ff006e',
  textPrimary: '#e8f4f0',
  textMuted: 'rgba(232, 244, 240, 0.65)',
  borderGlow: 'rgba(0, 245, 212, 0.28)',
};

export function buildFuturisticWebDesignBlock(): string {
  return [
    '═══ PERFIL DE DISEÑO APRENDIDO: WEB ANIMALISTA FUTURISTA (Pilahito) ═══',
    'Cuando el usuario diga "animalista", "futurista", "inmersiva", "WebGL", "parallax" o Apartamento Pilahito:',
    '',
    '**Estética:** UI/UX ultra-moderna, dark mode, tema cyber-orgánico (naturaleza + alta tecnología).',
    '**Fondo:** canvas animado fullscreen (partículas, orbes, redes orgánicas) — estética Three.js/WebGL sin depender de librerías pesadas.',
    '**Interactividad:** círculos que siguen el cursor, parallax en scroll, hover neón en cards.',
    '**Animales:** formas SVG vectoriales minimalistas flotantes (estilo Lottie), no clipart.',
    '**Colores:** ' + Object.entries(FUTURISTIC_COLOR_TOKENS).map(([k, v]) => `${k}=${v}`).join(', '),
    '**Tipografía:** Syne + Space Grotesk (moderna, no Nunito verde pastoral).',
    '**Contenido fijo Pilahito:** Google Maps contribuidor 117329176880207012989, Chalet Pilahito Cádiz, galería 3+ cards.',
    '',
    '**Archivos obligatorios:**',
    '- public/index.html — estructura semántica, canvas#bg, .cursor-rings, SVG animales, secciones',
    '- public/css/styles.css — variables CSS, glassmorphism, neón, responsive',
    '- public/js/canvas-bg.js — motor de partículas y parallax mouse',
    '- public/js/main.js — cursor follower, smooth scroll, reduced-motion',
    '',
    '**Patrones UX:**',
    ...FUTURISTIC_ANIMAL_WEB_PATTERNS.map((p) => `• ${p}`),
    '',
    'NO generes webs verdes pastel tipo "Naturaleza, calma y hogar" con Nunito — eso es el estilo antiguo.',
    'SÍ genera landing inmersiva, cinematográfica, highly interactive, 8k-ready (vectores + canvas).',
  ].join('\n');
}

export function getFuturisticWebFileHint(filePath: string): string {
  switch (filePath) {
    case 'public/index.html':
      return [
        'HTML5: canvas#bg fullscreen, .cursor-rings (3 divs), nav glass fija, hero con h1 neón,',
        'SVG flotantes (gato/pájaro/hoja), secciones about/galería/mapa, enlaces Google Maps contribuidor Pilahito.',
      ].join(' ');
    case 'public/css/styles.css':
      return [
        'CSS variables cyber-orgánicas, dark mode, glassmorphism, text-shadow/glow neón,',
        '@keyframes float/pulse, responsive grid galería, prefers-reduced-motion.',
      ].join(' ');
    case 'public/js/canvas-bg.js':
      return 'Canvas IIFE: partículas orgánicas, orbes gradiente, resize, mouse parallax, requestAnimationFrame.';
    case 'public/js/main.js':
      return 'JS: cursor rings con lerp, smooth scroll anchors, init canvas-bg, reduced-motion toggle.';
    default:
      return '';
  }
}