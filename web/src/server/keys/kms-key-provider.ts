import { KeyConfigError } from "./key-errors";
import type { KeyProvider } from "./key-provider";

// AWS KMS office-key provider (il-central-1 / Tel-Aviv).
//
// ⚠ OWNER-GATED — NOT WIRED YET. Turning this on requires two owner approvals
// tracked in the DEV-032 plan:
//   1. the `@aws-sdk/client-kms` dependency (the first cloud SDK beyond
//      Supabase/Upstash), and
//   2. an AWS account + a master key in il-central-1 + minimal IAM (~$1/key/mo).
// Until both land, the factory still SELECTS this provider when
// AVI_KMS_MASTER_KEY_ARN is set (so the selection + fail-loud path are
// exercised), but every operation throws a typed KeyConfigError instead of
// silently doing nothing. Dev/test use the local provider.
//
// INTENDED IMPLEMENTATION (drop in once the dependency is approved):
//   import { KMSClient, EncryptCommand, DecryptCommand } from "@aws-sdk/client-kms";
//   const client = new KMSClient({ region: config.region });
//   wrapOfficeKey(plaintext):
//     const out = await client.send(new EncryptCommand({ KeyId: config.masterKeyArn, Plaintext: plaintext }));
//     return { wrapped: Buffer.from(out.CiphertextBlob!).toString("base64"), kmsKeyId: config.masterKeyArn };
//   unwrapOfficeKey({ wrapped }):
//     const out = await client.send(new DecryptCommand({ CiphertextBlob: fromBase64(wrapped), KeyId: config.masterKeyArn }));
//     return Buffer.from(out.Plaintext!);
// The office key is decrypted at most once per office per request (the hierarchy
// caches the plaintext); client keys + per-file DEKs never touch KMS.

export interface KmsKeyProviderConfig {
  masterKeyArn: string;
  region: string;
}

const NOT_WIRED =
  "AWS KMS key provider is not wired yet — the @aws-sdk/client-kms dependency " +
  "and AWS KMS (il-central-1) setup are pending owner approval (DEV-032). Use " +
  "the local provider (AVI_MASTER_KEK_B64) for dev/test.";

export function makeKmsKeyProvider(config: KmsKeyProviderConfig): KeyProvider {
  void config; // reserved until the KMS dependency is approved (see header)
  return {
    name: "kms",
    async wrapOfficeKey(): Promise<never> {
      throw new KeyConfigError(NOT_WIRED);
    },
    async unwrapOfficeKey(): Promise<never> {
      throw new KeyConfigError(NOT_WIRED);
    },
  };
}
