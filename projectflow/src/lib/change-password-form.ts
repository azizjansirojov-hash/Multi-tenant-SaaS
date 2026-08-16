import { z } from "zod";
import { copy } from "@/lib/copy";
import { changePasswordSchema } from "@/lib/validators";

/** Client-only confirm field. Server `changePassword` still uses current+new. */
export const changePasswordFormSchema = changePasswordSchema
  .extend({
    confirmPassword: z.string().min(1, copy.account.confirmRequired),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: copy.account.confirmMismatch,
    path: ["confirmPassword"],
  });
