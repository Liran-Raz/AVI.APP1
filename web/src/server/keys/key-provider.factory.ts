import { KeyConfigError } from "./key-errors";
import type { KeyProvider } from "./key-provider";
import { makeKmsKeyProvider } from "./kms-key-provider";
import { makeLocalKeyProvider } from "./local-key-provider";

// Runtime selection of the master-KEK provider, mirroring the email adapter's
// fail-loud contract — but STRICTER: encryption has no safe no-op fallback, so
// a missing/invalid config ALWAYS throws (never a silent stand-in). Reads
// process.env directly (like the email adapter) so this optional feature never
// makes server boot depend on its vars.
//
// Selection order:
//   1. AVI_KMS_MASTER_KEY_ARN set → AWS KMS provider (skeleton until the
//      owner-gated dependency lands; see kms-key-provider.ts).
//   2. genuine production without a KMS ARN → THROW (a raw env master key must
//      never be the production master; managed KMS is required there).
//   3. AVI_MASTER_KEK_B64 set (dev / preview / test) → local provider.
//   4. nothing configured → THROW.

const DEFAULT_REGION = "il-central-1";

// A genuine production deployment (Vercel prod). Preview is treated as non-prod
// so it can QA the feature with a local master key before AWS is provisioned.
function isProductionDeployment(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "preview") return false;
  if (vercelEnv === "production") return true;
  return process.env.NODE_ENV === "production";
}

let cached: KeyProvider | null = null;

export function getKeyProvider(): KeyProvider {
  if (cached) return cached;

  const kmsArn = process.env.AVI_KMS_MASTER_KEY_ARN?.trim();
  if (kmsArn) {
    const region = process.env.AVI_KMS_REGION?.trim() || DEFAULT_REGION;
    cached = makeKmsKeyProvider({ masterKeyArn: kmsArn, region });
    return cached;
  }

  if (isProductionDeployment()) {
    // Do NOT cache — a corrected deployment (KMS ARN added on a fresh instance)
    // must be able to recover.
    throw new KeyConfigError(
      "no managed key provider configured in production — set AVI_KMS_MASTER_KEY_ARN (AWS KMS il-central-1)",
    );
  }

  const localKek = process.env.AVI_MASTER_KEK_B64?.trim();
  if (localKek) {
    cached = makeLocalKeyProvider();
    return cached;
  }

  throw new KeyConfigError(
    "no key provider configured — set AVI_KMS_MASTER_KEY_ARN (production) or AVI_MASTER_KEK_B64 (dev/test)",
  );
}
