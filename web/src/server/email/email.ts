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
//   - If they are missing/empty in any DEPLOYED environment (Vercel
//     Production or Preview) → an "unconfigured" adapter whose send()
//     THROWS. No deployed environment may silently fall back to a no-op
//     that reports fake successful deliveries.
//   - If they are missing/empty in genuine local development or the test
//     runner → the console adapter (explicit, environment-gated) so the
//     app still runs locally without a provider.

let cached: EmailAdapter | null = null;

// Whether a missing/empty email config must FAIL LOUD rather than fall back
// to the dev console adapter.
//
// True for production AND for any deployed Vercel environment (preview or
// production). Vercel builds every deployment with NODE_ENV=production, and
// VERCEL_ENV is an explicit, independent signal — so the guard holds even
// if NODE_ENV were ever misconfigured on a deployment. False ONLY for
// genuine local development (`next dev` / `vercel dev`) and the test runner.
function mustFailLoudWithoutConfig(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production" || vercelEnv === "preview") return true;
  return false;
}

// Adapter that refuses to succeed. Returned in deployed environments when
// email is not configured: each send() throws a typed, non-secret error so
// the failure is loud and observable instead of a silent drop.
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
  if (mustFailLoudWithoutConfig()) {
    // NEVER silently no-op in a deployed environment. Return a fail-loud
    // adapter; do NOT cache it, so a corrected environment (new deploy /
    // fresh instance) can recover and the loud log is re-emitted on retry.
    console.error(
      "[email] RESEND_API_KEY/MAIL_FROM missing in a deployed environment " +
        "(production/preview) — real email delivery is DISABLED; send " +
        "attempts will fail loudly",
    );
    return makeUnconfiguredEmailAdapter();
  }

  // Genuine local development / test only: explicit, environment-gated
  // console fallback.
  cached = consoleEmailAdapter;
  if (process.env.NODE_ENV !== "test") {
    console.info(
      "[email] using console adapter (local dev) — set RESEND_API_KEY and MAIL_FROM to send for real",
    );
  }
  return cached;
}
