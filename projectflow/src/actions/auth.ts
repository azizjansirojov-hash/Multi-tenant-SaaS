"use server";

// Requires Node.js runtime (native addon) — do not move to Edge Runtime.
import { AuthError } from "next-auth";
import { safeActionError } from "@/lib/action-errors";
import { auth, signIn } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  enforceChangePasswordRateLimit,
  enforceLoginRateLimit,
  enforceRegisterRateLimit,
} from "@/lib/rate-limit";
import { runWithRlsBypass } from "@/lib/rls";
import {
  ActionResult,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  zodErrorResult,
} from "@/lib/validators";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function registerAction(
  input: unknown
): Promise<ActionResult<{ orgSlug: string }>> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  try {
    const limited = await enforceRegisterRateLimit();
    if (limited) return limited;

    const { name, email, password, organizationName } = parsed.data;

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return { ok: false, error: "Email already registered" };
    }

    const baseSlug = slugify(organizationName) || "org";
    let slug = baseSlug;
    let n = 1;
    while (await db.organization.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${n++}`;
    }

    const bcrypt = await import("bcrypt");
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await runWithRlsBypass(() =>
      db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, name, passwordHash },
        });
        const organization = await tx.organization.create({
          data: { name: organizationName, slug },
        });
        await tx.membership.create({
          data: {
            userId: user.id,
            organizationId: organization.id,
            role: "OWNER",
          },
        });
        return { orgSlug: organization.slug };
      })
    );

    try {
      await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return { ok: false, error: "Registered but sign-in failed. Please log in." };
      }
      throw error;
    }

    return { ok: true, data: result };
  } catch (error) {
    return safeActionError(error);
  }
}

export async function loginAction(
  input: unknown
): Promise<ActionResult<{ ok: true; orgSlug: string | null }>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  try {
    const limited = await enforceLoginRateLimit(parsed.data.email);
    if (limited) return limited;

    try {
      await signIn("credentials", {
        email: parsed.data.email,
        password: parsed.data.password,
        redirect: false,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return { ok: false, error: "Invalid email or password" };
      }
      throw error;
    }

    // Prefer earliest membership (registration org); null if none (edge case).
    const user = await runWithRlsBypass(() =>
      db.user.findUnique({
        where: { email: parsed.data.email },
        select: {
          memberships: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { organization: { select: { slug: true } } },
          },
        },
      })
    );
    const orgSlug = user?.memberships[0]?.organization.slug ?? null;

    return { ok: true, data: { ok: true, orgSlug } };
  } catch (error) {
    return safeActionError(error);
  }
}

export async function getSessionUser() {
  return auth();
}

/**
 * Changes password and increments sessionVersion so other JWTs are invalidated.
 */
export async function changePassword(
  input: unknown
): Promise<ActionResult<{ ok: true }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const limited = await enforceChangePasswordRateLimit(session.user.id);
  if (limited) return limited;

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return zodErrorResult(parsed.error);
  }

  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user?.passwordHash) {
    return { ok: false, error: "Access denied" };
  }

  const bcrypt = await import("bcrypt");
  const valid = await bcrypt.compare(
    parsed.data.currentPassword,
    user.passwordHash
  );
  if (!valid) {
    return { ok: false, error: "Invalid email or password" };
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      sessionVersion: { increment: 1 },
    },
  });

  try {
    await signIn("credentials", {
      email: user.email,
      password: parsed.data.newPassword,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false,
        error: "Password updated. Please log in again.",
      };
    }
    throw error;
  }

  return { ok: true, data: { ok: true } };
}
