import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import {
  clearAuthSessionCookies,
  resolveRevalidateNextPath,
} from "@/lib/session-revalidate";
import { SESSION_REVALIDATE_PATH } from "@/lib/session-version";

describe("resolveRevalidateNextPath", () => {
  it("returns a safe dashboard path", () => {
    expect(resolveRevalidateNextPath("/acme/projects")).toBe("/acme/projects");
  });

  it("falls back to / when next points at the revalidate route itself", () => {
    expect(resolveRevalidateNextPath(SESSION_REVALIDATE_PATH)).toBe("/");
  });

  it("falls back to / for /api/* and unsafe values", () => {
    expect(resolveRevalidateNextPath("/api/realtime")).toBe("/");
    expect(resolveRevalidateNextPath("//evil.com")).toBe("/");
    expect(resolveRevalidateNextPath(null)).toBe("/");
  });
});

describe("clearAuthSessionCookies", () => {
  it("expires authjs session cookie names", () => {
    const res = NextResponse.redirect("http://localhost:3000/login");
    clearAuthSessionCookies(res);
    const set = res.headers.getSetCookie();
    expect(set.some((c) => c.startsWith("authjs.session-token="))).toBe(true);
    expect(set.some((c) => /Max-Age=0/i.test(c))).toBe(true);
  });
});
