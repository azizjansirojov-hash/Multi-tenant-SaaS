"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { acceptInvitation } from "@/actions/organization";
import { Button } from "@/components/ui/button";
import { safeInternalPath } from "@/lib/safe-redirect";
import { copy, roleLabel } from "@/lib/copy";

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

  const callback = encodeURIComponent(
    safeInternalPath(`/invite/${token}`) ?? "/"
  );

  if (previewError && !preview) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">{copy.invite.title}</h1>
        <p className="text-destructive">{previewError}</p>
        <Link href="/" className="text-sm underline">
          {copy.invite.home}
        </Link>
      </main>
    );
  }

  if (preview?.used) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">{copy.invite.used}</h1>
        <p className="text-sm text-muted-foreground">
          {copy.invite.usedHint}
        </p>
      </main>
    );
  }

  if (preview?.expired) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">{copy.invite.expired}</h1>
        <p className="text-sm text-muted-foreground">
          {copy.invite.expiredHint}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">{copy.invite.join}</h1>
        {preview ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {copy.invite.invitedTo} <strong>{preview.orgName}</strong> {copy.invite.as}{" "}
            <strong>{roleLabel(preview.role)}</strong>. {copy.invite.sentTo}{" "}
            <strong>{preview.email}</strong>.
          </p>
        ) : null}
      </div>

      {!authenticated ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {copy.invite.signInToAccept}
          </p>
          <Link
            href={`/login?callbackUrl=${callback}`}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground"
          >
            {copy.auth.signIn}
          </Link>
          <Link
            href={`/register?callbackUrl=${callback}`}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border px-2.5 text-sm font-medium"
          >
            {copy.auth.register}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {copy.invite.emailMustMatch}
          </p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="button" onClick={onAccept} disabled={pending}>
            {pending ? copy.invite.accepting : copy.invite.accept}
          </Button>
        </div>
      )}
    </main>
  );
}
