"use client";

import { copy } from "@/lib/copy";

export default function BoardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8">
      <h2 className="text-lg font-semibold">{copy.errors.board}</h2>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        {copy.errors.boardHint}
      </p>
      <p className="sr-only">{error.message}</p>
      <button
        type="button"
        className="rounded-lg border border-border px-3 py-1.5 text-sm"
        onClick={reset}
      >
        {copy.common.tryAgain}
      </button>
    </main>
  );
}
