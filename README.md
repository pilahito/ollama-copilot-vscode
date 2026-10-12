# Local Copilot — IA local para VS Code

<p align="center">
  <strong>Autocompletado · Chat · Agente que programa · GitHub</strong><br>
  <em>Gratis, privado con Ollama, o con +Internet para investigar y codificar</em>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=pilahito.local-copilot">VS Marketplace</a> •
  <a href="https://github.com/pilahito/ollama-copilot-vscode/releases/latest">Última release</a> •
  <a href="#instalación">Instalación</a> •
  <a href="#modo-agente">Agente</a> •
  <a href="#modo-internet">+Internet</a> •
  <a href="#configuración">Configuración</a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=pilahito.local-copilot">
    <img src="https://img.shields.io/visual-studio-marketplace/v/pilahito.local-copilot?label=Marketplace" alt="Marketplace">
  </a>
  <img src="https://img.shields.io/github/v/release/pilahito/ollama-copilot-vscode?label=versión" alt="versión">
  <img src="https://img.shields.io/badge/licencia-MIT-blue" alt="MIT">
  <img src="https://img.shields.io/badge/VS%20Code-%5E1.85-007ACC" alt="VS Code">
  <img src="https://img.shields.io/badge/Ollama-compatible-green" alt="Ollama">
</p>

---

## ¿Qué es?

**Local Copilot** es una extensión de VS Code que replica lo esencial de GitHub Copilot **sin pagar suscripción**. Desarrollada por [**DavidPilahito7**](https://github.com/pilahito) desde **España** 🇪🇸.

| Función | Qué hace |
|---------|----------|
| ⚡ **Autocompletado** | Sugerencias inline mientras escribes |
| 💬 **Chat** | Ideas, sugerencias y snippets (no modifica archivos) |
| 🎓 **Profesor** | Aprende el código paso a paso y corrige errores |
| 😈 **Ayudante** | Agente autónomo: lee el proyecto, **internet** (hasta 40 resultados), **escribe archivos**, terminal y **Ollama Build** |
| 🐙 **GitHub** | Conectar cuenta, publicar y clonar repos |

Al instalar, detecta tu **RAM y GPU** y recomienda modelos Ollama (`qwen2.5-coder:7b/14b`, `local-copilot-turbo`, etc.).

Todo corre en tu máquina con **Ollama**, o puedes activar **+Internet** para buscar documentación actualizada antes de programar.

---

## Interfaz

```
[Dock izq.]   [Explorador / Git]   [Editor]   [Chat IA →]
   🤖 Local Copilot                 tu código   panel derecho
   📁 Archivos
   🔀 Git
```

- El **icono** de Local Copilot permanece en la barra de actividad (dock).
- El **chat** se abre en el **panel derecho**, como Copilot.
- **Archivos y Git** siguen a la izquierda.

---

## Instalación

### Opción A — VS Marketplace (recomendado)

1. En VS Code: **Extensiones** → busca **Local Copilot** (publisher `pilahito`).
2. **Instalar** desde [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=pilahito.local-copilot).

### Opción B — Release (.vsix)

1. Descarga el `.vsix` de la [última release](https://github.com/pilahito/ollama-copilot-vscode/releases/latest).
2. En VS Code: **Extensiones** → menú `⋯` → **Instalar desde VSIX…**
3. Recarga la ventana (`Ctrl+Shift+P` → *Recargar ventana*).

```bash
# O por terminal
gh release download --repo pilahito/ollama-copilot-vscode --pattern "*.vsix"
code --install-extension local-copilot-*.vsix --force
```

### Opción C — Compilar desde código

```bash
git clone https://github.com/pilahito/ollama-copilot-vscode.git
cd ollama-copilot-vscode
npm install
npm run compile
npx @vscode/vsce package --no-dependencies
code --install-extension local-copilot-*.vsix --force
```

### Ollama (modo local)

```bash
curl -fsSL https://ollama.com/install.sh | sh   # Linux
ollama pull qwen2.5-coder:7b                    # autocompletado
ollama pull qwen2.5-coder:14b                   # chat y agente
ollama serve
```

---

## Modo Agente

El agente **no es un chat**: analiza tu carpeta abierta y **aplica cambios**.

### Flujo

```mermaid
flowchart LR
  A[Petición] --> B[Escanear proyecto]
  B --> C{+Internet?}
  C -->|Sí| D[Investigar en la web]
  C -->|No| E[Leer archivos]
  D --> E
  E --> F[Generar código]
  F --> G[Escribir archivos]
  G --> H[Ejecutar git/npm]
```

### Cómo usarlo

1. Abre una **carpeta de proyecto** en VS Code.
2. En Local Copilot elige **Agente** (no Chat).
3. Escribe una orden clara:

> Modifica `src/index.js` y añade manejo de errores al bot de Discord.

> Supervisa el proyecto y corrige lo que esté mal.

4. Verás progreso: escaneo → lectura → (investigación web) → archivos modificados.

### Buenas peticiones

| ✅ Funciona mejor | ❌ Evita |
|------------------|---------|
| "Modifica `package.json` y arregla las dependencias" | "¿Qué opinas del código?" |
| "Crea `.gitignore` y haz commit" | Preguntas muy vagas |
| "Investiga discord.js v14 e implementa slash commands" | Solo "supervisa" sin contexto |

### Modelo recomendado

- **Agente / Chat:** `qwen2.5-coder:14b` (o superior)
- **Autocompletado:** `qwen2.5-coder:7b`

---

## Modo +Internet

Con el toggle **+Internet** activo:

| Modo | Comportamiento |
|------|----------------|
| **Chat** | Busca en la web y responde con contexto actualizado |
| **Agente** | Investiga **antes** de programar (docs, ejemplos, tutoriales) |

El agente muestra:

```
🌐 +Internet activo: investigando en la web...
📚 5 resultado(s) web añadidos al agente
⚙️ Generando código y aplicando cambios...
```

La búsqueda usa DuckDuckGo (gratis, sin API key). Para IAs en la nube (Groq, Gemini, etc.) configura las API keys en ⚙️.

### Aprendizaje de referencias (v1.0.36+)

Con +Internet, el Agente, Chat y Profesor **investigan cómo están hechos proyectos similares** en GitHub y guardan patrones en:

```
~/.local-copilot/learned-references.json
```

Sin internet, reutilizan esa caché + plantillas locales (bots Discord, plugins Paper, mods Fabric/Forge, ROM Android, extensiones VS Code).

---

## Proveedores de IA

| Modo | Proveedor | Internet | API Key |
|------|-----------|----------|---------|
| 🏠 Local | **Ollama** | Opcional (+Internet) | No |
| 🌐 Nube | Groq, Cerebras, Gemini, Together, Cohere, HuggingFace, OpenRouter | Sí | Sí (gratis con límites) |
| ⚙️ Auto | Ollama si hay modelos; si no, primera API con clave | Según config | Según proveedor |

**Selector en el panel:** izquierda = Local / +Internet · derecha = proveedor y modelo.

---

## GitHub

| Comando | Acción |
|---------|--------|
| `Local: Conectar con GitHub` | Inicia sesión |
| `Local: Publicar proyecto en GitHub` | Crea repo y hace push |
| `Local: Clonar repositorio` | Clona un repo tuyo |
| `Local: Ver mis repositorios` | Lista repos |

Requisitos: `git`, `gh` CLI (`gh auth login`) o sesión de GitHub en VS Code.

### Recomendaciones, variantes y tu repositorio

- **Aceptamos recomendaciones** y **variantes** (forks, temas, configs) bajo licencia MIT — ver [CONTRIBUTING.md](CONTRIBUTING.md).
- Si el **Agente modifica archivos**, con `local.agentAutoCommitPush` (desactivado por defecto) puede hacer **commit y push** a tu `origin` automáticamente cuando lo actives.
- Para integrar cambios en el repo oficial: abre un **Pull Request** tras el push.

> Al hacer commit manual en VS Code escribe un **mensaje** en el cuadro de Control de código fuente antes de confirmar.

---

## Comandos

`Ctrl+Shift+P` → escribe **Local**:

| Comando | Descripción |
|---------|-------------|
| Abrir Chat IA | Abre el panel derecho |
| Elegir modelo de IA | Selector de modelos Ollama |
| Explicar / Arreglar código | Usa la selección actual |
| Analizar proyecto | Agente sobre toda la carpeta |
| Activar/Desactivar autocompletado | Toggle inline |
| Conectar / Publicar / Clonar GitHub | Integración Git |

---

## Configuración

| Opción | Descripción | Default |
|--------|-------------|---------|
| `local.provider` | `auto`, `ollama`, `groq`, `gemini`… | `auto` |
| `local.useInternet` | Activa búsqueda web (+Internet) | `false` |
| `local.chatModel` | Modelo para chat y agente | `qwen2.5-coder:14b` |
| `local.completionModel` | Modelo autocompletado | `qwen2.5-coder:7b` |
| `local.requireConfirmation` | Pedir OK antes de escribir archivos | `false` |
| `local.agentRunTerminal` | Agente ejecuta `git`, `npm`, `gh` | `true` |
| `local.agentAutoCommitPush` | Tras editar archivos, commit+push a tu repo | `false` |
| `local.ollamaUrl` | URL de Ollama | `http://localhost:11434` |
| `local.ollamaThink` | `auto` / `true` / `false` — razonamiento de modelos tipo qwen3. `auto` lo desactiva solo en modelos que piensan | `auto` |

---

## Modelos que razonan (qwen3, deepseek-r1…)

Estos modelos escriben su cadena de pensamiento en `message.thinking` y dejan
`message.content` **vacío** mientras piensan. Si el presupuesto de tokens
(`local.ollamaNumPredict`) o el tiempo de espera se agotan durante el
pensamiento, la respuesta llega **en blanco** (el chat «no responde»), y el
autocompletado insertaba el texto del razonamiento con etiquetas `<think>`.

Desde **v1.6.0** la extensión envía `think: false` en esos modelos (ajustable con
`local.ollamaThink`), usa `thinking` como respaldo si aun así no hay `content`,
y reconoce en el catálogo a `qwen3`, `qwen3-coder`, `deepseek-r1` y `gpt-oss`.

---

## Novedades recientes

| Versión | Cambios principales |
|---------|---------------------|
| **1.6.0** | Modelos con razonamiento (qwen3) arreglados: chat/agente ya no responden en blanco; autocompletado sin `<think>`; UI del chat se sincroniza al abrirse; CSP en los paneles; icono de la barra lateral con el diablo rojo de la marca |
| **1.5.5** | Recomendaciones Ollama por RAM + VRAM, modo Ayudante y búsqueda web ampliada |
| **1.0.36** | ReferenceLearner, intención usuario, APIs, blueprints, UI desbloqueada, Marketplace |
| **1.0.12** | Agente +Internet investiga la web y luego programa |
| **1.0.11** | Anti-refusal, reintento automático, Ollama optimizado para agente |
| **1.0.10** | Icono en dock, chat en panel derecho |
| **1.0.6** | Agente ejecuta comandos terminal y parser mejorado |
| **1.0.5** | GitHub fiable con `gh` CLI y token |

[Ver todas las releases →](https://github.com/pilahito/ollama-copilot-vscode/releases)

---

## Desarrollo

```bash
npm run compile    # compilar
npm run watch      # compilar en caliente
npx @vscode/vsce package --no-dependencies
```

Estructura principal:

```
src/
  extension.ts          # entrada y comandos
  chatViewProvider.ts   # UI del chat
  agent.ts              # agente autónomo
  ollamaClient.ts       # Ollama + APIs + búsqueda web
  githubService.ts      # Git / GitHub
  dockViewProvider.ts   # icono dock → abre chat derecha
  webviewSecurity.ts    # CSP + nonce de los paneles
```

### Publicar en VS Marketplace

El workflow `.github/workflows/publish-marketplace.yml` compila, empaqueta el
`.vsix`, lo adjunta a la release y después publica en el Marketplace **solo si
existe el secreto `VSCE_PAT`**:

1. Crea un Personal Access Token en Azure DevOps (scope *Marketplace → Manage*).
2. Añádelo como secreto del repositorio: `gh secret set VSCE_PAT`.
3. Vuelve a lanzar el workflow (*Actions → Publish to VS Marketplace → Run workflow*).

Sin el secreto, la release sigue teniendo el `.vsix` instalable y el workflow
termina en verde con un aviso, en lugar de fallar.

---

## Licencia

MIT © 2026 [DavidPilahito7](https://github.com/pilahito)

---

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=pilahito.local-copilot">📦 VS Marketplace</a> ·
  <a href="https://github.com/pilahito/ollama-copilot-vscode">⭐ Star en GitHub</a> ·
  <a href="https://github.com/pilahito/ollama-copilot-vscode/issues">Reportar bug</a>
</p>
