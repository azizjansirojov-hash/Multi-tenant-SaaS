import { Resend } from "resend";
import { InvitationEmail } from "@/emails/InvitationEmail";

export type SendInvitationEmailInput = {
  to: string;
  orgName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
};

export type SendInvitationEmailResult =
  | { sent: true }
  | { sent: false; reason: "placeholder" | "send_failed" };

const PLACEHOLDER_KEY_RE = /placeholder|replace_me|^re_test/i;

export function isResendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return false;
  return !PLACEHOLDER_KEY_RE.test(key);
}

function getFromAddress(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "SYZX <onboarding@resend.dev>"
  );
}

/**
 * Sends an invitation email via Resend.
 * Never throws — callers keep the Invitation row even if delivery fails.
 */
export async function sendInvitationEmail(
  input: SendInvitationEmailInput
): Promise<SendInvitationEmailResult> {
  if (!isResendConfigured()) {
    console.info(
      "[email] RESEND_API_KEY is missing or a placeholder — skipping send.",
      { to: input.to }
    );
    return { sent: false, reason: "placeholder" };
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY!);
    const { error } = await resend.emails.send({
      from: getFromAddress(),
      to: input.to,
      subject: `You've been invited to join ${input.orgName} on SYZX`,
      react: InvitationEmail({
        orgName: input.orgName,
        inviterName: input.inviterName,
        role: input.role,
        inviteUrl: input.inviteUrl,
      }),
    });

    if (error) {
      console.error("[email] Resend send failed:", error);
      return { sent: false, reason: "send_failed" };
    }

    return { sent: true };
  } catch (err) {
    console.error("[email] Resend send threw:", err);
    return { sent: false, reason: "send_failed" };
  }
}

export function buildInviteUrl(token: string): string {
  const base = (process.env.AUTH_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  return `${base}/invite/${token}`;
}
