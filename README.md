# Instala dependencias
npm install

# Compila
npm run compile

# Empaqueta en un .vsix instalable
npm install -g @vscode/vsce
vsce package
```

Esto genera un archivo `ayitax-copilot-1.0.0.vsix`. Instálalo con:

```bash
code --install-extension ayitax-copilot-1.0.0.vsix
```

O desde VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX..." → selecciona el archivo.

## Uso

1. Abre cualquier proyecto en VS Code.
2. Verás un icono de Ayitax en la barra lateral izquierda — ábrelo para el chat.
3. La barra de estado (abajo a la derecha) indica si Ollama está conectado.
4. Empieza a escribir código: aparecerán sugerencias en gris (Tab para aceptar).
5. En el chat, elige:
   - **💬 Chat**: solo conversación, no toca archivos.
   - **⚙️ Agente**: escribe lo que necesitas ("repara el bug de X", "crea un
     plugin que haga Y") y la IA analiza el proyecto y modifica los archivos
     necesarios directamente.

## Configuración disponible

Desde `Ctrl+,` (Preferencias) busca "Ayitax":

| Opción | Por defecto | Descripción |
|---|---|---|
| `ayitax.ollamaUrl` | `http://localhost:11434` | URL del servidor Ollama |
| `ayitax.chatModel` | `qwen2.5-coder:14b` | Modelo para chat/agente |
| `ayitax.completionModel` | `qwen2.5-coder:7b` | Modelo para autocompletado |
| `ayitax.inlineSuggestionsEnabled` | `true` | Activa/desactiva el autocompletado |
| `ayitax.completionDelay` | `400` | Milisegundos de espera antes de sugerir |

## Notas

- Todo el procesamiento ocurre en tu propia máquina vía Ollama: no se envía
  código a ningún servidor externo, y no requiere suscripción.
- Si Ollama no está corriendo, el autocompletado simplemente no sugiere nada
  (no rompe la edición) y el chat te avisa con un mensaje claro.

## Contribuir

¿Encontraste un bug o quieres añadir una mejora? Abre un *issue* o un
*pull request* en este repositorio. Toda ayuda es bienvenida, especialmente:
soporte para más backends locales (LM Studio, vLLM), mejoras en el prompt
de autocompletado, o detección de más lenguajes.

## Licencia

MIT © 2026 [DavidPilahito7](https://github.com/DavidPilahito7) — ver [LICENSE](./LICENSE).
