# Ayitax Copilot — IA Local para VS Code

Extensión que funciona como GitHub Copilot, pero utiliza tus IA locales (Ollama)
en lugar de un servicio de pago. Detecta automáticamente si Ollama se está
ejecutándose y lo usa siempre como motor principal.

## Qué hace

- **Autocompletado inline** (texto fantasma gris) mientras escribes, como Copilot.
- **Chat lateral** donde describes lo que necesitas.
- **Modo Agente**: analiza TODO el proyecto abierto, decide qué archivos
  crear o modificar, y aplica los cambios directamente, sin pedirte
  confirmación paso a paso.
- **Menú contextual** (Clic derecho) → "Ayitax: Arreglar este código" / "Ayitax: Explicar este código".
- Indicador en la barra de estado inferior que muestra si la IA local está conectada.

## Requisitos previos en tu Ubuntu 25.10

```bash
# 1. Instalar Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Arrancar el servicio (si no se inicia solo)
ollama serve &

# 3. Descargar los modelos recomendados (Optimizados para código)
ollama pull qwen2.5-coder:1.5b    # para autocompletado rápido
ollama pull qwen2.5-coder:7b      # para el chat / agente

# 4. Verificar que responde correctamente
curl http://localhost:11434/api/tags
```

Si tu Mini PC tiene poca RAM/VRAM o no tiene gráfica dedicada, usa la versión ligera para el chat:
```bash
ollama pull qwen2.5-coder:3b
```
Y cambia los nombres de los modelos en la configuración de la extensión
(`ayitax.completionModel` / `ayitax.chatModel`).

## Instalación de la extensión

Necesitas Node.js 18+ y `@vscode/vsce` (empaquetador oficial de VS Code).

```bash
# Entra en la carpeta de la extensión
cd ayitax-copilot

# Instala las dependencias
npm install

# Compila el proyecto
npm run compile

# Instala el empaquetador global y empaqueta en un .vsix instalable
npm install -g @vscode/vsce
vsce package
```

Esto generará un archivo llamado `ayitax-copilot-1.0.0.vsix`. Instálalo con el siguiente comando:

```bash
code --install-extension ayitax-copilot-1.0.0.vsix
```

O desde la interfaz de VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX..." → selecciona el archivo generado.

## Uso

1. Abre cualquier proyecto en VS Code.
2. Verás el icono de Ayitax en la barra lateral izquierda; ábrelo para desplegar el chat.
3. La barra de estado (abajo a la derecha) indicará si Ollama está conectado.
4. Empieza a escribir código: aparecerán sugerencias en gris (pulsa `Tab` para aceptar).
5. En el chat, elige el modo de ejecución:
   - **💬 Chat**: solo conversación, no modifica tus archivos.
   - **⚙️ Agente**: escribe lo que necesitas ("repara el bug de X", "crea un
     plugin que haga Y") y la IA analizará el proyecto para modificar los archivos
     necesarios directamente.

## Configuración disponible

Desde `Ctrl+,` (Preferencias) busca "Ayitax" para modificar los parámetros:

| Opción | Por defecto | Descripción |
|---|---|---|
| `ayitax.ollamaUrl` | `http://localhost:11434` | URL del servidor Ollama |
| `ayitax.chatModel` | `qwen2.5-coder:7b` | Modelo para chat/agente |
| `ayitax.completionModel` | `qwen2.5-coder:1.5b` | Modelo para autocompletado |
| `ayitax.inlineSuggestionsEnabled` | `true` | Activa/desactiva el autocompletado |
| `ayitax.completionDelay` | `400` | Milisegundos de espera antes de sugerir |

## Notas

- Todo el procesamiento ocurre en tu propia máquina vía Ollama: no se envía
  código a ningún servidor externo y no requiere suscripción.
- Si Ollama no se está ejecutando, el autocompletado simplemente no sugerirá nada
  (evitando romper la edición) y el chat te avisará con un mensaje claro.
- El modo Agente escribe archivos reales en el disco. Como tienes Git local
  configurado (Directiva 4 del manual Ayitax), siempre puedes revertir los cambios con
  `git diff` o `git checkout` si algo no te convence.
