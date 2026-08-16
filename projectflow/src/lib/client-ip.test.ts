import { describe, expect, it } from "vitest";
import { resolveClientIp } from "@/lib/client-ip";

describe("resolveClientIp", () => {
  it("ignores X-Forwarded-For when no proxies are configured", () => {
    expect(
      resolveClientIp({
        xff: "203.0.113.10",
        realIp: "198.51.100.1",
        trustedProxyCount: 0,
      })
    ).toBe("unknown");
  });

  it("selects the hop before one trusted proxy", () => {
    expect(
      resolveClientIp({
        xff: "198.51.100.20, 203.0.113.10",
        realIp: null,
        trustedProxyCount: 1,
      })
    ).toBe("198.51.100.20");
  });

  it("ignores extra hops prepended by an attacker", () => {
    expect(
      resolveClientIp({
        xff: "1.2.3.4, 198.51.100.20, 203.0.113.10",
        realIp: null,
        trustedProxyCount: 1,
      })
    ).toBe("198.51.100.20");
  });

  it("falls back when the trusted-hop count exceeds the chain", () => {
    expect(
      resolveClientIp({
        xff: "203.0.113.10",
        realIp: "192.0.2.9",
        trustedProxyCount: 2,
      })
    ).toBe("192.0.2.9");
  });

  it("falls back to unknown when headers are absent", () => {
    expect(
      resolveClientIp({
        xff: null,
        realIp: null,
        trustedProxyCount: 1,
      })
    ).toBe("unknown");
  });
});
