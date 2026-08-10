import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    sessionVersion?: number;
  }

  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      sessionVersion?: number;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sessionVersion?: number;
    error?: "SessionInvalidated";
  }
}
