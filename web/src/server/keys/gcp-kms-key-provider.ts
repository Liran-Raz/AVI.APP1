import { KeyManagementServiceClient } from "@google-cloud/kms";

import { fromBase64, toBase64 } from "../crypto/envelope";
import { KeyConfigError, KeyProviderError } from "./key-errors";
import type { KeyProvider, WrappedOfficeKey } from "./key-provider";

// Google Cloud KMS office-key provider (`europe` multi-region).
//
// The master KEK deliberately lives in a DIFFERENT cloud than the data
// (Supabase runs on AWS): no single provider breach yields both the wrapped
// keys and the master that opens them. The key sits in the `europe`
// MULTI-REGION location — stored and served from multiple EU data centers —
// so a single-region outage or even permanent regional loss cannot take the
// master key with it (DR requirement, 2026-07-24). KMS is called at most once per office
// per request (the hierarchy caches the plaintext); client keys and per-file
// DEKs never touch KMS.
//
// Auth, by host:
//   - Vercel: AVI_GCP_SA_KEY_B64 = base64 of a service-account JSON whose ONLY
//     role is cloudkms.cryptoKeyEncrypterDecrypter on this one key.
//   - Cloud Run (media service): omit the env var — the ambient service
//     identity (ADC) is used; no key file exists anywhere.
//
// Integrity: CRC32C verification of KMS responses is deliberately omitted —
// everything derived from the office key is AES-GCM-authenticated (client-key
// and DEK unwraps), so a corrupted KMS plaintext fails closed one step later
// with CryptoAuthError; nothing decrypts under a wrong key.

export interface GcpKmsKeyProviderConfig {
  // Full key resource name:
  // projects/<p>/locations/europe/keyRings/<ring>/cryptoKeys/<key>
  keyName: string;
  // base64 service-account JSON (Vercel). Omit to use ambient ADC (Cloud Run).
  saKeyB64?: string;
}

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

function parseServiceAccount(saKeyB64: string): ServiceAccountCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(saKeyB64, "base64").toString("utf8"));
  } catch {
    throw new KeyConfigError(
      "AVI_GCP_SA_KEY_B64 is not valid base64-encoded JSON",
    );
  }
  const sa = parsed as Partial<ServiceAccountCredentials>;
  if (!sa.client_email || !sa.private_key) {
    throw new KeyConfigError(
      "AVI_GCP_SA_KEY_B64 must decode to a service-account JSON with client_email and private_key",
    );
  }
  return sa as ServiceAccountCredentials;
}

// gRPC gives bytes; the REST transport gives base64 strings. Normalize both.
function toBuffer(data: Uint8Array | string | null | undefined): Buffer | null {
  if (data == null) return null;
  if (typeof data === "string") return Buffer.from(data, "base64");
  return Buffer.from(data);
}

// gax errors carry a numeric gRPC status code — safe to surface. Never the raw
// provider message (leak-safe rule of the key layer).
function providerFailure(op: string, err: unknown): KeyProviderError {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code: unknown }).code
      : undefined;
  return new KeyProviderError(
    typeof code === "number"
      ? `key provider ${op} failed (status ${code})`
      : `key provider ${op} failed`,
  );
}

export function makeGcpKmsKeyProvider(
  config: GcpKmsKeyProviderConfig,
): KeyProvider {
  const keyName = config.keyName;
  let client: KeyManagementServiceClient;
  if (config.saKeyB64) {
    const sa = parseServiceAccount(config.saKeyB64); // fail-loud at selection
    client = new KeyManagementServiceClient({
      credentials: {
        client_email: sa.client_email,
        private_key: sa.private_key,
      },
      projectId: sa.project_id,
    });
  } else {
    client = new KeyManagementServiceClient();
  }

  return {
    name: "gcp-kms",
    async wrapOfficeKey(plaintext: Buffer): Promise<WrappedOfficeKey> {
      let ciphertext: Buffer | null;
      try {
        const [response] = await client.encrypt({ name: keyName, plaintext });
        ciphertext = toBuffer(response.ciphertext);
      } catch (err) {
        throw providerFailure("wrap", err);
      }
      if (!ciphertext || ciphertext.length === 0) {
        throw new KeyProviderError("key provider wrap returned no ciphertext");
      }
      return { wrapped: toBase64(ciphertext), kmsKeyId: keyName };
    },
    async unwrapOfficeKey(input: WrappedOfficeKey): Promise<Buffer> {
      if (input.kmsKeyId !== keyName) {
        // A stored office key wrapped by a DIFFERENT master (e.g. the dev
        // "local" marker) can never open here — refuse with a clear,
        // material-free signal instead of an opaque KMS error.
        throw new KeyProviderError(
          "wrapped office key was produced by a different master key",
        );
      }
      let plaintext: Buffer | null;
      try {
        const [response] = await client.decrypt({
          name: keyName,
          ciphertext: fromBase64(input.wrapped),
        });
        plaintext = toBuffer(response.plaintext);
      } catch (err) {
        throw providerFailure("unwrap", err);
      }
      if (!plaintext || plaintext.length === 0) {
        throw new KeyProviderError("key provider unwrap returned no plaintext");
      }
      return plaintext;
    },
  };
}
