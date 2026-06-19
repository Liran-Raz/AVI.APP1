import "server-only";

import type { EmailAdapter, SendEmailInput } from "./email.adapter";
import { EmailDeliveryError } from "./email-errors";

// Resend implementation. Activated when RESEND_API_KEY is present in
// env. Resend offers a generous free tier and a simple HTTP API, so
// we hit it directly via fetch — no extra npm dependency.
//
// MAIL_FROM is required (Resend rejects sends without a verified
// "from" address). Set both to enable the adapter.
//
// Fail-loud + no leakage: send() resolves ONLY on a 2xx provider response.
// A non-2xx response or a thrown fetch becomes a typed EmailDeliveryError
// built ONLY from stable metadata (provider name, HTTP status, and an
// allowlisted error code). The raw provider body, the provider's free-form
// message, the recipient, the subject, the HTML, and the API key are NEVER
// placed into the error or any log.

const PROVIDER = "resend";

type ResendConfig = {
  apiKey: string;
  from: string;
};

// Explicit allowlist of Resend error `name` codes that are safe to surface.
// These are stable, documented category tokens — not free-form text. Any
// value outside this set (including an attacker-influenced `name`) is
// dropped, so only a known code can ever appear in an error/log.
const ALLOWED_RESEND_ERROR_CODES: ReadonlySet<string> = new Set([
  "validation_error",
  "missing_required_field",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "concurrent_idempotent_requests",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_to_address",
  "invalid_scope",
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "not_found",
  "method_not_allowed",
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "security_error",
  "application_error",
  "internal_server_error",
]);

// Parse the provider body and return its error `name` ONLY if it is in the
// allowlist. Returns undefined for anything else (non-JSON, unexpected
// shape, or an unknown/free-form `name`). Never returns arbitrary text.
function extractAllowedCode(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "name" in parsed) {
      const name = (parsed as { name?: unknown }).name;
      if (typeof name === "string" && ALLOWED_RESEND_ERROR_CODES.has(name)) {
        return name;
      }
    }
  } catch {
    // Not JSON / unexpected shape — surface no code.
  }
  return undefined;
}

export function makeResendEmailAdapter(config: ResendConfig): EmailAdapter {
  return {
    async send(input: SendEmailInput): Promise<void> {
      let res: Response;
      try {
        res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: config.from,
            to: input.to,
            subject: input.subject,
            text: input.text,
            html: input.html,
          }),
        });
      } catch {
        // Network / DNS / abort. Never swallow; surface a typed transport
        // error WITHOUT the raw reason (which could carry host/internal
        // detail) and obviously without the API key.
        throw new EmailDeliveryError({ provider: PROVIDER, transport: true });
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const code = extractAllowedCode(body);
        throw new EmailDeliveryError({
          provider: PROVIDER,
          status: res.status,
          code,
        });
      }
    },
  };
}
