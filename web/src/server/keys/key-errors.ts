// Typed, leak-safe key errors — the key layer's analogue of email-errors.ts.
// None of these ever carry key material or a raw provider/node message. The
// toSafeKeyErrorMeta() helper is the ONLY shape callers should log.

export class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyError";
  }
}

// The key provider is missing/invalid configuration (e.g. a malformed managed-
// KMS setup). Fail loud — there is no safe no-op for encryption.
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

// No ACTIVE key exists for a read-only resolve — the key was never created, or
// it was crypto-shredded (a client offboarded). The service maps this to a
// NotFound: the file's plaintext can no longer be produced. Read-only resolves
// NEVER create a key (that is an upload-only side effect).
export class KeyUnavailableError extends KeyError {
  constructor(message = "encryption key is unavailable") {
    super(message);
    this.name = "KeyUnavailableError";
  }
}

export type SafeKeyErrorMeta =
  | { category: "key_config_error" }
  | { category: "key_provider_error" }
  | { category: "key_unavailable" }
  | { category: "unknown_error" };

// Log-safe metadata for ANY thrown value from the key layer. Never reads
// err.message or any property beyond the typed class, so nothing sensitive can
// leak into a log line.
export function toSafeKeyErrorMeta(err: unknown): SafeKeyErrorMeta {
  if (err instanceof KeyConfigError) return { category: "key_config_error" };
  if (err instanceof KeyProviderError) return { category: "key_provider_error" };
  if (err instanceof KeyUnavailableError) return { category: "key_unavailable" };
  return { category: "unknown_error" };
}
