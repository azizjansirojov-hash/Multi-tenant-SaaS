// Requires Node.js runtime (native addon) — do not move to Edge Runtime.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { db } from "@/lib/db";
import { authTrustHost } from "@/lib/env";
import {
  isSessionVersionValid,
  nowSessionCheckedAt,
} from "@/lib/session-version";
import { loginSchema } from "@/lib/validators";

export type AuthorizedUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  sessionVersion: number;
};

/**
 * Credentials `authorize` — real bcrypt.compare, DB lookup mocked in tests.
 * Returns null for both missing users and wrong passwords (no enumeration).
 */
export async function authorizeCredentials(
  credentials: unknown
): Promise<AuthorizedUser | null> {
  const parsed = loginSchema.safeParse(credentials);
  if (!parsed.success) {
    return null;
  }

  const { email, password } = parsed.data;
  const user = await db.user.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    return null;
  }

  // Lazy-load native bcrypt only on credential verify (not every auth import).
  const bcrypt = await import("bcrypt");
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    sessionVersion: user.sessionVersion,
  };
}

export async function jwtCallback({
  token,
  user,
}: {
  token: JWT;
  user?: User | AuthorizedUser;
}): Promise<JWT> {
  if (user?.id) {
    token.sub = user.id;
    token.sessionVersion =
      typeof user.sessionVersion === "number" ? user.sessionVersion : 0;
    token.sessionCheckedAt = nowSessionCheckedAt();
    delete token.error;
    return token;
  }

  if (!token.sub) {
    return token;
  }

  const dbUser = await db.user.findUnique({
    where: { id: token.sub },
    select: { sessionVersion: true },
  });

  if (!isSessionVersionValid(token.sessionVersion, dbUser?.sessionVersion)) {
    // Returning null tells Auth.js to delete the session cookie (sessionStore.clean()).
    // Returning `{ error: "SessionInvalidated" }` would re-issue a JWT and fight
    // clearAuthSessionCookies on the revalidate failure path.
    return null as unknown as JWT;
  }

  token.sessionCheckedAt = nowSessionCheckedAt();
  return token;
}

export async function sessionCallback({
  session,
  token,
}: {
  session: Session;
  token: JWT;
}): Promise<Session> {
  if (token.error === "SessionInvalidated" || !token.sub) {
    return {
      ...session,
      user: {
        ...session.user,
        id: "",
        email: null,
        name: null,
        image: null,
      },
      expires: new Date(0).toISOString(),
    };
  }
  if (session.user) {
    session.user.id = token.sub;
    if (typeof token.sessionVersion === "number") {
      session.user.sessionVersion = token.sessionVersion;
    }
  }
  return session;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: authTrustHost(),
  session: {
    strategy: "jwt",
    // Explicit Auth.js default (30 days). Cookie host must stay consistent
    // with AUTH_URL / the browser origin (localhost vs LAN IP are different cookies).
    // F6: do not shorten maxAge — sessionVersion invalidation (jwt callback +
    // requireMembership) is the kill switch; shrinking maxAge would reintroduce
    // frequent forced re-logins without closing a data-exposure window.
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: authorizeCredentials,
    }),
  ],
  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback,
  },
});
