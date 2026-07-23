import {
  fromBase64,
  KEY_BYTES,
  openBlob,
  sealToBlob,
  toBase64,
} from "../crypto/envelope";
import { KeyConfigError } from "./key-errors";
import type { KeyProvider, WrappedOfficeKey } from "./key-provider";

// Dev/test key provider: the "master KEK" is a 32-byte key supplied via
// AVI_MASTER_KEK_B64 (base64). It wraps the office key with AES-256-GCM and
// stores it as one opaque blob — the same shape a KMS ciphertext takes, so
// nothing downstream can tell the providers apart. NEVER for production: a raw
// env master key has none of KMS's isolation / rotation / audit, so the factory
// refuses to select this in a genuine production deployment.

const ENV_KEY = "AVI_MASTER_KEK_B64";

function loadMasterKek(): Buffer {
  const raw = process.env[ENV_KEY]?.trim();
  if (!raw) {
    throw new KeyConfigError(
      `${ENV_KEY} is not set — the local key provider needs a base64-encoded 32-byte master key`,
    );
  }
  const kek = fromBase64(raw);
  if (kek.length !== KEY_BYTES) {
    throw new KeyConfigError(
      `${ENV_KEY} must decode to exactly ${KEY_BYTES} bytes (got ${kek.length})`,
    );
  }
  return kek;
}

export function makeLocalKeyProvider(): KeyProvider {
  const kek = loadMasterKek(); // validated once at construction — fail-loud
  return {
    name: "local",
    async wrapOfficeKey(plaintext: Buffer): Promise<WrappedOfficeKey> {
      return { wrapped: toBase64(sealToBlob(kek, plaintext)), kmsKeyId: null };
    },
    async unwrapOfficeKey(input: WrappedOfficeKey): Promise<Buffer> {
      return openBlob(kek, fromBase64(input.wrapped));
    },
  };
}
