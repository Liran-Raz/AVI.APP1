import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CryptoAuthError, CryptoFormatError } from "./crypto-errors";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  ENC_ALGO,
  fromBase64,
  generateDek,
  generateKey,
  IV_BYTES,
  KEY_BYTES,
  openBlob,
  sealToBlob,
  TAG_BYTES,
  toBase64,
  unwrapKey,
  wrapKey,
} from "./envelope";

// REAL crypto — no mocks. Proves the primitives round-trip, reject tamper/wrong
// key, never reuse an IV, and compose into the full office→client→DEK→file
// envelope chain the feature relies on.

describe("aesGcmEncrypt / aesGcmDecrypt", () => {
  it.each([0, 1, 15, 16, 1024, 1024 * 1024])(
    "round-trips a %d-byte plaintext",
    (size) => {
      const key = generateKey();
      const plaintext = randomBytes(size);
      const parts = aesGcmEncrypt(key, plaintext);
      expect(parts.iv).toHaveLength(IV_BYTES);
      expect(parts.tag).toHaveLength(TAG_BYTES);
      const recovered = aesGcmDecrypt(key, parts);
      expect(recovered.equals(plaintext)).toBe(true);
    },
  );

  it("throws CryptoAuthError when the ciphertext is tampered", () => {
    const key = generateKey();
    const parts = aesGcmEncrypt(key, randomBytes(64));
    parts.ciphertext[0] ^= 0xff;
    expect(() => aesGcmDecrypt(key, parts)).toThrow(CryptoAuthError);
  });

  it("throws CryptoAuthError when the tag is tampered", () => {
    const key = generateKey();
    const parts = aesGcmEncrypt(key, randomBytes(64));
    parts.tag[0] ^= 0xff;
    expect(() => aesGcmDecrypt(key, parts)).toThrow(CryptoAuthError);
  });

  it("throws CryptoAuthError when the iv is tampered", () => {
    const key = generateKey();
    const parts = aesGcmEncrypt(key, randomBytes(64));
    parts.iv[0] ^= 0xff;
    expect(() => aesGcmDecrypt(key, parts)).toThrow(CryptoAuthError);
  });

  it("throws CryptoAuthError under the WRONG key (no plaintext leak)", () => {
    const parts = aesGcmEncrypt(generateKey(), randomBytes(64));
    expect(() => aesGcmDecrypt(generateKey(), parts)).toThrow(CryptoAuthError);
  });

  it("rejects a wrong-length key with CryptoFormatError", () => {
    expect(() => aesGcmEncrypt(randomBytes(16), randomBytes(8))).toThrow(
      CryptoFormatError,
    );
  });

  it("rejects a wrong-length iv/tag on decrypt with CryptoFormatError", () => {
    const key = generateKey();
    const parts = aesGcmEncrypt(key, randomBytes(8));
    expect(() =>
      aesGcmDecrypt(key, { ...parts, iv: randomBytes(8) }),
    ).toThrow(CryptoFormatError);
    expect(() =>
      aesGcmDecrypt(key, { ...parts, tag: randomBytes(8) }),
    ).toThrow(CryptoFormatError);
  });
});

describe("IV uniqueness", () => {
  it("never reuses an IV across many encryptions with the same key", () => {
    const key = generateKey();
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const { iv } = aesGcmEncrypt(key, randomBytes(4));
      seen.add(iv.toString("hex"));
    }
    expect(seen.size).toBe(2000);
  });
});

describe("wrapKey / unwrapKey", () => {
  it("round-trips 32-byte key material", () => {
    const wrappingKey = generateKey();
    const inner = generateKey();
    const wrapped = unwrapKey(wrappingKey, wrapKey(wrappingKey, inner));
    expect(wrapped.equals(inner)).toBe(true);
  });

  it("fails under the wrong wrapping key", () => {
    const wrapped = wrapKey(generateKey(), generateKey());
    expect(() => unwrapKey(generateKey(), wrapped)).toThrow(CryptoAuthError);
  });
});

describe("sealToBlob / openBlob (opaque office-key blob)", () => {
  it("round-trips through one opaque blob", () => {
    const kek = generateKey();
    const officeKey = generateKey();
    const blob = sealToBlob(kek, officeKey);
    // opaque: iv(12) || tag(16) || ciphertext(32)
    expect(blob.length).toBe(IV_BYTES + TAG_BYTES + KEY_BYTES);
    expect(openBlob(kek, blob).equals(officeKey)).toBe(true);
  });

  it("survives a base64 storage round-trip", () => {
    const kek = generateKey();
    const officeKey = generateKey();
    const stored = toBase64(sealToBlob(kek, officeKey));
    expect(openBlob(kek, fromBase64(stored)).equals(officeKey)).toBe(true);
  });

  it("throws CryptoAuthError when the blob is tampered", () => {
    const kek = generateKey();
    const blob = sealToBlob(kek, generateKey());
    blob[blob.length - 1] ^= 0xff;
    expect(() => openBlob(kek, blob)).toThrow(CryptoAuthError);
  });

  it("throws CryptoFormatError on a truncated blob", () => {
    expect(() => openBlob(generateKey(), randomBytes(10))).toThrow(
      CryptoFormatError,
    );
  });
});

describe("full envelope chain: office -> client -> DEK -> file", () => {
  it("recovers the file after unwrapping the whole chain", () => {
    const officeKey = generateKey();
    const clientKey = generateKey();
    const dek = generateDek();
    const file = randomBytes(4096);

    // Seal downward.
    const wrappedClient = wrapKey(officeKey, clientKey); // client wrapped by office
    const wrappedDek = wrapKey(clientKey, dek); // dek wrapped by client (owner)
    const encFile = aesGcmEncrypt(dek, file); // file encrypted by dek

    // Open upward from the stored blobs.
    const clientAgain = unwrapKey(officeKey, wrappedClient);
    const dekAgain = unwrapKey(clientAgain, wrappedDek);
    const fileAgain = aesGcmDecrypt(dekAgain, encFile);

    expect(fileAgain.equals(file)).toBe(true);
  });

  it("a shredded client key (wrong key) makes its files undecryptable", () => {
    const officeKey = generateKey();
    const clientKey = generateKey();
    const dek = generateDek();
    const wrappedDek = wrapKey(clientKey, dek);
    // After crypto-shred the client key is gone; a different key cannot unwrap.
    expect(() => unwrapKey(generateKey(), wrappedDek)).toThrow(CryptoAuthError);
    // Sanity: office key (which wrapped the client key, not the dek) also can't.
    expect(() => unwrapKey(officeKey, wrappedDek)).toThrow(CryptoAuthError);
  });
});

describe("constants", () => {
  it("exposes the AES-256-GCM label used in the DB algo columns", () => {
    expect(ENC_ALGO).toBe("AES-256-GCM");
    expect(KEY_BYTES).toBe(32);
  });
});
