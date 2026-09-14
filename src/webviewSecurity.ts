/**
 * Utilidades de seguridad para los webviews (CSP).
 *
 * VS Code recomienda declarar siempre una Content Security Policy en los
 * webviews: sin ella aparecen avisos en el panel de desarrollador y el
 * contenido puede quedar bloqueado. El `nonce` permite mantener el script
 * inline de cada panel sin abrir la puerta a scripts externos.
 */
import * as crypto from 'crypto';

/** Nonce aleatorio para el atributo `nonce` de <script> y la CSP. */
export function getWebviewNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * CSP estándar de Local Copilot.
 *
 * - `img-src`: permite el logo empaquetado en `media/` (vscode-webview-resource).
 * - `style-src 'unsafe-inline'`: la UI usa estilos y atributos `style` inline.
 * - `script-src 'nonce-…'`: solo el script propio de cada panel.
 */
export function getWebviewCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data: https:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    "connect-src https: http://localhost:* http://127.0.0.1:*",
  ].join('; ');
}
