import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";

const { MockAuthError } = vi.hoisted(() => {
  class MockAuthError extends Error {
    type = "CredentialsSignin";
  }
  return { MockAuthError };
});

vi.mock("next-auth", () => ({
  AuthError: MockAuthError,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceLoginRateLimit: vi.fn().mockResolvedValue(null),
  enforceRegisterRateLimit: vi.fn().mockResolvedValue(null),
  enforceChangePasswordRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    membership: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { auth, signIn } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  enforceChangePasswordRateLimit,
  enforceLoginRateLimit,
  enforceRegisterRateLimit,
} from "@/lib/rate-limit";
import {
  changePassword,
  getSessionUser,
  loginAction,
  registerAction,
} from "@/actions/auth";

const RATE_LIMITED = {
  ok: false as const,
  error: "Too many attempts, please try again in 15 minutes",
};

const validRegister = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "longenough",
  organizationName: "Acme Corp",
};

function mockTransaction(slug = "acme-corp") {
  vi.mocked(db.$transaction).mockImplementation(async (fn) => {
    const tx = {
      user: {
        create: vi.fn().mockResolvedValue({ id: "u1" }),
      },
      organization: {
        create: vi.fn().mockResolvedValue({ id: "o1", slug }),
      },
      membership: {
        create: vi.fn().mockResolvedValue({
          id: "m1",
          userId: "u1",
          organizationId: "o1",
          role: "OWNER",
        }),
      },
    };
    return fn(tx as never);
  });
}

describe("registerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enforceRegisterRateLimit).mockResolvedValue(null);
    vi.mocked(signIn).mockResolvedValue(undefined as never);
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.organization.findUnique).mockResolvedValue(null);
    mockTransaction();
  });

  it("creates user + org + OWNER membership and signs in", async () => {
    const tx = {
      user: { create: vi.fn().mockResolvedValue({ id: "u1" }) },
      organization: {
        create: vi.fn().mockResolvedValue({ id: "o1", slug: "acme-corp" }),
      },
      membership: { create: vi.fn().mockResolvedValue({ id: "m1" }) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) => fn(tx as never));

    const res = await registerAction(validRegister);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.orgSlug).toBe("acme-corp");

    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "ada@example.com",
          name: "Ada Lovelace",
        }),
      })
    );
    const hash = tx.user.create.mock.calls[0][0].data.passwordHash as string;
    expect(hash).not.toBe(validRegister.password);
    expect(await bcrypt.compare(validRegister.password, hash)).toBe(true);

    expect(tx.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Acme Corp", slug: "acme-corp" }),
      })
    );
    expect(tx.membership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: "u1",
          organizationId: "o1",
          role: "OWNER",
        },
      })
    );
    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({
        email: "ada@example.com",
        password: "longenough",
        redirect: false,
      })
    );
  });

  it("normalizes mixed-case email on register lookup and insert", async () => {
    const tx = {
      user: { create: vi.fn().mockResolvedValue({ id: "u1" }) },
      organization: {
        create: vi.fn().mockResolvedValue({ id: "o1", slug: "acme-corp" }),
      },
      membership: { create: vi.fn().mockResolvedValue({ id: "m1" }) },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) => fn(tx as never));

    await registerAction({
      ...validRegister,
      email: "Ada@Example.COM",
    });

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: "ada@example.com" },
    });
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "ada@example.com" }),
      })
    );
    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ email: "ada@example.com" })
    );
  });

  it("rejects duplicate email before creating anything", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "existing",
      email: "ada@example.com",
    } as never);

    const res = await registerAction(validRegister);
    expect(res).toEqual({ ok: false, error: "Email already registered" });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("returns a generic rate-limit error when the register limiter trips", async () => {
    vi.mocked(enforceRegisterRateLimit).mockResolvedValue(RATE_LIMITED);
    const res = await registerAction(validRegister);
    expect(res).toEqual(RATE_LIMITED);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns Zod field errors for invalid input", async () => {
    const res = await registerAction({
      name: "",
      email: "nope",
      password: "short",
      organizationName: "",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("Validation failed");
      expect(res.fieldErrors).toBeDefined();
    }
  });

  it("disambiguates a colliding org slug", async () => {
    vi.mocked(db.organization.findUnique)
      .mockResolvedValueOnce({ slug: "acme-corp" } as never)
      .mockResolvedValueOnce(null);
    mockTransaction("acme-corp-1");

    const res = await registerAction(validRegister);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.orgSlug).toBe("acme-corp-1");
  });

  it("falls back to slug 'org' when the name has no alphanumeric chars", async () => {
    mockTransaction("org");
    const res = await registerAction({
      ...validRegister,
      organizationName: "!!!",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.orgSlug).toBe("org");
  });

  it("returns a safe error when sign-in fails after a successful register", async () => {
    vi.mocked(signIn).mockRejectedValue(new MockAuthError());
    const res = await registerAction(validRegister);
    expect(res).toEqual({
      ok: false,
      error: "Registered but sign-in failed. Please log in.",
    });
  });

  it("maps unexpected sign-in errors to a safe ActionResult", async () => {
    vi.mocked(signIn).mockRejectedValue(new Error("network down"));
    const res = await registerAction(validRegister);
    expect(res).toEqual({ ok: false, error: "Something went wrong" });
  });
});

describe("loginAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enforceLoginRateLimit).mockResolvedValue(null);
    vi.mocked(signIn).mockResolvedValue(undefined as never);
  });

  it("signs in and returns the earliest membership org slug", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      memberships: [{ organization: { slug: "acme-corp" } }],
    } as never);

    const res = await loginAction({
      email: "ada@example.com",
      password: "longenough",
    });
    expect(res).toEqual({
      ok: true,
      data: { ok: true, orgSlug: "acme-corp" },
    });
    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({
        email: "ada@example.com",
        password: "longenough",
        redirect: false,
      })
    );
  });

  it("looks up memberships with a lowercased email", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      memberships: [{ organization: { slug: "acme-corp" } }],
    } as never);
    await loginAction({
      email: "Ada@Example.COM",
      password: "longenough",
    });
    expect(db.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "ada@example.com" },
      })
    );
  });

  it("returns orgSlug null when the user has no memberships", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      memberships: [],
    } as never);
    const res = await loginAction({
      email: "ada@example.com",
      password: "longenough",
    });
    expect(res).toEqual({ ok: true, data: { ok: true, orgSlug: null } });
  });

  it("rejects a wrong password with a generic error", async () => {
    vi.mocked(signIn).mockRejectedValue(new MockAuthError());
    const res = await loginAction({
      email: "ada@example.com",
      password: "wrong-password",
    });
    expect(res).toEqual({ ok: false, error: "Invalid email or password" });
  });

  it("rejects a non-existent email with the same generic error (no enumeration)", async () => {
    vi.mocked(signIn).mockRejectedValue(new MockAuthError());
    const missing = await loginAction({
      email: "nobody@example.com",
      password: "longenough",
    });
    const wrong = await loginAction({
      email: "ada@example.com",
      password: "wrong-password",
    });
    expect(missing).toEqual(wrong);
    expect(missing).toEqual({
      ok: false,
      error: "Invalid email or password",
    });
  });

  it("returns a generic rate-limit error when the login limiter trips", async () => {
    vi.mocked(enforceLoginRateLimit).mockResolvedValue(RATE_LIMITED);
    const res = await loginAction({
      email: "ada@example.com",
      password: "longenough",
    });
    expect(res).toEqual(RATE_LIMITED);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("returns Zod errors for invalid login input", async () => {
    const res = await loginAction({ email: "nope", password: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Validation failed");
  });

  it("maps unexpected sign-in errors to a safe ActionResult", async () => {
    vi.mocked(signIn).mockRejectedValue(new Error("idp down"));
    const res = await loginAction({
      email: "ada@example.com",
      password: "longenough",
    });
    expect(res).toEqual({ ok: false, error: "Something went wrong" });
  });

  it("maps database connection failures to a safe ActionResult", async () => {
    vi.mocked(enforceLoginRateLimit).mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      })
    );
    const res = await loginAction({
      email: "ada@example.com",
      password: "longenough",
    });
    expect(res).toEqual({ ok: false, error: "Something went wrong" });
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe("changePassword", () => {
  const currentPassword = "old-password-9";
  let currentHash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(signIn).mockResolvedValue(undefined as never);
    currentHash = await bcrypt.hash(currentPassword, 4);
    vi.mocked(enforceChangePasswordRateLimit).mockResolvedValue(null);
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: "u1", email: "ada@example.com", sessionVersion: 0 },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "ada@example.com",
      passwordHash: currentHash,
      sessionVersion: 0,
    } as never);
    vi.mocked(db.user.update).mockResolvedValue({ id: "u1" } as never);
  });

  it("hashes the new password and bumps sessionVersion", async () => {
    const res = await changePassword({
      currentPassword,
      newPassword: "brand-new-pass",
    });
    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        passwordHash: expect.any(String),
        sessionVersion: { increment: 1 },
      },
    });
    const newHash = vi.mocked(db.user.update).mock.calls[0][0].data
      .passwordHash as string;
    expect(await bcrypt.compare("brand-new-pass", newHash)).toBe(true);
    expect(await bcrypt.compare(currentPassword, newHash)).toBe(false);
    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({
        email: "ada@example.com",
        password: "brand-new-pass",
        redirect: false,
      })
    );
  }, 15_000);

  it("rejects the wrong current password without bumping sessionVersion", async () => {
    const res = await changePassword({
      currentPassword: "not-the-current",
      newPassword: "brand-new-pass",
    });
    expect(res).toEqual({ ok: false, error: "Invalid email or password" });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("returns Unauthorized when there is no session", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(
      null
    );
    const res = await changePassword({
      currentPassword,
      newPassword: "brand-new-pass",
    });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(enforceChangePasswordRateLimit).not.toHaveBeenCalled();
  });

  it("returns a generic rate-limit error when the limiter trips", async () => {
    vi.mocked(enforceChangePasswordRateLimit).mockResolvedValue(RATE_LIMITED);
    const res = await changePassword({
      currentPassword,
      newPassword: "brand-new-pass",
    });
    expect(res).toEqual(RATE_LIMITED);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns Access denied when the user has no passwordHash", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      passwordHash: null,
    } as never);
    const res = await changePassword({
      currentPassword,
      newPassword: "brand-new-pass",
    });
    expect(res).toEqual({ ok: false, error: "Access denied" });
  });

  it("returns Zod errors for a too-short new password", async () => {
    const res = await changePassword({
      currentPassword,
      newPassword: "short",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Validation failed");
  });
});

describe("getSessionUser", () => {
  it("delegates to auth()", async () => {
    const session = {
      user: { id: "u1" },
      expires: "2030-01-01T00:00:00.000Z",
    };
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(
      session
    );
    await expect(getSessionUser()).resolves.toEqual(session);
  });
});
