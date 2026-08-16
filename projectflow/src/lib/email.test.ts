import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock("@/emails/InvitationEmail", () => ({
  InvitationEmail: (props: unknown) => props,
  default: (props: unknown) => props,
}));

import {
  buildInviteUrl,
  isResendConfigured,
  sendInvitationEmail,
} from "@/lib/email";

describe("email helpers", () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalAuthUrl = process.env.AUTH_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_URL = "http://localhost:3000";
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = originalKey;
    process.env.AUTH_URL = originalAuthUrl;
  });

  it("isResendConfigured is false for placeholder keys", () => {
    process.env.RESEND_API_KEY = "re_placeholder_replace_me";
    expect(isResendConfigured()).toBe(false);
  });

  it("isResendConfigured is true for a real-looking key", () => {
    process.env.RESEND_API_KEY = "re_live_abc123xyz";
    expect(isResendConfigured()).toBe(true);
  });

  it("buildInviteUrl uses AUTH_URL", () => {
    expect(buildInviteUrl("tok")).toBe("http://localhost:3000/invite/tok");
  });

  it("sendInvitationEmail skips when key is placeholder", async () => {
    process.env.RESEND_API_KEY = "re_placeholder_replace_me";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await sendInvitationEmail({
      to: "a@example.com",
      orgName: "Acme",
      inviterName: "Owner",
      role: "MEMBER",
      inviteUrl: "http://localhost:3000/invite/tok",
    });
    expect(result).toEqual({ sent: false, reason: "placeholder" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/invite\/tok/);
    info.mockRestore();
  });

  it("sendInvitationEmail calls Resend with correct params", async () => {
    process.env.RESEND_API_KEY = "re_live_abc123xyz";
    sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });

    const result = await sendInvitationEmail({
      to: "a@example.com",
      orgName: "Acme",
      inviterName: "Owner",
      role: "MEMBER",
      inviteUrl: "http://localhost:3000/invite/tok",
    });

    expect(result).toEqual({ sent: true });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@example.com",
        subject: "You've been invited to join Acme on SYZX",
      })
    );
  });

  it("sendInvitationEmail returns send_failed on Resend error", async () => {
    process.env.RESEND_API_KEY = "re_live_abc123xyz";
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });

    const result = await sendInvitationEmail({
      to: "a@example.com",
      orgName: "Acme",
      inviterName: "Owner",
      role: "MEMBER",
      inviteUrl: "http://localhost:3000/invite/tok",
    });

    expect(result).toEqual({ sent: false, reason: "send_failed" });
  });
});
