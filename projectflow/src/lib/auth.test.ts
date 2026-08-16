import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: (config: unknown) => config,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import {
  authorizeCredentials,
  jwtCallback,
  sessionCallback,
} from "@/lib/auth";

const PASSWORD = "correct-horse-battery";

describe("authorizeCredentials (real bcrypt.compare)", () => {
  let passwordHash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    passwordHash = await bcrypt.hash(PASSWORD, 4);
  });

  it("returns the user and sessionVersion when password matches", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      image: null,
      passwordHash,
      sessionVersion: 3,
    } as never);

    const user = await authorizeCredentials({
      email: "ada@example.com",
      password: PASSWORD,
    });

    expect(user).toEqual({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      image: null,
      sessionVersion: 3,
    });
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: "ada@example.com" },
    });
  });

  it("looks up the user with a lowercased email", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      image: null,
      passwordHash,
      sessionVersion: 0,
    } as never);

    await authorizeCredentials({
      email: "Ada@Example.COM",
      password: PASSWORD,
    });

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: "ada@example.com" },
    });
  });

  it("returns null for a wrong password (same as missing user)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      image: null,
      passwordHash,
      sessionVersion: 0,
    } as never);

    const wrong = await authorizeCredentials({
      email: "ada@example.com",
      password: "definitely-not-the-password",
    });
    expect(wrong).toBeNull();
  });

  it("returns null when the email does not exist (no enumeration)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    const missing = await authorizeCredentials({
      email: "nobody@example.com",
      password: PASSWORD,
    });
    expect(missing).toBeNull();
  });

  it("returns null when the user has no passwordHash", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: "u1",
      email: "ada@example.com",
      name: "Ada",
      image: null,
      passwordHash: null,
      sessionVersion: 0,
    } as never);

    await expect(
      authorizeCredentials({
        email: "ada@example.com",
        password: PASSWORD,
      })
    ).resolves.toBeNull();
  });

  it("returns null when credentials fail Zod (invalid email)", async () => {
    await expect(
      authorizeCredentials({ email: "not-an-email", password: "x" })
    ).resolves.toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("jwtCallback embeds and re-validates sessionVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("on sign-in copies id and numeric sessionVersion onto the token", async () => {
    const token = await jwtCallback({
      token: { error: "SessionInvalidated" },
      user: {
        id: "u1",
        email: "ada@example.com",
        sessionVersion: 2,
      },
    });
    expect(token.sub).toBe("u1");
    expect(token.sessionVersion).toBe(2);
    expect(token.sessionCheckedAt).toEqual(expect.any(Number));
    expect(token.error).toBeUndefined();
  });

  it("defaults sessionVersion to 0 when the user claim is not a number", async () => {
    const token = await jwtCallback({
      token: {},
      user: { id: "u1", email: "ada@example.com" },
    });
    expect(token.sessionVersion).toBe(0);
    expect(token.sessionCheckedAt).toEqual(expect.any(Number));
  });

  it("returns the token unchanged when sub is missing", async () => {
    const token = await jwtCallback({ token: { sessionVersion: 1 } });
    expect(token).toEqual({ sessionVersion: 1 });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("keeps the token when JWT sessionVersion matches the DB", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      sessionVersion: 5,
    } as never);
    const token = await jwtCallback({
      token: { sub: "u1", sessionVersion: 5 },
    });
    expect(token.sub).toBe("u1");
    expect(token.sessionVersion).toBe(5);
    expect(token.sessionCheckedAt).toEqual(expect.any(Number));
  });

  it("returns null when JWT sessionVersion does not match DB (clears cookie)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      sessionVersion: 6,
    } as never);
    const token = await jwtCallback({
      token: { sub: "u1", sessionVersion: 5 },
    });
    expect(token).toBeNull();
  });

  it("returns null when the user row is gone", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    const token = await jwtCallback({
      token: { sub: "deleted", sessionVersion: 0 },
    });
    expect(token).toBeNull();
  });
});

describe("sessionCallback shape", () => {
  const baseSession = {
    user: {
      id: "stale",
      email: "ada@example.com",
      name: "Ada",
      image: "https://example.com/a.png",
      sessionVersion: 1,
    },
    expires: new Date("2030-01-01T00:00:00.000Z").toISOString(),
  };

  it("copies sub and sessionVersion onto session.user", async () => {
    const session = await sessionCallback({
      session: { ...baseSession, user: { ...baseSession.user } },
      token: { sub: "u1", sessionVersion: 4 },
    });
    expect(session.user.id).toBe("u1");
    expect(session.user.sessionVersion).toBe(4);
    expect(session.user.email).toBe("ada@example.com");
    expect(session.expires).toBe(baseSession.expires);
  });

  it("clears identity and expires immediately when the JWT is SessionInvalidated", async () => {
    const session = await sessionCallback({
      session: { ...baseSession, user: { ...baseSession.user } },
      token: { error: "SessionInvalidated" },
    });
    expect(session.user.id).toBe("");
    expect(session.user.email).toBeNull();
    expect(session.user.name).toBeNull();
    expect(session.user.image).toBeNull();
    expect(session.expires).toBe(new Date(0).toISOString());
  });

  it("clears identity when token.sub is missing", async () => {
    const session = await sessionCallback({
      session: { ...baseSession, user: { ...baseSession.user } },
      token: { sessionVersion: 0 },
    });
    expect(session.user.id).toBe("");
    expect(session.expires).toBe(new Date(0).toISOString());
  });

  it("returns the session unchanged when session.user is missing", async () => {
    const session = await sessionCallback({
      session: { expires: baseSession.expires } as never,
      token: { sub: "u1", sessionVersion: 1 },
    });
    expect(session.user).toBeUndefined();
  });

  it("does not copy sessionVersion when the JWT claim is not a number", async () => {
    const session = await sessionCallback({
      session: {
        ...baseSession,
        user: { id: "stale", email: "ada@example.com", name: "Ada", image: null },
      },
      token: { sub: "u1", sessionVersion: "3" as never },
    });
    expect(session.user.id).toBe("u1");
    expect(session.user.sessionVersion).toBeUndefined();
  });
});
