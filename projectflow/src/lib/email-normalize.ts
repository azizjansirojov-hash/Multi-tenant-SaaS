/** Canonical email form: trim + lowercase. Used on every unique lookup/write. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
