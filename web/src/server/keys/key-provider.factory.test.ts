import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Tests the provider SELECTION logic + the local provider round-trip across
// environments. getKeyProvider() caches, so each scenario resets the module
// registry and re-imports with the desired env (same approach as email.test).

const ENV_KEYS = [
  "AVI_GCP_KMS_KEY_NAME",
  "AVI_GCP_SA_KEY_B64",
  "AVI_MASTER_KEK_B64",
  "NODE_ENV",
  "VERCEL_ENV",
] as const;

const PROD = "production";
const DEV = "development";
const VALID_KEK = randomBytes(32).toString("base64");
const GCP_KEY_NAME =
  "projects/avi-app/locations/me-west1/keyRings/master/cryptoKeys/kek";

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function loadFactory(env: {
  AVI_GCP_KMS_KEY_NAME?: string;
  AVI_GCP_SA_KEY_B64?: string;
  AVI_MASTER_KEK_B64?: string;
  NODE_ENV: string;
  VERCEL_ENV?: string;
}) {
  setEnv("AVI_GCP_KMS_KEY_NAME", env.AVI_GCP_KMS_KEY_NAME);
  setEnv("AVI_GCP_SA_KEY_B64", env.AVI_GCP_SA_KEY_B64);
  setEnv("AVI_MASTER_KEK_B64", env.AVI_MASTER_KEK_B64);
  setEnv("NODE_ENV", env.NODE_ENV);
  setEnv("VERCEL_ENV", env.VERCEL_ENV);
  const { vi } = await import("vitest");
  vi.resetModules();
  return import("./key-provider.factory");
}

async function captureError(fn: () => unknown): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("Expected the call to throw, but it did not");
}

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) setEnv(k, saved[k]);
});

describe("local provider (dev/test)", () => {
  it("selects the local provider when AVI_MASTER_KEK_B64 is set", async () => {
    const { getKeyProvider } = await loadFactory({
      AVI_MASTER_KEK_B64: VALID_KEK,
      NODE_ENV: DEV,
    });
    expect(getKeyProvider().name).toBe("local");
  });

  it("round-trips an office key through the selected local provider", async () => {
    const { getKeyProvider } = await loadFactory({
      AVI_MASTER_KEK_B64: VALID_KEK,
      NODE_ENV: DEV,
    });
    const provider = getKeyProvider();
    const officeKey = randomBytes(32);
    const wrapped = await provider.wrapOfficeKey(officeKey);
    expect(wrapped.kmsKeyId).toBe("local");
    const recovered = await provider.unwrapOfficeKey(wrapped);
    expect(recovered.equals(officeKey)).toBe(true);
  });

  it("caches — repeated calls return the same instance", async () => {
    const { getKeyProvider } = await loadFactory({
      AVI_MASTER_KEK_B64: VALID_KEK,
      NODE_ENV: DEV,
    });
    expect(getKeyProvider()).toBe(getKeyProvider());
  });

  it("throws KeyConfigError on an invalid (wrong-length) master key", async () => {
    const { getKeyProvider } = await loadFactory({
      AVI_MASTER_KEK_B64: randomBytes(16).toString("base64"),
      NODE_ENV: DEV,
    });
    const err = await captureError(() => getKeyProvider());
    expect(err.name).toBe("KeyConfigError");
  });
});

describe("GCP KMS provider", () => {
  it("selects the GCP KMS provider when AVI_GCP_KMS_KEY_NAME is set", async () => {
    const { getKeyProvider } = await loadFactory({
      AVI_GCP_KMS_KEY_NAME: GCP_KEY_NAME,
      NODE_ENV: PROD,
    });
    expect(getKeyProvider().name).toBe("gcp-kms");
  });

  it("takes precedence over a local key when both are set", async () => {
    const { getKeyProvider } = await loadFactory({
      AVI_GCP_KMS_KEY_NAME: GCP_KEY_NAME,
      AVI_MASTER_KEK_B64: VALID_KEK,
      NODE_ENV: DEV,
    });
    expect(getKeyProvider().name).toBe("gcp-kms");
  });

  it("throws KeyConfigError at selection on a malformed AVI_GCP_SA_KEY_B64", async () => {
    const { getKeyProvider } = await loadFactory({
      AVI_GCP_KMS_KEY_NAME: GCP_KEY_NAME,
      AVI_GCP_SA_KEY_B64: Buffer.from("not json at all").toString("base64"),
      NODE_ENV: PROD,
    });
    const err = await captureError(() => getKeyProvider());
    expect(err.name).toBe("KeyConfigError");
  });
});

describe("fail-loud selection (no safe no-op for encryption)", () => {
  it("throws in genuine production when no KMS key name is configured", async () => {
    const { getKeyProvider } = await loadFactory({
      AVI_MASTER_KEK_B64: VALID_KEK, // present, but must NOT be used in prod
      NODE_ENV: PROD,
    });
    const err = await captureError(() => getKeyProvider());
    expect(err.name).toBe("KeyConfigError");
  });

  it("allows the local provider on a Vercel PREVIEW deployment (QA before KMS)", async () => {
    const { getKeyProvider } = await loadFactory({
      AVI_MASTER_KEK_B64: VALID_KEK,
      NODE_ENV: PROD,
      VERCEL_ENV: "preview",
    });
    expect(getKeyProvider().name).toBe("local");
  });

  it("throws when nothing is configured (dev)", async () => {
    const { getKeyProvider } = await loadFactory({ NODE_ENV: DEV });
    const err = await captureError(() => getKeyProvider());
    expect(err.name).toBe("KeyConfigError");
  });
});
