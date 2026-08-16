import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRlsContext,
  enterTenantRls,
  enterUserRls,
  evaluateRlsPrivilegeGuard,
  getRlsContext,
  RLS_APP_ROLE,
  RlsPrivilegeError,
  runWithRlsBypass,
  runWithRlsContext,
} from "@/lib/rls";

describe("RLS AsyncLocalStorage context", () => {
  afterEach(() => {
    clearRlsContext();
    vi.unstubAllEnvs();
  });
  it("enterTenantRls records organization and user ids", () => {
    enterUserRls("user-1");
    enterTenantRls("org-1");
    expect(getRlsContext()).toEqual({
      organizationId: "org-1",
      userId: "user-1",
      bypass: false,
    });
  });

  it("runWithRlsBypass is scoped to the callback", async () => {
    enterTenantRls("org-1", "user-1");
    await runWithRlsBypass(async () => {
      expect(getRlsContext().bypass).toBe(true);
      expect(getRlsContext().organizationId).toBe("org-1");
    });
    expect(getRlsContext().bypass).toBe(false);
  });

  it("runInRlsGucTx is scoped to the callback", async () => {
    const { isRlsGucTxActive, runInRlsGucTx } = await import("@/lib/rls");
    expect(isRlsGucTxActive()).toBe(false);
    const inner = await runInRlsGucTx(async () => {
      expect(isRlsGucTxActive()).toBe(true);
      await Promise.resolve();
      return isRlsGucTxActive();
    });
    expect(inner).toBe(true);
    expect(isRlsGucTxActive()).toBe(false);
  });

  it("runWithRlsContext isolates concurrent tenant stores", async () => {
    const [a, b] = await Promise.all([
      runWithRlsContext({ organizationId: "org-a" }, async () => {
        await new Promise((r) => setTimeout(r, 20));
        return getRlsContext().organizationId;
      }),
      runWithRlsContext({ organizationId: "org-b" }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getRlsContext().organizationId;
      }),
    ]);
    expect(a).toBe("org-a");
    expect(b).toBe("org-b");
  });
});

describe("RLS privilege guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const safe = {
    role: RLS_APP_ROLE,
    isSuperuser: "off",
    bypassRls: false,
    tableOwner: "syzx_dev",
  };

  it("allows syzx_app without superuser, BYPASSRLS, or table ownership", () => {
    expect(() => evaluateRlsPrivilegeGuard(safe)).not.toThrow();
  });

  it("rejects superuser sessions even if the role name matches", () => {
    expect(() =>
      evaluateRlsPrivilegeGuard({ ...safe, isSuperuser: "on" })
    ).toThrow(RlsPrivilegeError);
  });

  it("rejects BYPASSRLS and table-owner sessions", () => {
    expect(() =>
      evaluateRlsPrivilegeGuard({ ...safe, bypassRls: true })
    ).toThrow(/BYPASSRLS/);
    expect(() =>
      evaluateRlsPrivilegeGuard({
        ...safe,
        role: RLS_APP_ROLE,
        tableOwner: RLS_APP_ROLE,
      })
    ).toThrow(/table owner/);
  });

  it("rejects any role other than syzx_app (including the login superuser)", () => {
    expect(() =>
      evaluateRlsPrivilegeGuard({
        ...safe,
        role: "syzx_dev",
        isSuperuser: "on",
      })
    ).toThrow(/syzx_app/);
  });

  it("assertRlsRuntimeGuard fails closed without DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    delete process.env.DATABASE_URL;
    const { assertRlsRuntimeGuard } = await import("@/lib/rls");
    await expect(assertRlsRuntimeGuard()).rejects.toThrow(/DATABASE_URL/);
  });
});
