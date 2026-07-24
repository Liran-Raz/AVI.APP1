import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

// DEV-032 B2 (unified path) INTEROP GUARD.
//
// The unified attachments path encrypts file bytes in the BROWSER (Web Crypto
// `crypto.subtle`) and must let the SERVER decrypt the same bytes with
// node:crypto (for recovery, server jobs, and the download fallback) — and vice
// versa. This test certifies that contract on every commit: identical AES-256-GCM
// ciphertext across the two implementations, both decrypt directions, AAD
// binding (attachment-id → anti object-swap), and authentication failures.
//
// The ONLY layout difference: node:crypto exposes the 16-byte GCM tag separately
// (getAuthTag), while Web Crypto appends it to the ciphertext. The two adapters
// below (concat on encrypt / split-last-16 on decrypt) are the entire bridge —
// if this test is green, the browser file-crypto and the server envelope are
// interoperable and the design is sound.

const subtle = globalThis.crypto.subtle;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CIPHER = "aes-256-gcm";

// --- server side (mirrors envelope.ts, with the AAD the file path will bind) ---
function nodeEncrypt(key: Buffer, iv: Buffer, plaintext: Buffer, aad?: Buffer) {
  const c = createCipheriv(CIPHER, key, iv);
  if (aad) c.setAAD(aad);
  const ciphertext = Buffer.concat([c.update(plaintext), c.final()]);
  return { ciphertext, tag: c.getAuthTag() };
}
function nodeDecrypt(
  key: Buffer,
  iv: Buffer,
  ciphertext: Buffer,
  tag: Buffer,
  aad?: Buffer,
): Buffer {
  const d = createDecipheriv(CIPHER, key, iv);
  if (aad) d.setAAD(aad);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ciphertext), d.final()]);
}

// --- browser side (what the client will run) ---
// Web Crypto wants a BufferSource backed by a plain ArrayBuffer; copying into a
// freshly-allocated Uint8Array gives the exact `Uint8Array<ArrayBuffer>` type
// (a Node Buffer is `Uint8Array<ArrayBufferLike>`, which TS rejects). The real
// browser module reads from File/ArrayBuffer, so it never holds a Node Buffer.
function view(b: Buffer) {
  const out = new Uint8Array(b.byteLength);
  out.set(b);
  return out;
}

async function importKey(raw: Buffer): Promise<CryptoKey> {
  return subtle.importKey("raw", view(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
async function webEncrypt(
  raw: Buffer,
  iv: Buffer,
  plaintext: Buffer,
  aad?: Buffer,
): Promise<Buffer> {
  const key = await importKey(raw);
  const params: AesGcmParams = { name: "AES-GCM", iv: view(iv), tagLength: 128 };
  if (aad) params.additionalData = view(aad);
  return Buffer.from(await subtle.encrypt(params, key, view(plaintext))); // ct || tag
}
async function webDecrypt(
  raw: Buffer,
  iv: Buffer,
  ctPlusTag: Buffer,
  aad?: Buffer,
): Promise<Buffer> {
  const key = await importKey(raw);
  const params: AesGcmParams = { name: "AES-GCM", iv: view(iv), tagLength: 128 };
  if (aad) params.additionalData = view(aad);
  return Buffer.from(await subtle.decrypt(params, key, view(ctPlusTag)));
}

// --- the entire interop bridge ---
const nodeToWeb = (p: { ciphertext: Buffer; tag: Buffer }) =>
  Buffer.concat([p.ciphertext, p.tag]);
function webToNode(ctPlusTag: Buffer) {
  return {
    ciphertext: ctPlusTag.subarray(0, ctPlusTag.length - TAG_BYTES),
    tag: ctPlusTag.subarray(ctPlusTag.length - TAG_BYTES),
  };
}

const KEY = randomBytes(32);
const IV = randomBytes(IV_BYTES);
const AAD = Buffer.from("attachment:11111111-2222-3333-4444-555555555555");
const SIZES = [0, 1, 15, 16, 17, 1024, 1024 * 1024, 25 * 1024 * 1024];

describe("Node <-> WebCrypto AES-256-GCM parity (B2 unified file path)", () => {
  for (const n of SIZES) {
    const label = n >= 1024 * 1024 ? `${n / (1024 * 1024)}MiB` : `${n}B`;

    it(`node-encrypt -> web-decrypt, ${label}`, async () => {
      const pt = randomBytes(n);
      const enc = nodeEncrypt(KEY, IV, pt);
      expect(Buffer.compare(await webDecrypt(KEY, IV, nodeToWeb(enc)), pt)).toBe(0);
    });

    it(`web-encrypt -> node-decrypt, ${label}`, async () => {
      const pt = randomBytes(n);
      const { ciphertext, tag } = webToNode(await webEncrypt(KEY, IV, pt));
      expect(Buffer.compare(nodeDecrypt(KEY, IV, ciphertext, tag), pt)).toBe(0);
    });

    it(`byte-identical ciphertext, ${label}`, async () => {
      const pt = randomBytes(n);
      const enc = nodeEncrypt(KEY, IV, pt);
      const web = await webEncrypt(KEY, IV, pt);
      expect(Buffer.compare(nodeToWeb(enc), web)).toBe(0);
    });

    it(`AAD round-trips both directions, ${label}`, async () => {
      const pt = randomBytes(n);
      const nWeb = await webDecrypt(KEY, IV, nodeToWeb(nodeEncrypt(KEY, IV, pt, AAD)), AAD);
      expect(Buffer.compare(nWeb, pt)).toBe(0);
      const { ciphertext, tag } = webToNode(await webEncrypt(KEY, IV, pt, AAD));
      expect(Buffer.compare(nodeDecrypt(KEY, IV, ciphertext, tag, AAD), pt)).toBe(0);
    });
  }

  it("wrong AAD fails to authenticate (anti object-swap)", async () => {
    const enc = nodeEncrypt(KEY, IV, randomBytes(4096), AAD);
    const wrong = Buffer.from("attachment:99999999-9999-9999-9999-999999999999");
    await expect(webDecrypt(KEY, IV, nodeToWeb(enc), wrong)).rejects.toThrow();
  });

  it("tampered ciphertext fails to authenticate", async () => {
    const web = await webEncrypt(KEY, IV, randomBytes(4096), AAD);
    web[0] ^= 0xff;
    const { ciphertext, tag } = webToNode(web);
    expect(() => nodeDecrypt(KEY, IV, ciphertext, tag, AAD)).toThrow();
  });
});
