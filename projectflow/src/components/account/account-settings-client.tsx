"use client";

import { FormEvent, useState } from "react";
import { changePassword } from "@/actions/auth";
import { changePasswordFormSchema } from "@/lib/change-password-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { copy } from "@/lib/copy";

export function AccountSettingsClient() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const fd = new FormData(e.currentTarget);
    const parsed = changePasswordFormSchema.safeParse({
      currentPassword: String(fd.get("currentPassword") ?? ""),
      newPassword: String(fd.get("newPassword") ?? ""),
      confirmPassword: String(fd.get("confirmPassword") ?? ""),
    });
    if (!parsed.success) {
      const confirmErr = parsed.error.flatten().fieldErrors.confirmPassword?.[0];
      setError(confirmErr ?? parsed.error.issues[0]?.message ?? copy.common.somethingWentWrong);
      return;
    }

    setPending(true);
    const result = await changePassword({
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess(true);
    e.currentTarget.reset();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">{copy.account.title}</h1>
        <p className="text-body text-muted-foreground">
          {copy.account.subtitle}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{copy.account.password}</CardTitle>
          <CardDescription>{copy.account.passwordHint}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">{copy.account.current}</Label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">{copy.account.next}</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">{copy.account.confirm}</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {success ? (
              <p className="text-sm text-muted-foreground">{copy.account.updated}</p>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? copy.common.saving : copy.account.update}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
