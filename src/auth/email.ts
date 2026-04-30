import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.FROM_EMAIL ?? "noreply@videntia.dev";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3055";

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const link = `${BASE_URL}/api/auth/verify?token=${token}`;

  if (!resend) {
    console.log(`[EMAIL] Verify link for ${email}: ${link}`);
    return;
  }

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: "Verify your Videntia account",
    html: `
      <p>Welcome to Videntia Figma MCP!</p>
      <p><a href="${link}">Click here to verify your email address</a></p>
      <p>This link expires in 24 hours.</p>
      <p>If you did not register, you can ignore this email.</p>
    `,
  });
}
