/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Local Copilot — GitHub Integration
 *  (c) 2026 DavidPilahito7 · Licensed under the MIT License.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export interface GitHubRepo {
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  description: string | null;
  clone_url?: string;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  email?: string | null;
}

/** Contexto Git/GitHub para que el agente Ollama decida herramientas. */
export interface GitHubAgentContext {
  isGitRepo:         boolean;
  branch:            string;
  remote:            string;
  dirtyCount:        number;
  hasGit:            boolean;
  hasGh:             boolean;
  ghAuthenticated:   boolean;
  vscodeGitHubAuth:  boolean;
  userLogin:         string | null;
  projectName:       string;
  toolkitSummary:    string;
}

export interface GitHubAgentResult {
  ok:      boolean;
  message: string;
  url?:    string;
}

const GITHUB_SCOPES = ['repo', 'read:user', 'user:email'];
const AUTH_PROVIDER = 'github';
const AUTH_EXTENSION = 'vscode.github-authentication';

/**
 * Servicio Git/GitHub: autenticación VS Code + git con token + fallback `gh` CLI.
 */
export class GitHubService {
  private session: vscode.AuthenticationSession | null = null;
  private readonly output = vscode.window.createOutputChannel('Local Copilot — Git');

  // ── Autenticación ───────────────────────────────────────────────────────────

  private async ensureAuthExtension(): Promise<boolean> {
    const ext = vscode.extensions.getExtension(AUTH_EXTENSION);
    if (!ext) {
      const install = await vscode.window.showErrorMessage(
        'Falta la extensión "GitHub Authentication". Es necesaria para conectar con GitHub.',
        'Abrir extensiones'
      );
      if (install === 'Abrir extensiones') {
        await vscode.commands.executeCommand(
          'workbench.extensions.search',
          '@builtin github authentication'
        );
      }
      return false;
    }
    if (!ext.isActive) {
      await ext.activate();
    }
    return true;
  }

  async login(): Promise<boolean> {
    if (!(await this.ensureAuthExtension())) {
      return false;
    }

    try {
      this.session = await vscode.authentication.getSession(AUTH_PROVIDER, GITHUB_SCOPES, {
        createIfNone: true,
      });

      if (this.session) {
        vscode.window.showInformationMessage(
          `✓ Conectado a GitHub como @${this.session.account.label}`
        );
        return true;
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[login] Error: ${msg}`);

      if (await this.isGhAuthenticated()) {
        vscode.window.showInformationMessage(
          '✓ Usando GitHub CLI (`gh`) como respaldo. Ya estás autenticado.'
        );
        return true;
      }

      vscode.window.showErrorMessage(
        `Error al conectar con GitHub: ${msg}\n\nPrueba: ejecuta "gh auth login" en la terminal.`
      );
      return false;
    }
  }

  async logout(): Promise<void> {
    this.session = null;
    vscode.window.showInformationMessage(
      'Sesión local cerrada. Para revocar acceso: Configuración → Cuentas → GitHub.'
    );
  }

  isLoggedIn(): boolean {
    return this.session !== null;
  }

  async getSession(): Promise<vscode.AuthenticationSession | null> {
    if (this.session) {
      return this.session;
    }

    if (!(await this.ensureAuthExtension())) {
      return null;
    }

    try {
      const sess = await vscode.authentication.getSession(AUTH_PROVIDER, GITHUB_SCOPES, {
        createIfNone: false,
      });
      this.session = sess ?? null;
      return this.session;
    } catch {
      this.session = null;
      return null;
    }
  }

  /** Sesión VS Code o modo respaldo con `gh` CLI autenticado. */
  async ensureAuthenticated(): Promise<boolean> {
    const session = await this.getSession();
    if (session) {
      return true;
    }
    return this.login();
  }

  // ── API GitHub ──────────────────────────────────────────────────────────────

  private async apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const session = await this.getSession();
    if (!session) {
      throw new Error('No hay sesión de GitHub. Usa "Local: Conectar con GitHub".');
    }

    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Local-Copilot-VSCode',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json() as { message?: string };
        if (body.message) {
          detail = body.message;
        }
      } catch {
        // ignorar
      }
      throw new Error(detail);
    }

    return response.json() as Promise<T>;
  }

  async getUser(): Promise<GitHubUser | null> {
    try {
      return await this.apiFetch<GitHubUser>('https://api.github.com/user');
    } catch (error) {
      vscode.window.showErrorMessage('Error al obtener usuario: ' + String(error));
      return null;
    }
  }

  async listRepos(): Promise<GitHubRepo[]> {
    try {
      return await this.apiFetch<GitHubRepo[]>(
        'https://api.github.com/user/repos?sort=updated&per_page=50&affiliation=owner'
      );
    } catch (error) {
      vscode.window.showErrorMessage('Error al listar repositorios: ' + String(error));
      return [];
    }
  }

  async createRepo(
    name: string,
    description: string = '',
    isPrivate: boolean = false
  ): Promise<GitHubRepo | null> {
    if (!(await this.ensureAuthenticated())) {
      return null;
    }

    try {
      const repo = await this.apiFetch<GitHubRepo>('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, private: isPrivate, auto_init: false }),
      });
      vscode.window.showInformationMessage(`✓ Repositorio "${repo.full_name}" creado.`);
      return repo;
    } catch (error) {
      vscode.window.showErrorMessage('Error al crear repositorio: ' + String(error));
      return null;
    }
  }

  // ── Git local ───────────────────────────────────────────────────────────────

  private async commandExists(cmd: string): Promise<boolean> {
    try {
      await execFileAsync('which', [cmd]);
      return true;
    } catch {
      return false;
    }
  }

  private async isGhAuthenticated(): Promise<boolean> {
    if (!(await this.commandExists('gh'))) {
      return false;
    }
    try {
      await execFileAsync('gh', ['auth', 'status']);
      return true;
    } catch {
      return false;
    }
  }

  private async runGit(
    cwd: string,
    args: string[],
    allowFail = false
  ): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    this.output.appendLine(`$ git ${args.join(' ')}`);
    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd,
        maxBuffer: 20 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      if (stdout.trim()) {
        this.output.appendLine(stdout.trim());
      }
      return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const stderr = err.stderr?.trim() ?? err.message ?? String(error);
      this.output.appendLine(`[git error] ${stderr}`);
      if (!allowFail) {
        throw new Error(stderr);
      }
      return { ok: false, stdout: err.stdout?.trim() ?? '', stderr };
    }
  }

  private isGitRepo(dir: string): boolean {
    return fs.existsSync(path.join(dir, '.git'));
  }

  private async ensureGitUser(cwd: string, user: GitHubUser | null): Promise<void> {
    const nameCheck = await this.runGit(cwd, ['config', 'user.name'], true);
    const emailCheck = await this.runGit(cwd, ['config', 'user.email'], true);

    if (!nameCheck.stdout) {
      await this.runGit(cwd, ['config', 'user.name', user?.name || user?.login || 'Local Copilot']);
    }
    if (!emailCheck.stdout) {
      const email = user?.email || `${user?.login ?? 'user'}@users.noreply.github.com`;
      await this.runGit(cwd, ['config', 'user.email', email]);
    }
  }

  private authRemoteUrl(fullName: string, token: string): string {
    return `https://x-access-token:${token}@github.com/${fullName}.git`;
  }

  private cleanRemoteUrl(fullName: string): string {
    return `https://github.com/${fullName}.git`;
  }

  private async pushWithSession(projectPath: string, repo: GitHubRepo): Promise<void> {
    const session = await this.getSession();
    if (!session) {
      throw new Error('Sin sesión de GitHub para hacer push.');
    }

    const user = await this.getUser();
    await this.ensureGitUser(projectPath, user);

    if (!this.isGitRepo(projectPath)) {
      await this.runGit(projectPath, ['init']);
    }

    await this.runGit(projectPath, ['add', '-A']);

    const status = await this.runGit(projectPath, ['status', '--porcelain'], true);
    if (status.stdout) {
      await this.runGit(projectPath, ['commit', '-m', 'Initial commit from Local Copilot']);
    } else {
      const hasCommits = await this.runGit(projectPath, ['rev-parse', 'HEAD'], true);
      if (!hasCommits.ok) {
        await this.runGit(projectPath, ['commit', '--allow-empty', '-m', 'Initial commit from Local Copilot']);
      }
    }

    await this.runGit(projectPath, ['branch', '-M', 'main'], true);

    const authUrl = this.authRemoteUrl(repo.full_name, session.accessToken);
    const cleanUrl = this.cleanRemoteUrl(repo.full_name);

    const hasOrigin = await this.runGit(projectPath, ['remote', 'get-url', 'origin'], true);
    if (hasOrigin.ok) {
      await this.runGit(projectPath, ['remote', 'set-url', 'origin', authUrl]);
    } else {
      await this.runGit(projectPath, ['remote', 'add', 'origin', authUrl]);
    }

    try {
      await this.runGit(projectPath, ['push', '-u', 'origin', 'main']);
    } finally {
      await this.runGit(projectPath, ['remote', 'set-url', 'origin', cleanUrl], true);
    }
  }

  private async publishWithGh(projectPath: string, repoName: string, isPrivate: boolean): Promise<boolean> {
    const visibility = isPrivate ? '--private' : '--public';
    await execFileAsync(
      'gh',
      ['repo', 'create', repoName, visibility, '--source', projectPath, '--remote', 'origin', '--push'],
      { cwd: projectPath, maxBuffer: 20 * 1024 * 1024 }
    );
    return true;
  }

  // ── Acciones públicas ─────────────────────────────────────────────────────────

  async publishProject(): Promise<boolean> {
    this.output.clear();
    this.output.show(true);

    if (!(await this.commandExists('git'))) {
      vscode.window.showErrorMessage('Git no está instalado. Instálalo: sudo apt install git');
      return false;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      vscode.window.showErrorMessage('Abre una carpeta de proyecto primero.');
      return false;
    }

    const projectPath = workspaceFolders[0].uri.fsPath;
    const projectName = workspaceFolders[0].name;

    const repoName = await vscode.window.showInputBox({
      prompt: 'Nombre del repositorio en GitHub',
      value: projectName,
      validateInput: (value) => {
        if (!value) { return 'El nombre es obligatorio'; }
        if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
          return 'Solo letras, números, puntos, guiones y guiones bajos';
        }
        return null;
      },
    });
    if (!repoName) { return false; }

    const description = await vscode.window.showInputBox({
      prompt: 'Descripción del repositorio (opcional)',
      placeHolder: 'Mi proyecto...',
    });

    const visibility = await vscode.window.showQuickPick(
      [
        { label: '🌍 Público', description: 'Visible para todos', value: false },
        { label: '🔒 Privado', description: 'Solo tú', value: true },
      ],
      { placeHolder: '¿Visibilidad del repositorio?' }
    );
    if (!visibility) { return false; }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Publicando en GitHub...',
        cancellable: false,
      },
      async () => {
        try {
          if (await this.isGhAuthenticated()) {
            try {
              await this.publishWithGh(projectPath, repoName, visibility.value);
              vscode.window.showInformationMessage(`✅ Proyecto publicado: ${repoName}`);
              return true;
            } catch (ghError) {
              this.output.appendLine(`[gh fallback failed] ${String(ghError)}`);
            }
          }

          if (!(await this.ensureAuthenticated())) {
            return false;
          }

          const repo = await this.createRepo(repoName, description ?? '', visibility.value);
          if (!repo) { return false; }

          await this.pushWithSession(projectPath, repo);

          const open = await vscode.window.showInformationMessage(
            `✅ Publicado: ${repo.html_url}`,
            'Abrir en navegador'
          );
          if (open === 'Abrir en navegador') {
            await vscode.env.openExternal(vscode.Uri.parse(repo.html_url));
          }
          return true;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Error al publicar: ${msg}`);
          this.output.appendLine(`[publish] ${msg}`);
          return false;
        }
      }
    );
  }

  async cloneRepo(): Promise<boolean> {
    this.output.clear();
    this.output.show(true);

    if (!(await this.commandExists('git'))) {
      vscode.window.showErrorMessage('Git no está instalado. Instálalo: sudo apt install git');
      return false;
    }

    if (!(await this.ensureAuthenticated())) {
      return false;
    }

    const repos = await this.listRepos();
    if (!repos.length) {
      vscode.window.showInformationMessage('No tienes repositorios en GitHub.');
      return false;
    }

    const selected = await vscode.window.showQuickPick(
      repos.map((r) => ({
        label: r.private ? `🔒 ${r.name}` : `🌍 ${r.name}`,
        description: r.description ?? '',
        detail: r.html_url,
        repo: r,
      })),
      { placeHolder: 'Selecciona un repositorio para clonar' }
    );
    if (!selected) { return false; }

    const folder = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Clonar aquí',
    });
    if (!folder?.length) { return false; }

    const destParent = folder[0].fsPath;
    const destPath = path.join(destParent, selected.repo.name);

    if (fs.existsSync(destPath)) {
      vscode.window.showErrorMessage(`Ya existe la carpeta: ${destPath}`);
      return false;
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Clonando ${selected.repo.name}...`,
        cancellable: false,
      },
      async () => {
        try {
          const session = await this.getSession();
          const cloneUrl = session
            ? this.authRemoteUrl(selected.repo.full_name, session.accessToken)
            : `${selected.repo.html_url}.git`;

          await this.runGit(destParent, ['clone', cloneUrl, selected.repo.name]);

          if (session) {
            await this.runGit(destPath, ['remote', 'set-url', 'origin', this.cleanRemoteUrl(selected.repo.full_name)], true);
          }

          const open = await vscode.window.showInformationMessage(
            `✅ Clonado: ${selected.repo.name}`,
            'Abrir carpeta'
          );
          if (open === 'Abrir carpeta') {
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(destPath), true);
          }
          return true;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Error al clonar: ${msg}`);
          return false;
        }
      }
    );
  }

  // ── Herramientas para el agente Ollama ────────────────────────────────────────

  /** Estado Git/GitHub del proyecto abierto (sin diálogos). */
  async getAgentContext(projectPath: string, projectName: string): Promise<GitHubAgentContext> {
    const hasGit = await this.commandExists('git');
    const hasGh  = await this.commandExists('gh');
    let ghAuthenticated = false;
    if (hasGh) {
      ghAuthenticated = await this.isGhAuthenticated();
    }

    const session = await this.getSession();
    let userLogin: string | null = session?.account.label ?? null;
    if (!userLogin && ghAuthenticated) {
      try {
        const { stdout } = await execFileAsync('gh', ['api', 'user', '-q', '.login']);
        userLogin = stdout.trim() || null;
      } catch { /* ignore */ }
    }

    let isGitRepo = false;
    let branch = '(sin git)';
    let remote = '(sin remote)';
    let dirtyCount = 0;

    if (hasGit && this.isGitRepo(projectPath)) {
      isGitRepo = true;
      const br = await this.runGit(projectPath, ['branch', '--show-current'], true);
      branch = br.stdout || 'main';
      const rem = await this.runGit(projectPath, ['remote', 'get-url', 'origin'], true);
      remote = rem.ok ? rem.stdout.replace(/x-access-token:[^@]+@/, '***@') : '(sin origin)';
      const st = await this.runGit(projectPath, ['status', '--porcelain'], true);
      dirtyCount = st.stdout ? st.stdout.split('\n').filter(Boolean).length : 0;
    }

    const toolkitSummary = this.buildToolkitSummary({
      isGitRepo, hasGit, hasGh, ghAuthenticated, vscodeGitHubAuth: !!session,
      remote, dirtyCount, userLogin,
    });

    return {
      isGitRepo,
      branch,
      remote,
      dirtyCount,
      hasGit,
      hasGh,
      ghAuthenticated,
      vscodeGitHubAuth: !!session,
      userLogin,
      projectName,
      toolkitSummary,
    };
  }

  private buildToolkitSummary(ctx: {
    isGitRepo: boolean;
    hasGit: boolean;
    hasGh: boolean;
    ghAuthenticated: boolean;
    vscodeGitHubAuth: boolean;
    remote: string;
    dirtyCount: number;
    userLogin: string | null;
  }): string {
    const lines: string[] = [];
    if (!ctx.hasGit) {
      lines.push('Git no instalado — instala git primero.');
      return lines.join('\n');
    }
    if (!ctx.isGitRepo) {
      lines.push('Proyecto sin git init — usa: git init');
    } else {
      lines.push(`Remote: ${ctx.remote}`);
      lines.push(`Cambios sin commit: ${ctx.dirtyCount}`);
    }
    if (ctx.hasGh && ctx.ghAuthenticated) {
      lines.push(`gh CLI: OK${ctx.userLogin ? ` (@${ctx.userLogin})` : ''}`);
    } else if (ctx.hasGh) {
      lines.push('gh CLI: instalado pero sin login — gh auth login');
    } else {
      lines.push('gh CLI: no instalado (opcional; también funciona con VS Code GitHub)');
    }
    if (ctx.vscodeGitHubAuth) {
      lines.push('VS Code GitHub: conectado');
    }
    lines.push('');
    lines.push('COMANDOs permitidos: git status, git add -A, git commit -m "...", git push');
    lines.push('gh repo create NOMBRE --public --source=. --push | gh pr create | gh release create');
    lines.push('O bloque GITHUB: PUBLICAR | COMMIT_PUSH | STATUS');
    return lines.join('\n');
  }

  /** Publicar proyecto sin diálogos (modo agente). */
  async publishForAgent(
    projectPath: string,
    repoName: string,
    isPrivate = false,
    description = ''
  ): Promise<GitHubAgentResult> {
    if (!(await this.commandExists('git'))) {
      return { ok: false, message: 'Git no instalado' };
    }

    try {
      if (await this.isGhAuthenticated()) {
        const visibility = isPrivate ? '--private' : '--public';
        await execFileAsync(
          'gh',
          ['repo', 'create', repoName, visibility, '--source', projectPath, '--remote', 'origin', '--push', '-d', description],
          { cwd: projectPath, maxBuffer: 20 * 1024 * 1024 }
        );
        const url = `https://github.com/${repoName.includes('/') ? repoName : `${await this.resolveGhUser()}/${repoName}`}`;
        return { ok: true, message: `Publicado con gh: ${repoName}`, url };
      }

      if (!(await this.getSession())) {
        return { ok: false, message: 'Sin auth GitHub. Conecta con "Local: Conectar GitHub" o gh auth login' };
      }

      const nameOnly = repoName.includes('/') ? repoName.split('/').pop()! : repoName;
      const repo = await this.createRepo(nameOnly, description, isPrivate);
      if (!repo) {
        return { ok: false, message: 'No se pudo crear el repositorio' };
      }
      await this.pushWithSession(projectPath, repo);
      return { ok: true, message: `Publicado: ${repo.full_name}`, url: repo.html_url };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[agent publish] ${msg}`);
      return { ok: false, message: msg };
    }
  }

  private async resolveGhUser(): Promise<string> {
    try {
      const { stdout } = await execFileAsync('gh', ['api', 'user', '-q', '.login']);
      return stdout.trim() || 'user';
    } catch {
      return 'user';
    }
  }

  /** Commit y push automático (modo agente). */
  async commitAndPushForAgent(
    projectPath: string,
    message: string
  ): Promise<GitHubAgentResult> {
    if (!this.isGitRepo(projectPath)) {
      return { ok: false, message: 'No es un repositorio git' };
    }

    try {
      const st = await this.runGit(projectPath, ['status', '--porcelain'], true);
      if (st.stdout) {
        await this.runGit(projectPath, ['add', '-A']);
        await this.runGit(projectPath, ['commit', '-m', message]);
      }
      const push = await this.runGit(projectPath, ['push'], true);
      if (!push.ok && push.stderr.includes('no upstream')) {
        const br = await this.runGit(projectPath, ['branch', '--show-current'], true);
        await this.runGit(projectPath, ['push', '-u', 'origin', br.stdout || 'main']);
      } else if (!push.ok) {
        return { ok: false, message: push.stderr || 'Push falló' };
      }
      return { ok: true, message: `Commit y push: ${message}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: msg };
    }
  }

  /** Solo lectura: git status para el agente. */
  async gitStatusForAgent(projectPath: string): Promise<GitHubAgentResult> {
    if (!this.isGitRepo(projectPath)) {
      return { ok: true, message: 'No hay repositorio git en este proyecto.' };
    }
    const st = await this.runGit(projectPath, ['status', '-sb'], true);
    const short = await this.runGit(projectPath, ['status', '--short'], true);
    return {
      ok: true,
      message: `${st.stdout}\n${short.stdout}`.trim() || 'Working tree clean',
    };
  }
}