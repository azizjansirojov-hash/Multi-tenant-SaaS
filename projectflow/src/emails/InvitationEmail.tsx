import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type InvitationEmailProps = {
  orgName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
};

export function InvitationEmail({
  orgName,
  inviterName,
  role,
  inviteUrl,
}: InvitationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        You&apos;ve been invited to join {orgName} on SYZX
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>Join {orgName} on SYZX</Heading>
          <Text style={text}>
            {inviterName} invited you to join <strong>{orgName}</strong> as a{" "}
            <strong>{role}</strong>.
          </Text>
          <Section style={buttonSection}>
            <Button style={button} href={inviteUrl}>
              Accept Invitation
            </Button>
          </Section>
          <Text style={text}>
            Or copy and paste this link into your browser:
          </Text>
          <Text style={linkText}>
            <Link href={inviteUrl} style={link}>
              {inviteUrl}
            </Link>
          </Text>
          <Text style={footer}>
            This invitation expires in 7 days. If you didn&apos;t expect this
            email, you can ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default InvitationEmail;

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "32px 24px",
  borderRadius: "8px",
  maxWidth: "520px",
};

const heading = {
  fontSize: "22px",
  fontWeight: "600" as const,
  color: "#111827",
  margin: "0 0 16px",
};

const text = {
  fontSize: "15px",
  lineHeight: "24px",
  color: "#374151",
  margin: "0 0 12px",
};

const buttonSection = {
  margin: "24px 0",
  textAlign: "center" as const,
};

const button = {
  backgroundColor: "#111827",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
};

const linkText = {
  fontSize: "13px",
  lineHeight: "20px",
  color: "#6b7280",
  margin: "0 0 12px",
  wordBreak: "break-all" as const,
};

const link = {
  color: "#2563eb",
  textDecoration: "underline",
};

const footer = {
  fontSize: "12px",
  lineHeight: "18px",
  color: "#9ca3af",
  margin: "24px 0 0",
};
