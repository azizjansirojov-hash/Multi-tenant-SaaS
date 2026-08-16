export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextAuthRequest } from "next-auth";
import { auth } from "@/lib/auth";
import {
  clearAuthSessionCookies,
  resolveRevalidateNextPath,
} from "@/lib/session-revalidate";

/**
 * Node-only bounce target for Edge middleware when sessionCheckedAt is stale.
 *
 * Must be wrapped with `auth()` so Auth.js copies the refreshed JWT
 * `Set-Cookie` headers from the internal session action onto this response.
 * Calling bare `auth()` and returning `NextResponse.redirect` discards those
 * cookies — the prior bug that caused an infinite Edge ↔ revalidate loop.
 */
export const GET = auth(async (req: NextAuthRequest) => {
  const session = req.auth;
  const next = resolveRevalidateNextPath(
    req.nextUrl.searchParams.get("next")
  );

  if (!session?.user?.id) {
    const login = new URL("/login", req.nextUrl.origin);
    if (next !== "/") {
      login.searchParams.set("callbackUrl", next);
    }
    const res = NextResponse.redirect(login);
    // Belt-and-suspenders: jwt null already cleans via Auth.js; also expire names
    // in case chunked leftovers remain.
    clearAuthSessionCookies(res);
    return res;
  }

  return NextResponse.redirect(new URL(next, req.nextUrl.origin));
});
