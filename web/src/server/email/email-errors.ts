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

// Log-safe metadata for ANY thrown value. This is the ONLY shape callers
// should log for an email failure: it can never carry free-form text
// (err.message / err.stack, a provider body, a recipient, a subject, a
// body, an invite URL, a token, or arbitrary error properties) — only a
// stable category and, for known email errors, allowlisted fields.
export type SafeErrorMeta =
  | { category: "config_error" }
  | {
      category: "delivery_error";
      provider: string;
      status?: number;
      providerCode?: string;
      transport?: boolean;
    }
  | { category: "unknown_error" };

export function toSafeErrorMeta(err: unknown): SafeErrorMeta {
  if (err instanceof EmailConfigError) {
    return { category: "config_error" };
  }
  if (err instanceof EmailDeliveryError) {
    // Build with only the fields that exist — never spread the error object.
    const meta: {
      category: "delivery_error";
      provider: string;
      status?: number;
      providerCode?: string;
      transport?: boolean;
    } = { category: "delivery_error", provider: err.provider };
    if (typeof err.status === "number") meta.status = err.status;
    if (err.providerCode) meta.providerCode = err.providerCode;
    if (err.transport) meta.transport = true;
    return meta;
  }
  // Plain Error / non-Error / anything unexpected: category ONLY. We never
  // read err.message or any property, so nothing sensitive can leak.
  return { category: "unknown_error" };
}
