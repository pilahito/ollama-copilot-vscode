import * as vscode from 'vscode';

/**
 * Vista mínima en el dock (activity bar). Al pulsar el icono abre el chat a la derecha
 * y deja el explorador de archivos a la izquierda.
 */
export class LocalDockViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'local.dockView';

  constructor(private readonly onActivate: () => void | Promise<void>) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: false };
    webviewView.webview.html = '<!DOCTYPE html><html><body></body></html>';

    webviewView.onDidChangeVisibility((visible) => {
      if (visible) {
        void this.onActivate();
      }
    });

    if (webviewView.visible) {
      void this.onActivate();
    }
  }
}