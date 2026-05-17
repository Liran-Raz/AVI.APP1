import "server-only";

import { consoleEmailAdapter } from "./console-email.adapter";
import type { EmailAdapter } from "./email.adapter";
import { makeResendEmailAdapter } from "./resend-email.adapter";

// One-time lazy resolution of the active adapter. Reads env directly
// (not via the validated env module) because the email keys are
// optional — server boot must not fail just because email is not
// configured yet. If RESEND_API_KEY is missing or MAIL_FROM is missing
// we fall back to the console adapter so feature #12 still "runs"
// end-to-end in dev.

let cached: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (cached) return cached;
  const resendKey = process.env.RESEND_API_KEY;
  const mailFrom = process.env.MAIL_FROM;
  if (resendKey && mailFrom) {
    cached = makeResendEmailAdapter({ apiKey: resendKey, from: mailFrom });
    console.info("[email] using Resend adapter");
  } else {
    cached = consoleEmailAdapter;
    if (process.env.NODE_ENV !== "test") {
      console.info(
        "[email] using console adapter — set RESEND_API_KEY and MAIL_FROM to send for real",
      );
    }
  }
  return cached;
}
