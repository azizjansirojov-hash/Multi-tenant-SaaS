/**
 * Content-Security-Policy builder for middleware (Edge-safe).
 *
 * Production script-src uses a per-request nonce + 'strict-dynamic'.
 * Development keeps 'unsafe-eval' for Next/Turbopack HMR (not used in prod).
 *
 * TODO(security): remove style-src 'unsafe-inline' by replacing @dnd-kit inline
 * transform styles with CSS classes / CSS variables.
 */

export const CSP_NONCE_HEADER = "x-nonce";

export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function buildContentSecurityPolicy(options: {
  nonce: string;
  isProduction: boolean;
}): string {
  const scriptSrc = options.isProduction
    ? `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'`
    : `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'nonce-${options.nonce}'`;

  return [
    "default-src 'self'",
    scriptSrc,
    // TODO(security): remove style-src 'unsafe-inline' by replacing @dnd-kit inline
    // transform styles with CSS classes / CSS variables.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.stripe.com https://checkout.stripe.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}
