// Typed, leak-safe crypto errors. A crypto failure is always a typed throw the
// callers can recognise — and NONE of these ever carry key material, plaintext,
// ivs/tags, or a raw node error message. Services translate them to a generic
// AppError("INTERNAL_ERROR", 500) before anything reaches the client.

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

// Authenticated decryption failed: tampered ciphertext/tag/iv, or the wrong
// key. Deliberately carries NO detail — the mere fact of failure is all a
// caller (or a log line) may see. Never distinguish "wrong key" from "tampered
// data" to an attacker.
export class CryptoAuthError extends CryptoError {
  constructor() {
    super("authenticated decryption failed");
    this.name = "CryptoAuthError";
  }
}

// Malformed input (wrong key/iv/tag length, truncated sealed blob). A data-shape
// / programming error, not an attacker signal — still leak-free.
export class CryptoFormatError extends CryptoError {
  constructor(message = "malformed crypto input") {
    super(message);
    this.name = "CryptoFormatError";
  }
}
