import { makeGcpKmsKeyProvider } from "./gcp-kms-key-provider";
import { KeyConfigError } from "./key-errors";
import type { KeyProvider } from "./key-provider";
import { makeLocalKeyProvider } from "./local-key-provider";

// Runtime selection of the master-KEK provider, mirroring the email adapter's
// fail-loud contract — but STRICTER: encryption has no safe no-op fallback, so
// a missing/invalid config ALWAYS throws (never a silent stand-in). Reads
// process.env directly (like the email adapter) so this optional feature never
// makes server boot depend on its vars.
//
// Selection order:
//   1. AVI_GCP_KMS_KEY_NAME set → Google Cloud KMS provider (me-west1).
//      Credentials: AVI_GCP_SA_KEY_B64 (Vercel) or ambient ADC (Cloud Run).
//   2. genuine production without a KMS key name → THROW (a raw env master key
//      must never be the production master; managed KMS is required there).
//   3. AVI_MASTER_KEK_B64 set (dev / preview / test) → local provider.
//   4. nothing configured → THROW.

// A genuine production deployment (Vercel prod / the Cloud Run media service).
// Preview is treated as non-prod so it can QA the feature with a local master
// key before the KMS is provisioned.
function isProductionDeployment(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "preview") return false;
  if (vercelEnv === "production") return true;
  return process.env.NODE_ENV === "production";
}

let cached: KeyProvider | null = null;

export function getKeyProvider(): KeyProvider {
  if (cached) return cached;

  const gcpKeyName = process.env.AVI_GCP_KMS_KEY_NAME?.trim();
  if (gcpKeyName) {
    cached = makeGcpKmsKeyProvider({
      keyName: gcpKeyName,
      saKeyB64: process.env.AVI_GCP_SA_KEY_B64?.trim() || undefined,
    });
    return cached;
  }

  if (isProductionDeployment()) {
    // Do NOT cache — a corrected deployment (KMS key name added on a fresh
    // instance) must be able to recover.
    throw new KeyConfigError(
      "no managed key provider configured in production — set AVI_GCP_KMS_KEY_NAME (Google Cloud KMS, me-west1)",
    );
  }

  const localKek = process.env.AVI_MASTER_KEK_B64?.trim();
  if (localKek) {
    cached = makeLocalKeyProvider();
    return cached;
  }

  throw new KeyConfigError(
    "no key provider configured — set AVI_GCP_KMS_KEY_NAME (production) or AVI_MASTER_KEK_B64 (dev/test)",
  );
}
