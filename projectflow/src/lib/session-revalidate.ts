import { NextResponse } from "next/server";
import { safeInternalPath } from "@/lib/safe-redirect";
import { SESSION_REVALIDATE_PATH } from "@/lib/session-version";

/**
 * Resolve the post-revalidate destination. Never allow bouncing back into
 * `/api/session/revalidate` (or any `/api/*`) — that would loop if cookie
 * write failed.
 */
export function resolveRevalidateNextPath(raw: string | null): string {
  const requested = safeInternalPath(raw);
  if (
    !requested ||
    requested.startsWith("/api/") ||
    requested === SESSION_REVALIDATE_PATH
  ) {
    return "/";
  }
  return requested;
}

/** Clear Auth.js session cookie names (http + https + chunked). */
export function clearAuthSessionCookies(res: NextResponse): void {
  const names = [
    "authjs.session-token",
    "__Secure-authjs.session-token",
    "authjs.session-token.0",
    "authjs.session-token.1",
    "__Secure-authjs.session-token.0",
    "__Secure-authjs.session-token.1",
  ];
  for (const name of names) {
    res.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      secure: name.startsWith("__Secure-"),
    });
  }
}
