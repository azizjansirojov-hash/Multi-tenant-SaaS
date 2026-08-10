// Requires Node.js runtime (native addon) — do not move to Edge Runtime.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { db } from "@/lib/db";
import { isSessionVersionValid } from "@/lib/session-version";
import { loginSchema } from "@/lib/validators";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
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
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const { email, password } = parsed.data;
        const user = await db.user.findUnique({ where: { email } });
        if (!user?.passwordHash) {
          return null;
        }

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
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        token.sessionVersion =
          typeof user.sessionVersion === "number" ? user.sessionVersion : 0;
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
        return { error: "SessionInvalidated" };
      }

      return token;
    },
    async session({ session, token }) {
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
    },
  },
});
