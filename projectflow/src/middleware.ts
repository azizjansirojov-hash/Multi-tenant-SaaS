import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  buildContentSecurityPolicy,
  CSP_NONCE_HEADER,
  generateCspNonce,
} from "@/lib/csp";
import { safeInternalPath } from "@/lib/safe-redirect";
import {
  isEdgeJwtFresh,
  isEdgeJwtStructurallyValid,
  SESSION_REVALIDATE_PATH,
} from "@/lib/session-version";

function isDashboardPath(pathname: string): boolean {
  // Protect /:orgSlug/projects, /:orgSlug/board/*, /:orgSlug/settings/*
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return false;
  const reserved = new Set(["api", "login", "register", "_next"]);
  if (reserved.has(parts[0])) return false;
  const section = parts[1];
  return section === "projects" || section === "board" || section === "settings";
}

function redirectToLogin(req: NextRequest) {
  const login = new URL("/login", req.nextUrl.origin);
  const callback = safeInternalPath(req.nextUrl.pathname);
  if (callback) {
    login.searchParams.set("callbackUrl", callback);
  }
  return NextResponse.redirect(login);
}

function redirectToRevalidate(req: NextRequest) {
  const url = new URL(SESSION_REVALIDATE_PATH, req.nextUrl.origin);
  const next = safeInternalPath(req.nextUrl.pathname);
  if (next) {
    url.searchParams.set("next", next);
  }
  return NextResponse.redirect(url);
}

/**
 * F6 / sessionVersion at Edge — Option A (JWT freshness + Node bounce).
 *
 * Why not Option B: middleware runs on the Edge runtime. Prisma 7 + `pg`
 * is Node-only; there is no Redis/KV/Accelerate in this stack.
 *
 * What this gate does: `getToken` verifies signature + expiry; we then
 * reject tokens that Auth.js already stamped `SessionInvalidated`, or that
 * lack `sub` / numeric `sessionVersion`. If `sessionCheckedAt` is older
 * than SESSION_VERSION_MAX_STALE_SECONDS (60s), bounce to a Node route
 * that runs the jwt callback against Postgres.
 *
 * What actually protects data: every Server Action / RSC that touches
 * tenant data calls `auth()` (jwt callback re-reads DB) and
 * `requireMembership` → `requireValidSessionUserId` (second DB check).
 */
export async function middleware(req: NextRequest) {
  const nonce = generateCspNonce();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);

  const apply = (response: NextResponse) => {
    response.headers.set(
      "Content-Security-Policy",
      buildContentSecurityPolicy({
        nonce,
        isProduction: process.env.NODE_ENV === "production",
      })
    );
    return response;
  };

  if (!isDashboardPath(req.nextUrl.pathname)) {
    return apply(
      NextResponse.next({
        request: { headers: requestHeaders },
      })
    );
  }

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
  });

  if (!isEdgeJwtStructurallyValid(token)) {
    return apply(redirectToLogin(req));
  }

  if (!isEdgeJwtFresh(token)) {
    return apply(redirectToRevalidate(req));
  }

  return apply(
    NextResponse.next({
      request: { headers: requestHeaders },
    })
  );
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
