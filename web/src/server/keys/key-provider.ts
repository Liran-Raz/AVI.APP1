// The KeyProvider is the master-KEK trust boundary — the ONE place an office key
// crosses in/out of its wrapped form. In production this is AWS KMS
// (il-central-1 / Tel-Aviv); in dev it is a local env master key. Client keys
// and per-file DEKs are NOT wrapped here — they are wrapped by the office/owner
// key via the envelope primitives inside the key hierarchy. Keeping this
// interface tiny (office key only) is deliberate: KMS is called at most once per
// office per request, never per file.

// A wrapped office key as stored on encryption_keys: an opaque base64 blob plus
// the KMS master id that produced it (null for the local provider).
export interface WrappedOfficeKey {
  wrapped: string; // base64, opaque to callers
  kmsKeyId: string | null;
}

export interface KeyProvider {
  readonly name: string;
  // Wrap a freshly generated 32-byte office key for storage.
  wrapOfficeKey(plaintext: Buffer): Promise<WrappedOfficeKey>;
  // Recover the plaintext office key from its stored wrapped form.
  unwrapOfficeKey(input: WrappedOfficeKey): Promise<Buffer>;
}
