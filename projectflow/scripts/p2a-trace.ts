import "dotenv/config";
import { isResendConfigured, buildInviteUrl, sendInvitationEmail } from "../src/lib/email";
import { checkRateLimit, RATE_LIMITS } from "../src/lib/rate-limit";

async function main() {
  console.log("[trace] isResendConfigured=", isResendConfigured());
  const url = buildInviteUrl("manual-trace-token");
  console.log("[trace] inviteUrl=", url);
  const send = await sendInvitationEmail({
    to: "trace@example.com",
    orgName: "Trace Org",
    inviterName: "Owner",
    role: "MEMBER",
    inviteUrl: url,
  });
  console.log("[trace] sendResult=", send);

  const key = `login:email:p2a-trace-${Date.now()}@example.com`;
  const now = new Date();
  for (let i = 1; i <= 6; i++) {
    const r = await checkRateLimit({ key, ...RATE_LIMITS.login, now });
    console.log(
      "[trace] login attempt",
      i,
      r.allowed ? "ALLOWED" : "BLOCKED"
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
