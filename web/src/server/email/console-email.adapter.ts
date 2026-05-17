import "server-only";

import type { EmailAdapter, SendEmailInput } from "./email.adapter";

// Logs would-be sends to the server console. Used in dev and as a
// safety fallback if no real provider is configured — the app still
// runs end-to-end, you just don't actually deliver email.

export const consoleEmailAdapter: EmailAdapter = {
  async send(input: SendEmailInput): Promise<void> {
    // Intentionally a single line per send — easy to grep in logs.
    console.info(
      `[email:console] to=${input.to} subject=${JSON.stringify(input.subject)} body_chars=${input.text.length}`,
    );
  },
};
