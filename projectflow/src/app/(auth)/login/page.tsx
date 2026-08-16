import { Suspense } from "react";
import { copy } from "@/lib/copy";
import LoginForm from "./login-form";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-8">{copy.common.loading}</main>}>
      <LoginForm />
    </Suspense>
  );
}
