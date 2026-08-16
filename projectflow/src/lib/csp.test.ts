import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, generateCspNonce } from "@/lib/csp";

describe("CSP builder", () => {
  it("production policy has nonce script-src without unsafe-eval or script unsafe-inline", () => {
    const csp = buildContentSecurityPolicy({
      nonce: "abc123",
      isProduction: true,
    });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("development policy keeps unsafe-eval for Turbopack HMR", () => {
    const csp = buildContentSecurityPolicy({
      nonce: "devnonce",
      isProduction: false,
    });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("'nonce-devnonce'");
  });

  it("generateCspNonce returns a non-empty string", () => {
    expect(generateCspNonce().length).toBeGreaterThan(8);
  });
});
