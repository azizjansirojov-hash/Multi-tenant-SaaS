/**
 * Map thrown / unexpected errors to safe ActionResult messages.
 * Never leak stack traces or internal details to the client.
 */

import type { ActionResult } from "@/lib/validators";
import { StorageNotConfiguredError } from "@/lib/env";

export function safeActionError(
  err: unknown,
  fallback = "Something went wrong"
): ActionResult<never> {
  if (err instanceof StorageNotConfiguredError) {
    return { ok: false, error: "File storage is not configured" };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg === "Unauthorized") {
      return { ok: false, error: "Unauthorized" };
    }
    if (msg === "Access denied") {
      return { ok: false, error: "Access denied" };
    }
    if (
      msg === "Organization not found" ||
      msg.endsWith(" not found") ||
      msg.includes("Not found")
    ) {
      return { ok: false, error: msg.endsWith(" not found") ? msg : "Not found" };
    }
  }
  console.error("[action]", err);
  return { ok: false, error: fallback };
}

export function peekOrgId(input: unknown): string | null {
  if (
    typeof input === "object" &&
    input !== null &&
    "organizationId" in input &&
    typeof (input as { organizationId: unknown }).organizationId === "string"
  ) {
    return (input as { organizationId: string }).organizationId;
  }
  return null;
}

/** Strip control chars; treat comment bodies as plain text / markdown source only. */
export function sanitizePlainText(input: string, maxLen: number): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen);
}

/** Escape for safe React text rendering (defense in depth). */
export function escapeForDisplay(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
