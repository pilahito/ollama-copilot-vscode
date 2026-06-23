import * as vscode from 'vscode';
import { LOGO_FILE } from './mediaPaths';

/**
 * Panel izquierdo al pulsar el icono de Local Copilot.
 * Muestra branding profesional y abre el chat a la derecha automáticamente.
 */
export class LocalDockViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'local.dockView';

  private activateTimer: ReturnType<typeof setTimeout> | undefined;
  private lastActivate = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onActivate: () => void | Promise<void>,
    private readonly onDeactivate?: () => void | Promise<void>
  ) {}

  private triggerActivate(): void {
    const now = Date.now();
    if (now - this.lastActivate < 350) { return; }
    this.lastActivate = now;

    if (this.activateTimer) {
      clearTimeout(this.activateTimer);
    }
    this.activateTimer = setTimeout(() => {
      void this.onActivate();
    }, 40);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const logoUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', LOGO_FILE)
    ).toString();

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    min-height: 100%;
  }
  .brand-card {
    width: 100%;
    padding: 18px 14px;
    border-radius: 12px;
    background: linear-gradient(145deg, rgba(124, 58, 237, 0.12) 0%, rgba(59, 130, 246, 0.08) 100%);
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
  }
  .logo {
    width: 72px;
    height: 72px;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 8px 24px rgba(124, 58, 237, 0.35);
    border: 2px solid rgba(139, 92, 246, 0.4);
  }
  .logo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  h1 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .tagline {
    font-size: 11px;
    opacity: 0.75;
    line-height: 1.45;
  }
  .status {
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 11px;
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.25);
    color: var(--vscode-foreground);
  }
  .hint {
    font-size: 10px;
    opacity: 0.55;
    text-align: center;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <div class="brand-card">
    <div class="logo"><img src="${logoUri}" alt="Local Copilot" /></div>
    <h1>Local Copilot</h1>
    <p class="tagline">IA local con Ollama<br>Chat · Profesor · Agente</p>
    <div class="status" id="dock-status">Pulsa el icono para abrir/cerrar el chat</div>
  </div>
  <p class="hint">Clic en el icono Local Copilot: abre el chat a la derecha. Vuelve a pulsar para ocultarlo.</p>
  <script>
    const vscode = acquireVsCodeApi();
  </script>
</body>
</html>`;

    webviewView.onDidChangeVisibility((visible) => {
      if (visible) {
        this.triggerActivate();
      } else if (this.onDeactivate) {
        void this.onDeactivate();
      }
    });

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'open') {
        this.triggerActivate();
      }
    });

    if (webviewView.visible) {
      this.triggerActivate();
    }
  }
}