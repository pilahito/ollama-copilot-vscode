# Changelog

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