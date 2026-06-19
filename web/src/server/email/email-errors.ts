// Typed, provider-neutral email errors.
//
// These exist so that an email failure is always a *typed throw* the
// callers can recognise — never a silent no-op that looks like success.
//
// Hard rules for every message produced here (enforced by tests):
//   - ONLY stable metadata: provider name, HTTP status, internal category,
//     and an allowlisted provider error code.
//   - NEVER a raw provider response body or raw provider message.
//   - NEVER an API key / token, recipient address, subject, or HTML.
//
// Services translate these into AppError (or decide best-effort) before
// anything reaches the client.

export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailError";
  }
}

// The email provider is missing or has empty configuration. Thrown by the
// adapter selector's "unconfigured" adapter (in production and any deployed
// Vercel environment) so a misconfigured deployment fails loudly on every
// send instead of silently dropping mail through a no-op console adapter.
export class EmailConfigError extends EmailError {
  constructor(
    message = "Email provider is not configured (RESEND_API_KEY / MAIL_FROM missing).",
  ) {
    super(message);
    this.name = "EmailConfigError";
  }
}

export type EmailDeliveryErrorInput = {
  // Stable provider name, e.g. "resend".
  provider: string;
  // HTTP status, when a response was received from the provider.
  status?: number;
  // An ALLOWLISTED provider error code only (never free-form text). The
  // adapter is responsible for validating this against a known set before
  // passing it in.
  code?: string;
  // True when the HTTP call itself failed (network / DNS / abort) and no
  // response was received. We deliberately do NOT capture the raw
  // transport message, to avoid leaking host/internal detail.
  transport?: boolean;
};

// The provider rejected the request (non-2xx) or the HTTP call itself
// failed. The message is built ONLY from stable metadata — it can never
// contain the API key, recipient, subject, HTML, or the provider body.
export class EmailDeliveryError extends EmailError {
  public readonly provider: string;
  public readonly status?: number;
  public readonly providerCode?: string;
  public readonly transport: boolean;

  constructor(input: EmailDeliveryErrorInput) {
    const parts = [`provider=${input.provider}`];
    if (input.transport) parts.push("transport_error");
    if (input.status !== undefined) parts.push(`status=${input.status}`);
    if (input.code) parts.push(`code=${input.code}`);
    super(`Email delivery failed (${parts.join(", ")})`);
    this.name = "EmailDeliveryError";
    this.provider = input.provider;
    this.status = input.status;
    this.providerCode = input.code;
    this.transport = input.transport ?? false;
  }
}
