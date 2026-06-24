# Changelog

## [1.5.0] - 2026-06-24

### Added — Ollama Build (agente como Cursor)
- **Ollama Build Loop**: agente multi-ronda con herramientas READ, WRITE, EDIT, GREP, LIST, RUN, COMPILE, TEST
- El modelo recibe resultados de terminal y corrige hasta `TOOL: DONE`
- Comandos: `Local: Ollama Build` (chat) y `Local: Ollama Build en terminal`
- Script terminal: `node scripts/ollama-build.mjs "tu tarea"` — log en `/tmp/ollama-build.log`
- Settings: `local.agentBuildLoop` (default true), `local.agentBuildMaxRounds` (default 20)

## [1.4.7] - 2026-06-24

### Fixed
- Panel agente: eliminado artefacto `PLANPLANPLAN…` en streaming con reintentos Ollama
- Streaming del agente solo en panel fijo (sin burbuja duplicada en el chat)

### Added
- `scripts/backup-to-github.sh` — copia de seguridad automática a GitHub
- `scripts/install-backup-cron.sh` — cron cada 6 h para publicar mejoras en `origin/main`

## [1.1.0] - 2026-06-23

### Added — Modo Grok (sistema local / SSH)
- **Modo Grok**: análisis profundo y mejora proactiva del sistema (como Grok)
- **`local.grokOptimizeSystem`**: optimización autónoma 2–3 h (local o SSH)
- **`local.sshAnalyzeSystem`**: diagnóstico rápido con snapshot del SO
- **`local.sshAutoAnalyze`**: al abrir terminal SSH, inicia Grok automáticamente
- `scripts/ssh-grok-optimize.mjs` — runner autónomo por terminal (sin VS Code)
- Recolección: OS, disco, RAM, systemd failed, puertos, logs, NVIDIA, Docker

### Settings
- `local.grokMode` (default true)
- `local.grokMaxHours` (default 3)
- `local.sshAutoAnalyze` (default false)

## [1.0.39] - 2026-06-23

### Fixed
- **RequirementsGatherer**: detecta mejor peticiones detalladas (paper 1.21, React+hero, mod fabric) y no repite preguntas innecesarias
- `countDetailSignals()` — reconoce stack, versión MC, estilo y features en prompts cortos

### Added
- Scripts de test: `npm test`, `npm run test:full`, `scripts/test-v1038.mjs`, `scripts/run-all-tests.mjs`

## [1.0.38] - 2026-06-23

### Added
- **RequirementsGatherer**: antes de crear web, bot Discord, plugin/mod Minecraft o API, hace preguntas (estilo, funciones, stack, versión MC)
- **npmRegistry**: búsqueda dinámica en registry.npmjs.org (no solo 6 paquetes fijos)
- **freeApiRegistry**: catálogo amplio de APIs gratis (Open-Meteo, Trivia, Giphy, Fabric/Forge, GSAP…)
- **GitHub template search**: busca repos populares en GitHub API para ahorrar tiempo
- **Hardware VRAM**: detecta VRAM NVIDIA y recomienda modelos Ollama compatibles con tu PC
- **smartContext**: combina npm + APIs + plantillas GitHub + consejo de modelo en Chat/Profesor/Agente

## [1.0.37] - 2026-06-23

### Added
- **Toggle dock/chat**: pulsar el icono izquierdo oculta el panel derecho del chat
- **Organización obligatoria** por tipo: servidor Minecraft (world/, plugins/, config/), web+DB, Discord (admin/, musica/, juegos/)
- Blueprint **minecraft-server** y **web-fullstack**
- Comandos **Generar código** y **Refactorizar**; botones del welcome funcionan con el editor

### Fixed
- Explicar / Generar / Arreglar / Refactorizar adjuntan código del editor siempre
- Menú contextual del editor sin exigir selección (`editorTextFocus`)
- Arreglar usa modo Profesor (escribe el fix); Refactorizar usa Agente

## [1.0.36] - 2026-06-23

Resumen del día: agente más inteligente, aprendizaje de referencias GitHub, UI desbloqueada y publicación lista.

### Added — Aprendizaje y calidad de código
- **ReferenceLearner**: investiga proyectos similares en GitHub con +Internet; guarda patrones en `~/.local-copilot/learned-references.json`
- Modo **sin internet**: caché aprendida + plantillas locales (Discord, Minecraft plugin/mod, ROM Android, extensión VS Code)
- **Chat, Profesor y Agente** usan referencias aprendidas (`gatherReferenceContext`)
- Detección de **features** (música, trivia, economía, clima, radio, Telegram…) para matching de caché
- Consultas `site:github.com` priorizadas; `prioritizeGitHubHits` pone repos primero
- **userIntent**: analiza tono, urgencia, calidad exigida y prohibiciones (`.gitkeep`, esqueletos…)
- **apiGuidance**: recomienda APIs reales (discord.js, Open Trivia DB, Open-Meteo, express…)
- **githubGuidance**: cuándo publicar, commit o clonar con sentido común
- **codeQuality**: rechaza esqueletos/TODO; reintento si el código no es funcional
- **projectBlueprints**: plantillas Discord, Paper/Fabric/Forge, ROM, extensión VS Code, API REST, web
- **modelCatalog** + **modelRouter** + **hardwareProfile**: recomendaciones por RAM/GPU
- **promptSettings**: prompts editables (chat, profesor, agente)
- **selfTest**: autotest de Chat, Profesor y Agente al arrancar
- **copilotLayout**: icono dock → chat panel derecho (estilo Copilot)
- **CONTRIBUTING.md** y scripts de prueba (`test-bot-intent`, `test-reference-learner`, `test-reference-integration`)
- README con enlace **VS Marketplace**; scripts `publish-both.sh`, `first-publish.sh`, `setup-marketplace.sh`

### Changed
- Agente: flujo unificado `resolveReferences` (online / offline / combinado)
- `searchWebMulti` deduplica y ordena con prioridad GitHub
- Patrones GitHub siempre incluidos en los 14 patrones guardados
- Ollama: timeouts más rápidos en lectura y generación
- Media: iconos activity bar, diablo.jpg, paypal.svg

### Fixed — UI Chat / Profesor / Agente
- **Chat, Profesor y Agente desbloqueados**: `isSending` se libera tras errores (`responseEnd`)
- **Profesor y Agente** ya no exigen código en el editor (solo Chat lo pide para explicar)
- **Selector Ollama** visible al abrir; lista actualizada; `local-copilot-turbo` coincide con `:latest`
- **Icono dock izquierdo** visible (SVG monocromo); botón «Abrir chat»; comando `local.openDock`
- Welcome/sugerencias no dejan el chat bloqueado
- Caché offline combina aprendizaje previo + blueprint + builtin en un solo contexto

## [1.0.46] - 2026-06-22

### Fixed
- **Modelos Ollama no cargaban** al abrir el chat (el webview pedía la lista al estar listo)
- Reintento automático de conexión Ollama si la primera falla
- **PayPal** en el header abre el enlace correctamente (clic fijo en el botón)
- Eliminado icono **🎯** (diana) del header del chat

## [1.0.45] - 2026-06-22

### Changed
- **Dock izquierdo** simplificado: solo botón **Abrir chat** (sin PayPal)
- Logo con **icon.svg** + fallback de chip IA si la imagen no carga

## [1.0.44] - 2026-06-22

### Fixed
- **Icono izquierdo abre el chat a la derecha al instante** (sin pedir un segundo clic)
- Barra lateral derecha se muestra automáticamente (`auxiliaryBar.show`)
- Reintentos al enfocar `local.chatView` si el panel tarda en cargar

## [1.0.43] - 2026-06-22

### Added
- **Profesor corrige errores**: si dices que algo falla, diagnostica y escribe el fix en tu archivo
- Lee errores del panel **Problems** (linter/compilador) automáticamente
- Puede ejecutar `npm install` si el fallo es una dependencia faltante

### Changed
- Modo Profesor: enseñanza normal sin tocar archivos; corrección solo con "falla", "error", "corrige", etc.

## [1.0.42] - 2026-06-22

### Added
- **Agente con plantillas inteligentes**: página web, bot Discord, juego web, API REST
- Auto `npm init` + `npm install discord.js` / `express` cuando hace falta
- Creación **por orden**: carpetas → módulos → index.js al final
- **Profesor** mejorado: explica arquitectura, pasos, errores típicos y siguiente paso

### Changed
- Modo Agente detecta "creame una página web", "bot discord", "juego", etc.
- Un archivo por comando (`commands/ping.js`) — sentido común de programador senior
- HTML/CSS/JS en `public/` separados (no todo inline)

## [1.0.41] - 2026-06-22

### Added
- **Detección instantánea de IA** al abrir el chat (bootstrap desde caché, sin lag)
- **Router por tarea**: elige automáticamente el mejor modelo para Chat, Autocompletado y Agente
- **Perfil de hardware** (RAM, CPU, GPU NVIDIA, SO) con recomendaciones reales en el modal 🎯
- Botón **🎯** siempre visible en el header del chat
- Banner **sin modelos IA** con enlace a recomendaciones
- Setting `local.agentModel` para el modo Agente
- Notificación única si no hay modelos al activar VS Code

### Changed
- Prefetch de Ollama al arrancar la extensión (modelos en segundo plano)
- Caché de conexión 10s y lista de modelos 120s (menos peticiones = menos lag)
- Polling de barra de estado cada 60s (antes 30s)
- Warmup del modelo diferido 5s para no bloquear la UI

## [1.0.40] - 2026-06-22

### Changed
- Logo **diablo.jpg** restaurado en dock, chat, avatares y barra de actividad
- `icon.png` / `icon.svg` regenerados desde el diablo para el marketplace y VS Code

## [1.0.39] - 2026-06-22

### Fixed
- **Icono izquierdo → chat derecha** como GitHub Copilot: al pulsar el icono se abre el panel derecho automáticamente
- Si la barra lateral secundaria está oculta (`secondarySideBar.defaultVisibility: hidden`), se muestra al abrir el chat
- Explorador de archivos a la izquierda + chat enfocado a la derecha
- `reveal()` en el chat con reintentos para que el webview cargue siempre

## [1.0.38] - 2026-06-22

### Added
- **Botón PayPal** (icono oficial) en el header del chat — sustituye la flecha ↗️
- Enlace **Apoyar** en el pie del chat y en el dock izquierdo → `https://paypal.me/pilahito`
- Comando **Local: Apoyar con PayPal** y setting `local.paypalDonateUrl`
- Comando **Local: Abrir sitio del proveedor IA** (antes en la flecha)

### Changed
- Modo **experto multilenguaje** en Chat, Profesor, Agente y autocompletado inline
- Prompts centralizados en `src/prompts.ts` (30+ lenguajes y frameworks)
- Modelfile `local-copilot-turbo` actualizado con personalidad experta

## [1.0.37] - 2026-06-22

### Fixed
- **+Internet ya no busca en cada mensaje** — solo cuando la pregunta lo pide (docs, noticias, tutoriales…)
- **Agente comprueba Ollama/API** antes de escanear el proyecto (error claro si no hay conexión)
- **Profesor** adjunta código del editor cuando pides explicar/analizar código
- **Dock izquierdo** ya no abre el chat solo por hacer clic en el icono (solo con «Abrir chat →»)
- **Botón enviar** se desbloquea tras errores; watchdog de 5 min si Ollama cuelga
- Timeouts Ollama más generosos (5s lectura, 30s generación)
- `local-copilot-turbo` sin `:latest` ya no se pierde al auto-detectar modelos
- Canal de salida **Local Copilot** para depurar fallos (`Ver → Salida`)

## [1.0.35] - 2026-06-22

### Fixed
- **Profesor y Agente** ya no exigen código en el editor (solo Chat lo pide)
- Pestañas Chat/Profesor/Agente con `addEventListener` (más fiable en webview)
- Selector Ollama muestra el modelo configurado al instante + caché 45s
- Menos peticiones duplicadas a `/api/tags` al abrir el panel

## [1.0.34] - 2026-06-22

### Fixed
- Chat/Profesor/Agente se bloqueaban: `isSending` no se liberaba tras errores de conexión
- Selector de modelos Ollama visible de nuevo al abrir el panel
- Modo Profesor usa su prompt aunque pidas explicar código
- Botón ↗️ separado del selector de red (ya no dos iconos 🌐 confusos)
- Etiquetas claras: **Red:** (local/+Internet), **IA:**, **Modelo Ollama:**

## [1.0.33] - 2026-06-22

### Changed
- Publicación sincronizada en GitHub Releases y VS Code Marketplace

## [1.0.32] - 2026-06-22

### Added
- **Herramientas GitHub en el agente**: bloques `GITHUB: PUBLICAR`, `COMMIT_PUSH` y `STATUS`
- El agente lee el estado Git/GitHub del proyecto y ejecuta publicar, commit+push o status automáticamente
- Auto-inyección si pides "publica en GitHub" o "haz commit y push" y Ollama no emite el bloque
- Modo tarea `github` con contexto `gh` CLI y VS Code GitHub Auth

## [1.0.31] - 2026-06-22

### Added
- Arquitectura modular: carpetas + módulos separados (no todo en `index.js`)
- `buildArchitecturePlan` y reintento si Ollama mete toda la lógica en el entry point

## [1.0.30] - 2026-06-22

### Fixed
- **Agente crea carpetas**: `.gitkeep` ya no se descarta como ruta inválida
- `mkdir -p` automático cuando pides crear una carpeta
- Verificación en disco (`✅ En disco` / `❌ NO creado`)
- Quita ` ``` ` del código antes de escribir archivos
- Reintento si Ollama olvida la carpeta pedida

### Added
- Pestaña **Profesor**, Markdown en chat, modelo `local-copilot-turbo`
- Carpeta `ollama/` con Modelfile e `install-turbo.sh`

## [1.0.25] - 2026-06-22

### Fixed
- **Enter / Shift+Enter** en el chat: conflicto entre `id="send"` y la función `send()` resuelto con `submitPrompt()`
- Enter envía el mensaje; Shift+Enter inserta nueva línea

### Changed
- Footer del chat muestra la versión actual

## [1.0.24] - 2026-06-22

### Changed
- Agente obligado a emitir bloques `ACCION` (no solo código suelto)
- Mejor detección de `chatbot.js` y conexión en `index.js`
- Reintentos automáticos con prompts más estrictos

## [1.0.23] - 2026-06-22

### Fixed
- **+Internet**: cadena de búsqueda DDG Lite → Wikipedia → npm cuando la API JSON falla

## [1.0.22] - 2026-06-22

### Added
- Icono personalizado en dock y chat

## [1.0.21] - 2026-06-22

### Fixed
- Contexto del editor persistente al explicar código con foco en el chat

## [1.0.20] - 2026-06-22

### Added
- Adjuntar código del editor activo en peticiones de explicación

## [1.0.14] - 2026-06-21

### Fixed
- Parser del agente acepta formato `CONTENIDO` inline del modelo

## [1.0.12] - 2026-06-21

### Added
- Agente **+Internet**: investiga en la web y luego programa

## [1.0.11] - 2026-06-21

### Fixed
- Anti-refusal del agente, reintento automático, Ollama optimizado para agente

## [1.0.10] - 2026-06-21

### Added
- Icono en dock, chat en panel derecho

## [1.0.6] - 2026-06-21

### Added
- Agente ejecuta comandos de terminal y parser mejorado

## [1.0.5] - 2026-06-21

### Added
- GitHub fiable con `gh` CLI y token