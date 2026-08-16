import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import { middleware } from "@/middleware";
import {
  SESSION_REVALIDATE_PATH,
  SESSION_VERSION_MAX_STALE_SECONDS,
} from "@/lib/session-version";

function dashboardRequest(path = "/acme/projects") {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

function freshToken() {
  return {
    sub: "u1",
    sessionVersion: 0,
    sessionCheckedAt: Math.floor(Date.now() / 1000),
  };
}

describe("middleware Edge JWT gate (F6 Option A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not inspect tokens on non-dashboard paths", async () => {
    const res = await middleware(
      new NextRequest(new URL("/login", "http://localhost:3000"))
    );
    expect(res.status).toBe(200);
    expect(getToken).not.toHaveBeenCalled();
    expect(res.headers.get("content-security-policy")).toMatch(/script-src/);
  });

  it("redirects to login when no JWT is present", async () => {
    vi.mocked(getToken).mockResolvedValue(null);
    const res = await middleware(dashboardRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects when the jwt callback already stamped SessionInvalidated", async () => {
    vi.mocked(getToken).mockResolvedValue({
      sub: "u1",
      sessionVersion: 0,
      error: "SessionInvalidated",
    } as never);
    const res = await middleware(dashboardRequest("/acme/board/b1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects when sessionVersion claim is missing (malformed JWT)", async () => {
    vi.mocked(getToken).mockResolvedValue({
      sub: "u1",
    } as never);
    const res = await middleware(dashboardRequest());
    expect(res.status).toBe(307);
  });

  it("allows a fresh structurally valid JWT through without a DB round-trip", async () => {
    vi.mocked(getToken).mockResolvedValue(freshToken() as never);
    const res = await middleware(dashboardRequest("/acme/settings/members"));
    expect(res.status).toBe(200);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(res.headers.get("content-security-policy")).toMatch(/script-src/);
  });

  it("allows sessionCheckedAt at SESSION_VERSION_MAX_STALE_SECONDS - 1 (boundary pass)", async () => {
    const now = Math.floor(Date.now() / 1000);
    vi.mocked(getToken).mockResolvedValue({
      sub: "u1",
      sessionVersion: 0,
      sessionCheckedAt: now - (SESSION_VERSION_MAX_STALE_SECONDS - 1),
    } as never);
    const res = await middleware(dashboardRequest("/acme/projects"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("bounces sessionCheckedAt at SESSION_VERSION_MAX_STALE_SECONDS + 1 (boundary fail)", async () => {
    const now = Math.floor(Date.now() / 1000);
    vi.mocked(getToken).mockResolvedValue({
      sub: "u1",
      sessionVersion: 0,
      sessionCheckedAt: now - (SESSION_VERSION_MAX_STALE_SECONDS + 1),
    } as never);
    const res = await middleware(dashboardRequest("/acme/projects"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain(SESSION_REVALIDATE_PATH);
    expect(res.headers.get("location")).toContain("next=");
  });

  it("bounces a stale sessionCheckedAt to the Node revalidate route", async () => {
    vi.mocked(getToken).mockResolvedValue({
      sub: "u1",
      sessionVersion: 0,
      sessionCheckedAt: Math.floor(Date.now() / 1000) - 61,
    } as never);
    const res = await middleware(dashboardRequest("/acme/projects"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain(SESSION_REVALIDATE_PATH);
    expect(res.headers.get("location")).toContain("next=");
  });
});
