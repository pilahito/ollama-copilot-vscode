¿Qué problema resuelve?
GitHub Copilot y herramientas similares son muy buenas, pero:

Requieren una suscripción mensual.
Envían tu código a servidores externos para procesarlo.
No funcionan si no tienes conexión a internet.

Esta extensión hace lo mismo (autocompletado mientras escribes + chat + modo agente que modifica archivos por ti) pero todo el procesamiento ocurre en local con Ollama, un motor que permite ejecutar modelos de lenguaje (LLMs) en tu propio hardware.

¿Cómo funciona por dentro?
La extensión está pensada en 4 piezas que trabajan juntas:
┌─────────────────────────┐
│   VS Code (tu editor)    │
└────────────┬─────────────┘
             │
   ┌─────────┴──────────┐
   │                     │
┌──▼───────────┐   ┌─────▼──────────┐
│ Autocompletado│   │  Chat lateral   │
│ inline (gris) │   │  (webview)      │
└──────┬────────┘   └──────┬──────────┘
       │                   │
       └─────────┬─────────┘
                  │
         ┌────────▼─────────┐
         │   OllamaClient     │  ← habla por HTTP con Ollama
         └────────┬─────────┘
                  │
         ┌────────▼─────────┐
         │  Ollama (local)    │  localhost:11434
         │  qwen2.5-coder      │
         └────────────────────┘

ollamaClient.ts — Cliente HTTP que habla con el servidor Ollama local (localhost:11434). Comprueba si está corriendo, pide autocompletados rápidos y gestiona el chat con streaming (la respuesta va apareciendo palabra por palabra, no toda de golpe).
inlineCompletionProvider.ts — El proveedor del texto fantasma gris que ves mientras escribes, igual que Copilot. Construye un prompt con el código de antes y después del cursor, se lo manda al modelo de autocompletado (qwen2.5-coder:7b por defecto) y limpia la respuesta antes de mostrarla.
agent.ts — El "cerebro" del modo agente. Cuando le pides algo como "repara el bug del pool de conexiones", este módulo:

Escanea la estructura de carpetas del proyecto abierto.
Le pregunta al modelo qué archivos necesita leer para resolver la petición.
Lee esos archivos y genera una solución completa.
Aplica los cambios directamente en disco (crea, modifica o borra archivos), sin pedir confirmación paso a paso.


chatViewProvider.ts — La interfaz visual: un panel lateral (webview) con dos modos, Chat (solo conversación) y Agente (modifica archivos), más un indicador de si Ollama está conectado.

extension.ts es el punto de entrada que registra todo lo anterior como comandos y vistas de VS Code cuando la extensión se activa.

Instalación rápida (automatizada)
bashgit clone https://github.com/pilahito/ollama-copilot-vscode.git
cd ollama-copilot-vscode
chmod +x install.sh
./install.sh
El script install.sh se encarga de todo: comprueba si Ollama está instalado (lo instala si no), lo arranca, descarga los modelos necesarios, instala las dependencias de Node, compila el código TypeScript y empaqueta la extensión en un .vsix listo para instalar en VS Code.
Si tu equipo tiene poca RAM/VRAM, puedes pedir modelos más ligeros:
bashCHAT_MODEL=qwen2.5-coder:7b COMPLETION_MODEL=qwen2.5-coder:1.5b ./install.sh
Instalación manual paso a paso
Si prefieres hacerlo a mano (o el script falla en algo y quieres ver exactamente dónde):
1. Instala y arranca Ollama
bashcurl -fsSL https://ollama.com/install.sh | sh
ollama serve &
2. Descarga los modelos
bashollama pull qwen2.5-coder:14b   # para el chat / modo agente
ollama pull qwen2.5-coder:7b    # para el autocompletado inline
Comprueba que Ollama responde:
bashcurl http://localhost:11434/api/tags
3. Compila la extensión
Necesitas Node.js 18 o superior.
bashnpm install
npm run compile
4. Empaquétala en un .vsix
bashnpm install -g @vscode/vsce
vsce package
Esto genera ollama-copilot-vscode-1.0.0.vsix. Instálalo con:
bashcode --install-extension ollama-copilot-vscode-1.0.0.vsix
O desde VS Code: Ctrl+Shift+P → "Extensions: Install from VSIX..." → selecciona el archivo.

Cómo usarla una vez instalada

Abre cualquier proyecto en VS Code.
Aparecerá un icono de la extensión en la barra de actividades (lateral izquierda) — ábrelo para ver el chat.
La barra de estado (esquina inferior derecha) muestra si Ollama está conectado y qué modelos tiene descargados.
Empieza a escribir código: verás sugerencias en gris (pulsa Tab para aceptarlas), igual que con Copilot.
En el panel de chat, elige el modo:

💬 Chat — conversación normal, no toca ningún archivo. Útil para preguntar dudas o pedir explicaciones de código.
⚙️ Agente — describe lo que necesitas ("crea un endpoint que haga X", "arregla el error de Y") y la IA analiza el proyecto completo y aplica los cambios necesarios directamente.


También puedes seleccionar código, clic derecho → "Arreglar este código" o "Explicar este código".


Configuración disponible
Desde Ctrl+, (Preferencias de VS Code), busca "Ayitax" o "Ollama Copilot":
OpciónPor defectoDescripciónayitax.ollamaUrlhttp://localhost:11434URL del servidor Ollamaayitax.chatModelqwen2.5-coder:14bModelo usado para el chat y el modo agenteayitax.completionModelqwen2.5-coder:7bModelo usado para el autocompletado inlineayitax.inlineSuggestionsEnabledtrueActiva o desactiva las sugerencias en grisayitax.completionDelay400Milisegundos de espera tras dejar de escribir antes de sugerir

Preguntas frecuentes
¿Necesito internet para que funcione?

No, una vez descargados los modelos con ollama pull, todo funciona sin conexión.
¿Qué pasa si Ollama no está corriendo?

El autocompletado simplemente no sugiere nada (no rompe tu edición) y el chat te avisa con un mensaje claro pidiéndote que ejecutes ollama serve.
¿Es tan bueno como GitHub Copilot real?

Honestamente, no en calidad de sugerencias — los modelos de Copilot son mucho más grandes y están más pulidos. Donde esta extensión gana es en privacidad (tu código nunca sale de tu máquina) y coste (cero, sin suscripción). Es ideal si priorizas eso sobre tener la mejor sugerencia posible.
¿Es seguro el modo Agente? ¿Puede borrar cosas importantes?

El modo Agente escribe archivos reales en disco sin pedir confirmación paso a paso. Se recomienda tener siempre el proyecto bajo control de versiones Git, para poder revertir con git diff / git checkout si el resultado no es el esperado.
¿Puedo usar otros modelos distintos a qwen2.5-coder?

Sí, cualquier modelo compatible con Ollama. Cámbialo en la configuración (ayitax.chatModel / ayitax.completionModel) usando el nombre exacto que te de ollama list.

Contribuir
¿Encontraste un bug o quieres añadir una mejora? Abre un issue o un pull request en este repositorio. Toda ayuda es bienvenida, especialmente: soporte para más backends locales (LM Studio, vLLM), mejoras en el prompt de autocompletado, o detección de más lenguajes.

Licencia
MIT © 2026 pilahito — ver LICENSE.
