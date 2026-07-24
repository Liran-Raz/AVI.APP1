// The KeyProvider is the master-KEK trust boundary — the ONE place an office key
// crosses in/out of its wrapped form. In production this is Google Cloud KMS
// (the `europe` multi-region); in dev it is a local env master key. Client keys
// and per-file DEKs are NOT wrapped here — they are wrapped by the office/owner
// key via the envelope primitives inside the key hierarchy. Keeping this
// interface tiny (office key only) is deliberate: KMS is called at most once per
// office per request, never per file.

// A wrapped office key as stored on encryption_keys: an opaque base64 blob plus
// the master-key id that produced it. Always non-null (the DB office-shape CHECK
// requires kms_key_id): KMS uses the master key's full resource name; the local
// provider uses the marker "local" so a stored key records which provider
// wrapped it.
export interface WrappedOfficeKey {
  wrapped: string; // base64, opaque to callers
  kmsKeyId: string;
}

export interface KeyProvider {
  readonly name: string;
  // Wrap a freshly generated 32-byte office key for storage.
  wrapOfficeKey(plaintext: Buffer): Promise<WrappedOfficeKey>;
  // Recover the plaintext office key from its stored wrapped form.
  unwrapOfficeKey(input: WrappedOfficeKey): Promise<Buffer>;
}
