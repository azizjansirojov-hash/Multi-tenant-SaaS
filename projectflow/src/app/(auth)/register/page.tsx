"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { registerAction } from "@/actions/auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { copy } from "@/lib/copy";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const result = await registerAction({
        name: String(fd.get("name") ?? ""),
        email: String(fd.get("email") ?? ""),
        password: String(fd.get("password") ?? ""),
        organizationName: String(fd.get("organizationName") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const callback = safeInternalPath(searchParams.get("callbackUrl"));
      router.push(callback || `/${result.data.orgSlug}/projects`);
      router.refresh();
    } catch {
      setError(copy.common.somethingWentWrong);
    } finally {
      setPending(false);
    }
  }

  const safeCb = safeInternalPath(searchParams.get("callbackUrl"));
  const loginHref = safeCb
    ? `/login?callbackUrl=${encodeURIComponent(safeCb)}`
    : "/login";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-small mb-2 font-semibold tracking-wide text-primary uppercase">
          SYZX
        </p>
        <h1 className="text-display">{copy.auth.createAccount}</h1>
        <p className="text-body mt-1 text-muted-foreground">{copy.auth.join}</p>
      </div>
      <form onSubmit={onSubmit} className="surface-elevated flex flex-col gap-3 p-5">
        <input
          name="name"
          placeholder={copy.auth.yourName}
          required
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <input
          name="email"
          type="email"
          placeholder={copy.common.email}
          required
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <input
          name="password"
          type="password"
          placeholder={copy.auth.passwordMin}
          required
          minLength={8}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <input
          name="organizationName"
          placeholder={copy.auth.orgName}
          required
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
        >
          {pending ? copy.auth.registering : copy.auth.register}
        </button>
      </form>
      <p className="text-body text-muted-foreground">
        {copy.auth.alreadyHaveAccount}{" "}
        <Link
          href={loginHref}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {copy.auth.signIn}
        </Link>
      </p>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<main className="p-8">{copy.common.loading}</main>}>
      <RegisterForm />
    </Suspense>
  );
}
