# Local Copilot

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   ██╗      ██████╗  ██████╗ █████╗ ██╗          ██████╗ ██████╗ ██████╗      ║
║   ██║     ██╔═══██╗██╔════╝██╔══██╗██║         ██╔════╝██╔═══██╗██╔══██╗     ║
║   ██║     ██║   ██║██║     ███████║██║         ██║     ██║   ██║██████╔╝     ║
║   ██║     ██║   ██║██║     ██╔══██║██║         ██║     ██║   ██║██╔═══╝      ║
║   ███████╗╚██████╔╝╚██████╗██║  ██║███████╗    ╚██████╗╚██████╔╝██║          ║
║   ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝     ╚═════╝ ╚═════╝ ╚═╝          ║
║                                                                              ║
║                    🤖 Tu Copilot de código 100% GRATIS 🤖                    ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

<p align="center">
  🤖 <strong>LOCAL COPILOT</strong> 🤖
</p>

<p align="center">
  <strong>Autocompletado inteligente + Chat con IA + Agente autónomo</strong><br>
  <em>Funciona SIN internet con Ollama o CON internet usando IAs gratuitas</em>
</p>

<p align="center">
  <a href="#-instalación">Instalación</a> •
  <a href="#-proveedores-de-ia">Proveedores</a> •
  <a href="#-funcionalidades">Funcionalidades</a> •
  <a href="#-github">GitHub</a> •
  <a href="#-comandos">Comandos</a>
</p>

---

## 🎯 ¿Qué es Local Copilot?

**Local Copilot** es una extensión de VS Code que te da las mismas funcionalidades que GitHub Copilot pero **completamente gratis**. Puedes usarla:

| Modo | Descripción | ¿Necesita internet? |
|------|-------------|---------------------|
| 🏠 **Local** | Usa Ollama en tu PC | ❌ No |
| 🌐 **Internet** | Usa IAs gratuitas en la nube | ✅ Sí |

---

## 🚀 Instalación

### Opción 1: Desde el Marketplace (recomendado)
```
1. Abre VS Code
2. Ve a Extensiones (Ctrl+Shift+X)
3. Busca "Local Copilot"
4. Instala
```

### Opción 2: Manual
```bash
git clone https://github.com/pilahito/ollama-copilot-vscode.git
cd ollama-copilot-vscode
npm install
npm run compile
npx vsce package --allow-missing-repository
code --install-extension local-copilot-1.0.0.vsix
```

---

## 🤖 Proveedores de IA

### 🏠 Modo LOCAL (sin internet)

```
┌─────────────────────────────────────────────────────────────┐
│  OLLAMA - IA 100% local en tu ordenador                     │
├─────────────────────────────────────────────────────────────┤
│  ✅ Gratis para siempre                                     │
│  ✅ Privacidad total (datos en tu PC)                       │
│  ✅ Sin límites de uso                                      │
│  ✅ Funciona sin internet                                   │
│                                                             │
│  Modelos recomendados:                                      │
│  • qwen2.5-coder:7b  (autocompletado - rápido)             │
│  • qwen2.5-coder:14b (chat - más inteligente)              │
└─────────────────────────────────────────────────────────────┘
```

**Instalar Ollama:**
```bash
# Linux
curl -fsSL https://ollama.com/install.sh | sh

# macOS
brew install ollama

# Windows: Descarga desde https://ollama.com/download
```

**Descargar modelos:**
```bash
ollama pull qwen2.5-coder:7b    # Para autocompletado
ollama pull qwen2.5-coder:14b   # Para chat
ollama serve                     # Iniciar servidor
```

---

### 🌐 Modo INTERNET (IAs gratuitas en la nube)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PROVEEDORES GRATUITOS                                │
├──────────────┬─────────────────────┬────────────────┬───────────────────────┤
│  Proveedor   │  Modelo por defecto │  Velocidad     │  Obtener API Key      │
├──────────────┼─────────────────────┼────────────────┼───────────────────────┤
│  🚀 Groq     │  llama-3.3-70b      │  ⚡ Ultra       │  console.groq.com     │
│  🧠 Cerebras │  llama-3.3-70b      │  ⚡ Récord      │  cerebras.ai          │
│  🤝 Together │  Llama-3.3-70B-Free │  🚀 Rápido     │  together.ai          │
│  💎 Gemini   │  gemini-2.0-flash   │  🚀 Rápido     │  aistudio.google.com  │
│  🔷 Cohere   │  command-r-plus     │  🚀 Rápido     │  dashboard.cohere.com │
│  🤗 HuggingF │  Llama-3.2-11B      │  🐢 Normal     │  huggingface.co       │
│  🔀 OpenRout │  gpt-4o-mini        │  🚀 Rápido     │  openrouter.ai        │
└──────────────┴─────────────────────┴────────────────┴───────────────────────┘
```

**Configuración rápida:**
```
1. Ve a Configuración de VS Code (Ctrl+,)
2. Busca "Local Copilot"
3. Activa "Use Internet" → true
4. Selecciona tu proveedor favorito
5. Pega tu API Key
```

---

## ✨ Funcionalidades

| Función | Descripción |
|---------|-------------|
| 💬 **Chat** | Pregunta dudas, explica errores, genera código |
| ⚡ **Autocompletado** | Sugerencias mientras escribes (como Copilot) |
| 🤖 **Agente** | Analiza y modifica archivos automáticamente |
| 🐙 **GitHub** | Publica proyectos, clona repos, ve tu cuenta |

---

## 📋 Comandos

Abre la paleta con `Ctrl+Shift+P` y escribe "Local":

| Comando | Descripción |
|---------|-------------|
| `Local: Abrir Chat` | Abre el panel de chat |
| `Local: Explicar este código` | Explica código seleccionado |
| `Local: Arreglar este código` | Arregla código con el agente |
| `Local: Analizar proyecto` | Analiza toda la estructura |
| `Local: Conectar con GitHub` | Inicia sesión en GitHub |
| `Local: Publicar en GitHub` | Sube proyecto a GitHub |
| `Local: Clonar repositorio` | Clona un repo tuyo |

---

## ⚙️ Configuración

| Opción | Descripción | Default |
|--------|-------------|---------|
| `local.provider` | Proveedor de IA | `ollama` |
| `local.useInternet` | Usar nube | `false` |
| `local.groqApiKey` | API Key Groq | `` |
| `local.geminiApiKey` | API Key Gemini | `` |
| `local.cohereApiKey` | API Key Cohere | `` |
| `local.togetherApiKey` | API Key Together | `` |
| `local.cerebrasApiKey` | API Key Cerebras | `` |

---

## 🔑 Obtener API Keys Gratis

| Proveedor | URL | Pasos |
|-----------|-----|-------|
| **Groq** ⭐ | console.groq.com | Crear cuenta → API Keys → Create |
| **Gemini** | aistudio.google.com | Login Google → Create API Key |
| **Cerebras** | cloud.cerebras.ai | Registrarse → API Keys |
| **Together** | together.ai | Cuenta → Settings → API Keys |
| **Cohere** | dashboard.cohere.com | Registrarse → API Keys |

---

## 📊 Comparativa

```
┌─────────────┬───────────┬──────────┬─────────────┐
│ Proveedor   │ Velocidad │ Calidad  │ Límite      │
├─────────────┼───────────┼──────────┼─────────────┤
│ Ollama      │ ⚡⚡⚡      │ ⭐⭐⭐⭐   │ Sin límite │
│ Groq        │ ⚡⚡⚡⚡⚡    │ ⭐⭐⭐⭐⭐  │ Generoso  │
│ Cerebras    │ ⚡⚡⚡⚡⚡    │ ⭐⭐⭐⭐   │ Generoso   │
│ Gemini      │ ⚡⚡⚡⚡     │ ⭐⭐⭐⭐⭐  │ 60/min    │
│ Together    │ ⚡⚡⚡      │ ⭐⭐⭐⭐⭐  │ Créditos  │
└─────────────┴───────────┴──────────┴─────────────┘
```

---

## 📜 Licencia

MIT License © 2026 [DavidPilahito7](https://github.com/pilahito)

---

<p align="center">
  <strong>⭐ Si te gusta, dale una estrella en GitHub ⭐</strong>
</p>

<p align="center
```
╔══════════════════════════════════════════════════════════════════════════════╗
║   🐙 GitHub: github.com/pilahito/ollama-copilot-vscode                       ║
║   🐛 Issues: github.com/pilahito/ollama-copilot-vscode/issues                ║
╚══════════════════════════════════════════════════════════════════════════════╝
```
