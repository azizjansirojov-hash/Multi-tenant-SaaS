"use client";

import Link from "next/link";
import { copy } from "@/lib/copy";
import { isPlanLimitError } from "@/lib/plan";

export function ActionErrorMessage({
  error,
  orgSlug,
}: {
  error: string | null;
  orgSlug: string;
}) {
  if (!error) return null;
  if (isPlanLimitError(error)) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {copy.billing.upgradePrompt}{" "}
        <Link
          href={`/${orgSlug}/settings/billing`}
          className="underline underline-offset-2"
        >
          {copy.billing.upgrade}
        </Link>
      </p>
    );
  }
  return (
    <p className="text-sm text-destructive" role="alert">
      {error}
    </p>
  );
}
