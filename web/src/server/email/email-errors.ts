// Typed, provider-neutral email errors.
//
// These exist so that an email failure is always a *typed throw* the
// callers can recognise — never a silent no-op that looks like success.
//
// Hard rules for every message produced here:
//   - never contain an API key / token / secret
//   - never contain a full provider response body (cap + single-line)
//   - safe to write to server logs as-is
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
// adapter selector's production "unconfigured" adapter so a misconfigured
// production environment fails loudly on every send instead of silently
// dropping mail through a no-op console adapter.
export class EmailConfigError extends EmailError {
  constructor(
    message = "Email provider is not configured (RESEND_API_KEY / MAIL_FROM missing).",
  ) {
    super(message);
    this.name = "EmailConfigError";
  }
}

// The provider rejected the request (non-2xx) or the HTTP call itself
// failed (network/DNS/abort). `status` is the HTTP status when one was
// received. The message is sanitised: bounded length, single line, and
// guaranteed free of the API key.
export class EmailDeliveryError extends EmailError {
  public readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "EmailDeliveryError";
    this.status = status;
  }
}
