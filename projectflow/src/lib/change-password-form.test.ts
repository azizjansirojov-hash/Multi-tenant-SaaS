import { describe, expect, it } from "vitest";
import { changePasswordFormSchema } from "@/lib/change-password-form";
import { changePasswordSchema } from "@/lib/validators";

describe("changePasswordFormSchema (client-only confirm)", () => {
  it("rejects confirm mismatch before the server is called", () => {
    const parsed = changePasswordFormSchema.safeParse({
      currentPassword: "old-password-9",
      newPassword: "brand-new-pass",
      confirmPassword: "different-pass",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.confirmPassword).toContain(
        "Passwords do not match"
      );
    }
  });

  it("accepts matching passwords", () => {
    const parsed = changePasswordFormSchema.safeParse({
      currentPassword: "old-password-9",
      newPassword: "brand-new-pass",
      confirmPassword: "brand-new-pass",
    });
    expect(parsed.success).toBe(true);
  });

  it("does not add confirmPassword to the server schema", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "old-password-9",
      newPassword: "brand-new-pass",
    });
    expect(parsed.success).toBe(true);
  });
});
