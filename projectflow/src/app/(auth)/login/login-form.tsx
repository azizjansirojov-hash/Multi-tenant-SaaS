"use client";

import { useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { loginAction } from "@/actions/auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { copy } from "@/lib/copy";

export default function LoginForm() {
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
      const result = await loginAction({
        email: String(fd.get("email") ?? ""),
        password: String(fd.get("password") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const callback = safeInternalPath(searchParams.get("callbackUrl"));
      router.push(
        callback ||
          (result.data.orgSlug ? `/${result.data.orgSlug}/projects` : "/")
      );
      router.refresh();
    } catch {
      setError(copy.common.somethingWentWrong);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-small mb-2 font-semibold tracking-wide text-primary uppercase">
          SYZX
        </p>
        <h1 className="text-display">{copy.auth.signIn}</h1>
        <p className="text-body mt-1 text-muted-foreground">
          {copy.auth.welcomeBack}
        </p>
      </div>
      <form onSubmit={onSubmit} className="surface-elevated flex flex-col gap-3 p-5">
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
          placeholder={copy.common.password}
          required
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
        >
          {pending ? copy.auth.signingIn : copy.auth.signIn}
        </button>
      </form>
      <p className="text-body text-muted-foreground">
        {copy.auth.noAccount}{" "}
        <Link
          href={
            safeInternalPath(searchParams.get("callbackUrl"))
              ? `/register?callbackUrl=${encodeURIComponent(safeInternalPath(searchParams.get("callbackUrl"))!)}`
              : "/register"
          }
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {copy.auth.register}
        </Link>
      </p>
    </main>
  );
}
