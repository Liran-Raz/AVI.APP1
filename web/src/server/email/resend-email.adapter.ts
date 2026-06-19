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
// Fail-loud: send() resolves ONLY on a 2xx provider response. A non-2xx
// response or a thrown fetch (network/DNS/abort) becomes a typed
// EmailDeliveryError. Error messages never include the API key and never
// carry the full, unbounded provider body.

type ResendConfig = {
  apiKey: string;
  from: string;
};

// Cap provider error detail so we never log/propagate an unbounded body.
const MAX_DETAIL_CHARS = 300;

function sanitizeDetail(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DETAIL_CHARS
    ? `${oneLine.slice(0, MAX_DETAIL_CHARS)}…`
    : oneLine;
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
      } catch (err) {
        // Network / DNS / abort. Never swallow; wrap WITHOUT the API key
        // (the key lives only in the request header, never in the reason).
        const reason = err instanceof Error ? err.message : "network error";
        throw new EmailDeliveryError(`Resend request failed: ${reason}`);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new EmailDeliveryError(
          `Resend send failed: ${res.status} ${res.statusText}` +
            (detail ? ` — ${sanitizeDetail(detail)}` : ""),
          res.status,
        );
      }
    },
  };
}
