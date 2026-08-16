/**
 * Allow only same-origin relative paths for post-auth redirects.
 * Rejects protocol-relative (`//`), backslashes, absolute URLs, and
 * encoded slash tricks (`/%2f%2f`).
 */
export function safeInternalPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;
  if (trimmed.includes("\\")) return null;
  if (trimmed.includes("://")) return null;

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return null;
  }
  if (decoded.startsWith("//")) return null;
  if (decoded.includes("\\")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded.slice(1))) return null;

  // After decoding, the path must still be a single-slash relative URL.
  if (!decoded.startsWith("/") || decoded.startsWith("//")) return null;

  return trimmed;
}
