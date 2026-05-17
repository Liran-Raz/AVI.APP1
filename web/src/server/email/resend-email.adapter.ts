import "server-only";

import type { EmailAdapter, SendEmailInput } from "./email.adapter";

// Resend implementation. Activated when RESEND_API_KEY is present in
// env. Resend offers a generous free tier and a simple HTTP API, so
// we hit it directly via fetch — no extra npm dependency.
//
// MAIL_FROM is required (Resend rejects sends without a verified
// "from" address). Set both to enable the adapter.

type ResendConfig = {
  apiKey: string;
  from: string;
};

export function makeResendEmailAdapter(config: ResendConfig): EmailAdapter {
  return {
    async send(input: SendEmailInput): Promise<void> {
      const res = await fetch("https://api.resend.com/emails", {
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
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Resend send failed: ${res.status} ${res.statusText} ${detail}`,
        );
      }
    },
  };
}
