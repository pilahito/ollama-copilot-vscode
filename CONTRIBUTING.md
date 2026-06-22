# Contribuir, recomendaciones y variantes

Local Copilot **acepta recomendaciones** — ideas, mejoras, temas, configuraciones y variantes del proyecto.

## Recomendaciones

- Abre un [Issue](https://github.com/pilahito/ollama-copilot-vscode/issues) para proponer funciones, modelos o flujos de trabajo.
- Si ya tienes el código listo, abre un **Pull Request** al repositorio oficial.

## Variantes permitidas (MIT)

Puedes crear libremente:

- **Forks** del repositorio
- **Temas** y personalizaciones de UI
- **Variantes** (configuraciones, prompts, integraciones propias)
- Distribuir tu variante siempre que respetes la licencia MIT y los créditos del autor

## Si modificas el proyecto

**Eso es lo que pedimos:** si el agente, tú u otra herramienta **modifica archivos** de un proyecto con Git, los cambios deben **quedar en el repositorio** (commit + push al remoto del usuario).

Con Local Copilot activado (`local.agentAutoCommitPush`, por defecto **sí**):

1. El **Agente** aplica los cambios en disco
2. Hace **commit y push** automático a tu `origin` (si hay repo Git conectado)
3. Si trabajas sobre este repo oficial, abre después un **PR** para integrar en `pilahito/ollama-copilot-vscode`

## Flujo recomendado para colaborar en el repo oficial

```bash
git fork pilahito/ollama-copilot-vscode   # o fork en GitHub UI
git clone https://github.com/TU_USUARIO/ollama-copilot-vscode.git
# … cambios con el Agente o a mano …
git push origin tu-rama
# Abrir Pull Request en GitHub
```

## Agente + GitHub

| Acción | Comando / bloque |
|--------|------------------|
| Publicar proyecto nuevo | `GITHUB: PUBLICAR` o *Local: Publicar proyecto en GitHub* |
| Subir cambios tras editar | Automático con `local.agentAutoCommitPush` o `GITHUB: COMMIT_PUSH` |
| Ver estado | `GITHUB: STATUS` o *git status* en el chat del agente |

Requisitos: `git`, sesión GitHub en VS Code o `gh auth login`.

---

MIT © [DavidPilahito7](https://github.com/pilahito)