// The persistence boundary for wrapped keys. The key hierarchy depends on THIS
// interface, not on Supabase — so the whole crypto core runs unchanged in a
// standalone Node service (Cloud Run). The concrete Supabase-backed
// implementation (encryption-keys.repository.ts, calling the definer RPCs
// attachments_get_office_key / _insert_office_key / _get_client_key /
// _insert_client_key) is built in the next layer, once attachments is added to
// database.types.
//
// All blobs are base64 strings here (the DB stores base64 TEXT; the RPCs return
// it verbatim). The hierarchy decodes to Buffers only for the crypto step.

export interface OfficeKeyRecord {
  id: string;
  wrappedKey: string; // base64 opaque blob (local seal or KMS ciphertext)
  kmsKeyId: string | null;
  algo: string;
  keyVersion: number;
}

export interface ClientKeyRecord {
  id: string;
  wrappedKey: string; // base64 ciphertext (wrapped by the office key)
  wrapIv: string; // base64
  wrapTag: string; // base64
  wrappedByKeyId: string; // the office key that wrapped this client key
  algo: string;
  keyVersion: number;
}

export interface InsertOfficeKeyInput {
  orgId: string;
  wrappedKey: string;
  kmsKeyId: string | null;
  algo: string;
}

export interface InsertClientKeyInput {
  orgId: string;
  clientId: string;
  wrappedKey: string;
  wrapIv: string;
  wrapTag: string;
  wrappedByKeyId: string;
  algo: string;
}

export interface KeyStore {
  getActiveOfficeKey(orgId: string): Promise<OfficeKeyRecord | null>;
  insertOfficeKey(input: InsertOfficeKeyInput): Promise<{ id: string }>;
  getActiveClientKey(
    orgId: string,
    clientId: string,
  ): Promise<ClientKeyRecord | null>;
  insertClientKey(input: InsertClientKeyInput): Promise<{ id: string }>;
}

// Thrown by an insert* when a concurrent request already minted the ACTIVE key
// for this scope (the DB's one-active-key partial-unique index raised 23505).
// The hierarchy catches this and re-reads, so two racing uploads converge on a
// single key rather than one failing.
export class KeyRaceError extends Error {
  constructor(message = "an active key already exists for this scope") {
    super(message);
    this.name = "KeyRaceError";
  }
}
