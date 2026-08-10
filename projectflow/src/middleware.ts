import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function isDashboardPath(pathname: string): boolean {
  // Protect /:orgSlug/projects, /:orgSlug/board/*, /:orgSlug/settings/*
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return false;
  const reserved = new Set(["api", "login", "register", "_next"]);
  if (reserved.has(parts[0])) return false;
  const section = parts[1];
  return section === "projects" || section === "board" || section === "settings";
}

export async function middleware(req: NextRequest) {
  if (!isDashboardPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
  });

  if (!token) {
    const login = new URL("/login", req.nextUrl.origin);
    login.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
