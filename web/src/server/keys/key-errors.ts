// Typed, leak-safe key errors — the key layer's analogue of email-errors.ts.
// None of these ever carry key material or a raw provider/node message. The
// toSafeKeyErrorMeta() helper is the ONLY shape callers should log.

export class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyError";
  }
}

// The key provider is missing/invalid configuration, OR a provider that needs
// an owner-gated dependency (AWS KMS) was selected before it is wired. Fail
// loud — there is no safe no-op for encryption.
export class KeyConfigError extends KeyError {
  constructor(message: string) {
    super(message);
    this.name = "KeyConfigError";
  }
}

// A wrap/unwrap operation against the master-KEK boundary failed at runtime
// (e.g. KMS rejected the call). Carries no key material — a stable, generic
// message only.
export class KeyProviderError extends KeyError {
  constructor(message = "key provider operation failed") {
    super(message);
    this.name = "KeyProviderError";
  }
}

export type SafeKeyErrorMeta =
  | { category: "key_config_error" }
  | { category: "key_provider_error" }
  | { category: "unknown_error" };

// Log-safe metadata for ANY thrown value from the key layer. Never reads
// err.message or any property beyond the typed class, so nothing sensitive can
// leak into a log line.
export function toSafeKeyErrorMeta(err: unknown): SafeKeyErrorMeta {
  if (err instanceof KeyConfigError) return { category: "key_config_error" };
  if (err instanceof KeyProviderError) return { category: "key_provider_error" };
  return { category: "unknown_error" };
}
