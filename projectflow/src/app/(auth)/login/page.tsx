import { Suspense } from "react";
import LoginForm from "./login-form";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-8">Loading…</main>}>
      <LoginForm />
    </Suspense>
  );
}
