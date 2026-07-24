import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests the GCP KMS provider against a MOCKED KeyManagementServiceClient — no
// network, no credentials. Covers the wrap/unwrap mapping, both transport
// shapes (bytes vs base64 string), the different-master refusal, leak-safe
// error mapping, and the two credential paths (SA JSON vs ambient ADC).

const { encryptMock, decryptMock, clientCtor } = vi.hoisted(() => ({
  encryptMock: vi.fn(),
  decryptMock: vi.fn(),
  clientCtor: vi.fn(),
}));

vi.mock("@google-cloud/kms", () => ({
  KeyManagementServiceClient: class {
    constructor(opts?: unknown) {
      clientCtor(opts);
    }
    encrypt = encryptMock;
    decrypt = decryptMock;
  },
}));

import { makeGcpKmsKeyProvider } from "./gcp-kms-key-provider";

const KEY_NAME =
  "projects/avi-app/locations/me-west1/keyRings/master/cryptoKeys/kek";

function saKeyB64(overrides: Record<string, unknown> = {}): string {
  const sa = {
    client_email: "kek-signer@avi-app.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
    project_id: "avi-app",
    ...overrides,
  };
  return Buffer.from(JSON.stringify(sa), "utf8").toString("base64");
}

beforeEach(() => {
  encryptMock.mockReset();
  decryptMock.mockReset();
  clientCtor.mockReset();
});

describe("wrapOfficeKey", () => {
  it("returns the KMS ciphertext as base64 with the key resource name", async () => {
    const officeKey = randomBytes(32);
    const ciphertext = randomBytes(48);
    encryptMock.mockResolvedValue([{ ciphertext }]);
    const provider = makeGcpKmsKeyProvider({ keyName: KEY_NAME });

    const wrapped = await provider.wrapOfficeKey(officeKey);

    expect(encryptMock).toHaveBeenCalledWith({
      name: KEY_NAME,
      plaintext: officeKey,
    });
    expect(wrapped.kmsKeyId).toBe(KEY_NAME);
    expect(Buffer.from(wrapped.wrapped, "base64").equals(ciphertext)).toBe(true);
  });

  it("maps an SDK failure to a leak-safe KeyProviderError with the status code", async () => {
    encryptMock.mockRejectedValue(
      Object.assign(new Error("PERMISSION_DENIED: secret internals"), {
        code: 7,
      }),
    );
    const provider = makeGcpKmsKeyProvider({ keyName: KEY_NAME });

    await expect(provider.wrapOfficeKey(randomBytes(32))).rejects.toMatchObject({
      name: "KeyProviderError",
      message: "key provider wrap failed (status 7)",
    });
  });

  it("throws KeyProviderError when KMS returns no ciphertext", async () => {
    encryptMock.mockResolvedValue([{ ciphertext: null }]);
    const provider = makeGcpKmsKeyProvider({ keyName: KEY_NAME });

    await expect(provider.wrapOfficeKey(randomBytes(32))).rejects.toMatchObject({
      name: "KeyProviderError",
    });
  });
});

describe("unwrapOfficeKey", () => {
  it("decrypts the stored blob back to the office key (bytes transport)", async () => {
    const officeKey = randomBytes(32);
    const ciphertext = randomBytes(48);
    decryptMock.mockResolvedValue([{ plaintext: officeKey }]);
    const provider = makeGcpKmsKeyProvider({ keyName: KEY_NAME });

    const recovered = await provider.unwrapOfficeKey({
      wrapped: ciphertext.toString("base64"),
      kmsKeyId: KEY_NAME,
    });

    expect(decryptMock).toHaveBeenCalledWith({
      name: KEY_NAME,
      ciphertext,
    });
    expect(recovered.equals(officeKey)).toBe(true);
  });

  it("normalizes a base64-string plaintext (REST transport)", async () => {
    const officeKey = randomBytes(32);
    decryptMock.mockResolvedValue([{ plaintext: officeKey.toString("base64") }]);
    const provider = makeGcpKmsKeyProvider({ keyName: KEY_NAME });

    const recovered = await provider.unwrapOfficeKey({
      wrapped: randomBytes(48).toString("base64"),
      kmsKeyId: KEY_NAME,
    });

    expect(recovered.equals(officeKey)).toBe(true);
  });

  it("refuses a key wrapped by a different master WITHOUT calling KMS", async () => {
    const provider = makeGcpKmsKeyProvider({ keyName: KEY_NAME });

    await expect(
      provider.unwrapOfficeKey({
        wrapped: randomBytes(48).toString("base64"),
        kmsKeyId: "local",
      }),
    ).rejects.toMatchObject({ name: "KeyProviderError" });
    expect(decryptMock).not.toHaveBeenCalled();
  });

  it("maps an SDK failure to a leak-safe KeyProviderError (no raw message)", async () => {
    decryptMock.mockRejectedValue(
      Object.assign(new Error("INVALID_ARGUMENT: internals"), { code: 3 }),
    );
    const provider = makeGcpKmsKeyProvider({ keyName: KEY_NAME });

    const err = await provider
      .unwrapOfficeKey({
        wrapped: randomBytes(48).toString("base64"),
        kmsKeyId: KEY_NAME,
      })
      .then(
        () => null,
        (e: Error) => e,
      );

    expect(err?.name).toBe("KeyProviderError");
    expect(err?.message).toBe("key provider unwrap failed (status 3)");
    expect(err?.message).not.toContain("internals");
  });

  it("throws KeyProviderError when KMS returns no plaintext", async () => {
    decryptMock.mockResolvedValue([{ plaintext: null }]);
    const provider = makeGcpKmsKeyProvider({ keyName: KEY_NAME });

    await expect(
      provider.unwrapOfficeKey({
        wrapped: randomBytes(48).toString("base64"),
        kmsKeyId: KEY_NAME,
      }),
    ).rejects.toMatchObject({ name: "KeyProviderError" });
  });
});

describe("credentials", () => {
  it("passes the parsed service-account credentials to the client (Vercel path)", () => {
    makeGcpKmsKeyProvider({ keyName: KEY_NAME, saKeyB64: saKeyB64() });

    expect(clientCtor).toHaveBeenCalledWith({
      credentials: {
        client_email: "kek-signer@avi-app.iam.gserviceaccount.com",
        private_key:
          "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
      },
      projectId: "avi-app",
    });
  });

  it("constructs the client without options when no SA key is given (ADC path)", () => {
    makeGcpKmsKeyProvider({ keyName: KEY_NAME });

    expect(clientCtor).toHaveBeenCalledWith(undefined);
  });

  it("throws KeyConfigError on non-JSON AVI_GCP_SA_KEY_B64", () => {
    expect(() =>
      makeGcpKmsKeyProvider({
        keyName: KEY_NAME,
        saKeyB64: Buffer.from("oops").toString("base64"),
      }),
    ).toThrowError(expect.objectContaining({ name: "KeyConfigError" }));
  });

  it("throws KeyConfigError when the SA JSON lacks client_email/private_key", () => {
    expect(() =>
      makeGcpKmsKeyProvider({
        keyName: KEY_NAME,
        saKeyB64: saKeyB64({ private_key: undefined }),
      }),
    ).toThrowError(expect.objectContaining({ name: "KeyConfigError" }));
  });

  it("exposes the provider name", () => {
    expect(makeGcpKmsKeyProvider({ keyName: KEY_NAME }).name).toBe("gcp-kms");
  });
});
