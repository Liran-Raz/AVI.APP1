import "server-only";

import { consoleEmailAdapter } from "./console-email.adapter";
import type { EmailAdapter } from "./email.adapter";
import { EmailConfigError } from "./email-errors";
import { makeResendEmailAdapter } from "./resend-email.adapter";

// One-time lazy resolution of the active adapter. Reads env directly
// (not via the validated env module) because the email keys are
// optional — server boot must not fail just because email is not
// configured yet.
//
// Fail-loud contract (F7):
//   - If RESEND_API_KEY and MAIL_FROM are both set → Resend (every env).
//   - If they are missing/empty IN PRODUCTION → an "unconfigured" adapter
//     whose send() THROWS. Production must never silently fall back to a
//     no-op that reports fake successful deliveries.
//   - If they are missing/empty in development/test → the console adapter
//     (explicit, environment-gated) so the app still runs locally without
//     a provider. This fallback is deliberately *not* available in prod.

let cached: EmailAdapter | null = null;

// Adapter that refuses to succeed. Returned in production when email is
// not configured: each send() throws a typed, non-secret error so the
// failure is loud and observable instead of a silent drop.
function makeUnconfiguredEmailAdapter(): EmailAdapter {
  return {
    async send(): Promise<void> {
      throw new EmailConfigError();
    },
  };
}

export function getEmailAdapter(): EmailAdapter {
  if (cached) return cached;

  // Trim so a whitespace-only value is treated as empty (not configured).
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const mailFrom = process.env.MAIL_FROM?.trim();

  if (resendKey && mailFrom) {
    cached = makeResendEmailAdapter({ apiKey: resendKey, from: mailFrom });
    console.info("[email] using Resend adapter");
    return cached;
  }

  // Config missing or empty.
  if (process.env.NODE_ENV === "production") {
    // NEVER silently no-op in production. Return a fail-loud adapter; do
    // NOT cache it, so a corrected environment (new deploy / fresh
    // instance) can recover and so the loud log is re-emitted on retry.
    console.error(
      "[email] RESEND_API_KEY/MAIL_FROM missing in production — real " +
        "email delivery is DISABLED; send attempts will fail loudly",
    );
    return makeUnconfiguredEmailAdapter();
  }

  // Development / test only: explicit, environment-gated console fallback.
  cached = consoleEmailAdapter;
  if (process.env.NODE_ENV !== "test") {
    console.info(
      "[email] using console adapter (dev) — set RESEND_API_KEY and MAIL_FROM to send for real",
    );
  }
  return cached;
}
