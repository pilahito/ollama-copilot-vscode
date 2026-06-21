/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Local Copilot — GitHub Integration
 *  (c) 2026 DavidPilahito7 · Licensed under the MIT License.
 * ─────────────────────────────────────────────────────────────────────────────
 *  Author   : DavidPilahito7
 *  Module   : GitHubService — Publicar proyectos en GitHub
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as vscode from 'vscode';

export interface GitHubRepo {
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  description: string | null;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

/**
 * Servicio para interactuar con GitHub usando la autenticación de VS Code.
 */
export class GitHubService {
  private session: vscode.AuthenticationSession | null = null;

  /**
   * Inicia sesión en GitHub usando el sistema de autenticación de VS Code.
   */
  async login(): Promise<boolean> {
    try {
      this.session = await vscode.authentication.getSession('github', ['repo', 'user'], {
        createIfNone: true
      });
      
      if (this.session) {
        vscode.window.showInformationMessage(
          `✓ Conectado a GitHub como @${this.session.account.label}`
        );
        return true;
      }
      return false;
    } catch (error) {
      vscode.window.showErrorMessage('Error al conectar con GitHub: ' + String(error));
      return false;
    }
  }

  /**
   * Cierra la sesión de GitHub.
   */
  async logout(): Promise<void> {
    this.session = null;
    vscode.window.showInformationMessage('Sesión de GitHub cerrada.');
  }

  /**
   * Verifica si hay una sesión activa.
   */
  isLoggedIn(): boolean {
    return this.session !== null;
  }

  /**
   * Obtiene la sesión actual (intenta recuperarla si existe).
   */
  async getSession(): Promise<vscode.AuthenticationSession | null> {
    if (this.session) {
      return this.session;
    }

    try {
      const sess = await vscode.authentication.getSession('github', ['repo', 'user'], {
        createIfNone: false
      });
      this.session = sess ?? null;
      return this.session;
    } catch {
      this.session = null;
      return null;
    }
  }

  /**
   * Obtiene información del usuario autenticado.
   */
  async getUser(): Promise<GitHubUser | null> {
    const session = await this.getSession();
    if (!session) { return null; }

    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Local-Copilot-VSCode'
        }
      });

      if (!response.ok) { throw new Error(`GitHub API error: ${response.status}`); }
      return await response.json() as GitHubUser;
    } catch (error) {
      vscode.window.showErrorMessage('Error al obtener usuario de GitHub: ' + String(error));
      return null;
    }
  }

  /**
   * Lista los repositorios del usuario.
   */
  async listRepos(): Promise<GitHubRepo[]> {
    const session = await this.getSession();
    if (!session) { return []; }

    try {
      const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=50', {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Local-Copilot-VSCode'
        }
      });

      if (!response.ok) { throw new Error(`GitHub API error: ${response.status}`); }
      return await response.json() as GitHubRepo[];
    } catch (error) {
      vscode.window.showErrorMessage('Error al listar repositorios: ' + String(error));
      return [];
    }
  }

  /**
   * Crea un nuevo repositorio en GitHub.
   */
  async createRepo(
    name: string,
    description: string = '',
    isPrivate: boolean = false
  ): Promise<GitHubRepo | null> {
    const session = await this.getSession();
    if (!session) {
      vscode.window.showErrorMessage('Debes iniciar sesión en GitHub primero.');
      return null;
    }

    try {
      const response = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Local-Copilot-VSCode'
        },
        body: JSON.stringify({
          name,
          description,
          private: isPrivate,
          auto_init: false
        })
      });

      if (!response.ok) {
        const error = await response.json() as { message?: string };
        throw new Error(error.message ?? `Error ${response.status}`);
      }

      const repo = await response.json() as GitHubRepo;
      vscode.window.showInformationMessage(`✓ Repositorio "${repo.full_name}" creado en GitHub.`);
      return repo;
    } catch (error) {
      vscode.window.showErrorMessage('Error al crear repositorio: ' + String(error));
      return null;
    }
  }

  /**
   * Publica el proyecto actual en GitHub (crea repo + push inicial).
   */
  async publishProject(): Promise<boolean> {
    const session = await this.getSession();
    if (!session) {
      const login = await this.login();
      if (!login) { return false; }
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      vscode.window.showErrorMessage('No hay ningún proyecto abierto.');
      return false;
    }

    const projectPath = workspaceFolders[0].uri.fsPath;
    const projectName = workspaceFolders[0].name;

    // Pedir nombre del repositorio
    const repoName = await vscode.window.showInputBox({
      prompt: 'Nombre del repositorio en GitHub',
      value: projectName,
      validateInput: (value) => {
        if (!value) { return 'El nombre es obligatorio'; }
        if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
          return 'Solo letras, números, puntos, guiones y guiones bajos';
        }
        return null;
      }
    });

    if (!repoName) { return false; }

    // Pedir descripción
    const description = await vscode.window.showInputBox({
      prompt: 'Descripción del repositorio (opcional)',
      placeHolder: 'Mi proyecto increíble...'
    });

    // Preguntar si es privado
    const visibility = await vscode.window.showQuickPick(
      [
        { label: '🌍 Público', description: 'Cualquiera puede ver el código', value: false },
        { label: '🔒 Privado', description: 'Solo tú puedes verlo', value: true }
      ],
      { placeHolder: '¿Visibilidad del repositorio?' }
    );

    if (!visibility) { return false; }

    // Crear el repositorio
    const repo = await this.createRepo(repoName, description ?? '', visibility.value);
    if (!repo) { return false; }

    // Ejecutar comandos git
    const terminal = vscode.window.createTerminal({
      name: 'GitHub Push',
      cwd: projectPath
    });

    terminal.show();
    terminal.sendText(`
# Inicializando repositorio Git y subiendo a GitHub...
git init 2>/dev/null || true
git add .
git commit -m "Initial commit from Local Copilot" 2>/dev/null || git commit --amend --no-edit 2>/dev/null || true
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin ${repo.html_url}.git
git push -u origin main
echo ""
echo "✅ ¡Proyecto publicado en GitHub!"
echo "🔗 ${repo.html_url}"
`);

    return true;
  }

  /**
   * Clona un repositorio de GitHub.
   */
  async cloneRepo(): Promise<boolean> {
    const session = await this.getSession();
    if (!session) {
      const login = await this.login();
      if (!login) { return false; }
    }

    // Listar repos del usuario
    const repos = await this.listRepos();
    if (!repos.length) {
      vscode.window.showInformationMessage('No tienes repositorios en GitHub.');
      return false;
    }

    // Mostrar selector
    const selected = await vscode.window.showQuickPick(
      repos.map((r) => ({
        label: r.private ? `🔒 ${r.name}` : `🌍 ${r.name}`,
        description: r.description ?? '',
        detail: r.html_url,
        repo: r
      })),
      { placeHolder: 'Selecciona un repositorio para clonar' }
    );

    if (!selected) { return false; }

    // Pedir carpeta destino
    const folder = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Clonar aquí'
    });

    if (!folder?.length) { return false; }

    const destPath = folder[0].fsPath;
    const terminal = vscode.window.createTerminal({
      name: 'GitHub Clone',
      cwd: destPath
    });

    terminal.show();
    terminal.sendText(`git clone ${selected.repo.html_url}.git && code ${selected.repo.name}`);

    return true;
  }
}
