"use client";

import { useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { loginAction } from "@/actions/auth";

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
    const result = await loginAction({
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const callback = searchParams.get("callbackUrl") || "/";
    router.push(callback);
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Welcome back to SYZX</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="rounded-lg border border-border bg-background px-3 py-2"
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          className="rounded-lg border border-border bg-background px-3 py-2"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        No account?{" "}
        <Link href="/register" className="underline">
          Register
        </Link>
      </p>
    </main>
  );
}
