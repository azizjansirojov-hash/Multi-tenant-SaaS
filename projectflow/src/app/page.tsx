import Link from "next/link";
import { copy } from "@/lib/copy";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-foreground">
      <h1 className="text-5xl font-semibold tracking-tight">SYZX</h1>
      <p className="max-w-md text-center text-muted-foreground">
        {copy.home.tagline}
      </p>
      <Link
        href="/login"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {copy.home.signIn}
      </Link>
    </main>
  );
}
