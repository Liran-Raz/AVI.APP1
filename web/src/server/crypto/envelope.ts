// Host-agnostic envelope-encryption primitives (AES-256-GCM) built ONLY on
// node:crypto. These run identically in the Next.js/Vercel runtime and in a
// standalone Node service (the future Cloud Run media path), so this module
// MUST NOT import "server-only" — that package throws when imported outside
// Next's server condition, which would break a plain Node process.
//
// Boundary contract:
//   * This module speaks Buffers (raw key material / plaintext / ciphertext).
//   * The DB stores every crypto blob as base64 TEXT; toBase64/fromBase64 are
//     the conversion seam, and callers hand base64 to the persistence layer.
//   * Nothing here reads env, touches the network, logs, or persists. Pure
//     synchronous crypto.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { CryptoAuthError, CryptoFormatError } from "./crypto-errors";

// Label persisted in the `enc_algo` / `algo` columns (human/audit facing).
export const ENC_ALGO = "AES-256-GCM" as const;
const CIPHER = "aes-256-gcm";

export const KEY_BYTES = 32; // AES-256 key / DEK
export const IV_BYTES = 12; // GCM standard nonce
export const TAG_BYTES = 16; // GCM auth tag

// Ciphertext split into the three columns the schema keeps (`*_iv` / body /
// `*_tag`) — used for file bytes, client keys, and wrapped DEKs.
export interface GcmParts {
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

// A wrapped key: the same three parts, named for the wrap use case.
export interface WrappedParts {
  wrapped: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function toBase64(buf: Buffer): string {
  return buf.toString("base64");
}

export function fromBase64(s: string): Buffer {
  return Buffer.from(s, "base64");
}

// Fresh 32-byte random key material — office keys, client keys, per-file DEKs
// are all AES-256.
export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

// Semantic alias: a per-file data-encryption key is just fresh key material.
export function generateDek(): Buffer {
  return randomBytes(KEY_BYTES);
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new CryptoFormatError(`key must be ${KEY_BYTES} bytes`);
  }
}

// AES-256-GCM encrypt. A fresh random IV per call — never reuse an IV with the
// same key (the round-trip + iv-uniqueness tests lock this in).
export function aesGcmEncrypt(key: Buffer, plaintext: Buffer): GcmParts {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, ciphertext, tag };
}

// AES-256-GCM decrypt. Throws CryptoAuthError on ANY authentication failure
// (tampered ciphertext/tag/iv or wrong key) — never returns garbage. The error
// carries no key material or plaintext.
export function aesGcmDecrypt(key: Buffer, parts: GcmParts): Buffer {
  assertKey(key);
  if (parts.iv.length !== IV_BYTES) {
    throw new CryptoFormatError(`iv must be ${IV_BYTES} bytes`);
  }
  if (parts.tag.length !== TAG_BYTES) {
    throw new CryptoFormatError(`tag must be ${TAG_BYTES} bytes`);
  }
  const decipher = createDecipheriv(CIPHER, key, parts.iv);
  decipher.setAuthTag(parts.tag);
  try {
    return Buffer.concat([decipher.update(parts.ciphertext), decipher.final()]);
  } catch {
    // node throws a generic "unable to authenticate data" — normalise it to
    // our typed, leak-safe error (drop the original message).
    throw new CryptoAuthError();
  }
}

// Wrap key material with a wrapping key (an office key wrapping a client key, or
// an owner key wrapping a per-file DEK). Same GCM primitive, semantic name.
export function wrapKey(wrappingKey: Buffer, keyToWrap: Buffer): WrappedParts {
  assertKey(keyToWrap);
  const { iv, ciphertext, tag } = aesGcmEncrypt(wrappingKey, keyToWrap);
  return { wrapped: ciphertext, iv, tag };
}

export function unwrapKey(wrappingKey: Buffer, parts: WrappedParts): Buffer {
  const key = aesGcmDecrypt(wrappingKey, {
    iv: parts.iv,
    ciphertext: parts.wrapped,
    tag: parts.tag,
  });
  assertKey(key); // a GCM open that yields a non-32-byte payload is malformed
  return key;
}

// Opaque single-blob seal: iv(12) || tag(16) || ciphertext. Used by the LOCAL
// office-key provider so a wrapped office key is one opaque base64 value —
// exactly like a KMS ciphertext blob (the encryption_keys schema gives office
// keys no separate iv/tag columns; client keys DO have them and use wrapKey).
export function sealToBlob(key: Buffer, plaintext: Buffer): Buffer {
  const { iv, ciphertext, tag } = aesGcmEncrypt(key, plaintext);
  return Buffer.concat([iv, tag, ciphertext]);
}

export function openBlob(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new CryptoFormatError("sealed blob too short");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  return aesGcmDecrypt(key, { iv, ciphertext, tag });
}
