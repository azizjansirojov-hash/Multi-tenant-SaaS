"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { registerAction } from "@/actions/auth";

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
    const result = await registerAction({
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
      organizationName: String(fd.get("organizationName") ?? ""),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const callback = searchParams.get("callbackUrl");
    router.push(callback || `/${result.data.orgSlug}/projects`);
    router.refresh();
  }

  const loginHref = searchParams.get("callbackUrl")
    ? `/login?callbackUrl=${encodeURIComponent(searchParams.get("callbackUrl")!)}`
    : "/login";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-semibold">Create account</h1>
        <p className="text-sm text-muted-foreground">Join SYZX</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          name="name"
          placeholder="Your name"
          required
          className="rounded-lg border border-border bg-background px-3 py-2"
        />
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
          placeholder="Password (min 8)"
          required
          minLength={8}
          className="rounded-lg border border-border bg-background px-3 py-2"
        />
        <input
          name="organizationName"
          placeholder="Organization name"
          required
          className="rounded-lg border border-border bg-background px-3 py-2"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Creating…" : "Register"}
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={loginHref} className="underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<main className="p-8">Loading…</main>}>
      <RegisterForm />
    </Suspense>
  );
}
