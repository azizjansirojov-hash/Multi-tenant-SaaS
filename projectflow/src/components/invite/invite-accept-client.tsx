"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { acceptInvitation } from "@/actions/organization";
import { Button } from "@/components/ui/button";

type Props = {
  token: string;
  authenticated: boolean;
  preview: {
    orgName: string;
    email: string;
    role: string;
    expired: boolean;
    used: boolean;
  } | null;
  previewError: string | null;
};

export function InviteAcceptClient({
  token,
  authenticated,
  preview,
  previewError,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onAccept() {
    setPending(true);
    setError(null);
    const result = await acceptInvitation({ token });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/${result.data.orgSlug}/projects`);
    router.refresh();
  }

  const callback = encodeURIComponent(`/invite/${token}`);

  if (previewError && !preview) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Invitation</h1>
        <p className="text-destructive">{previewError}</p>
        <Link href="/" className="text-sm underline">
          Home
        </Link>
      </main>
    );
  }

  if (preview?.used) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Invitation already used</h1>
        <p className="text-sm text-muted-foreground">
          This invite link has already been accepted.
        </p>
      </main>
    );
  }

  if (preview?.expired) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Invitation expired</h1>
        <p className="text-sm text-muted-foreground">
          Ask an admin to send a new invite.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">Join organization</h1>
        {preview ? (
          <p className="mt-2 text-sm text-muted-foreground">
            You are invited to <strong>{preview.orgName}</strong> as{" "}
            <strong>{preview.role}</strong>. This invite was sent to{" "}
            <strong>{preview.email}</strong>.
          </p>
        ) : null}
      </div>

      {!authenticated ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Sign in or register with the invited email to accept.
          </p>
          <Link
            href={`/login?callbackUrl=${callback}`}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground"
          >
            Sign in
          </Link>
          <Link
            href={`/register?callbackUrl=${callback}`}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border px-2.5 text-sm font-medium"
          >
            Register
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Your account email must match the invitation email.
          </p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="button" onClick={onAccept} disabled={pending}>
            {pending ? "Accepting…" : "Accept invitation"}
          </Button>
        </div>
      )}
    </main>
  );
}
