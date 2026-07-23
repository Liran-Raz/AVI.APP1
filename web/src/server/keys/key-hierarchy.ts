import {
  ENC_ALGO,
  fromBase64,
  generateKey,
  toBase64,
  unwrapKey,
  wrapKey,
} from "../crypto/envelope";
import { zeroize } from "../crypto/zeroize";
import type { KeyProvider } from "./key-provider";
import { KeyRaceError, type KeyStore } from "./key-store";

// The key hierarchy resolves plaintext office/client keys on demand and wraps/
// unwraps per-file DEKs. It is host-agnostic (depends only on KeyProvider +
// KeyStore) and holds plaintext key material in a PER-REQUEST cache only:
// construct one per request and dispose() it in a finally so keys are zeroized
// promptly. NEVER share an instance across requests — that would be a
// module-level plaintext cache, which is explicitly disallowed.
//
// Chain: master KEK (provider) -> office key -> client key -> per-file DEK.
// An office key is unwrapped via the provider (KMS/local) at most once per
// request; a client key is unwrapped from its office key; a DEK is wrapped by
// the owner (office|client) key.

export interface ResolvedKey {
  id: string;
  plaintext: Buffer;
}

// A wrapped DEK as it lands on the attachments row (base64 columns).
export interface WrappedDek {
  wrapped: string;
  iv: string;
  tag: string;
}

export type AttachmentOwner =
  | { kind: "client"; clientId: string }
  | { kind: "office" };

export class KeyHierarchy {
  private readonly officeCache = new Map<string, ResolvedKey>();
  private readonly clientCache = new Map<string, ResolvedKey>();

  constructor(
    private readonly provider: KeyProvider,
    private readonly store: KeyStore,
  ) {}

  async getOrCreateOfficeKey(orgId: string): Promise<ResolvedKey> {
    const cached = this.officeCache.get(orgId);
    if (cached) return cached;

    const existing = await this.store.getActiveOfficeKey(orgId);
    if (existing) return this.cacheOffice(orgId, existing.id, await this.unwrapOffice(existing));

    const plaintext = generateKey();
    const wrapped = await this.provider.wrapOfficeKey(plaintext);
    try {
      const { id } = await this.store.insertOfficeKey({
        orgId,
        wrappedKey: wrapped.wrapped,
        kmsKeyId: wrapped.kmsKeyId,
        algo: ENC_ALGO,
      });
      return this.cacheOffice(orgId, id, plaintext);
    } catch (err) {
      zeroize(plaintext); // our key is unused whether we lost the race or failed
      if (err instanceof KeyRaceError) {
        const winner = await this.store.getActiveOfficeKey(orgId);
        if (!winner) throw err;
        return this.cacheOffice(orgId, winner.id, await this.unwrapOffice(winner));
      }
      throw err;
    }
  }

  async getOrCreateClientKey(orgId: string, clientId: string): Promise<ResolvedKey> {
    const cacheKey = `${orgId}:${clientId}`;
    const cached = this.clientCache.get(cacheKey);
    if (cached) return cached;

    const office = await this.getOrCreateOfficeKey(orgId);

    const existing = await this.store.getActiveClientKey(orgId, clientId);
    if (existing) {
      return this.cacheClient(cacheKey, existing.id, this.unwrapClient(office.plaintext, existing));
    }

    const plaintext = generateKey();
    const w = wrapKey(office.plaintext, plaintext);
    try {
      const { id } = await this.store.insertClientKey({
        orgId,
        clientId,
        wrappedKey: toBase64(w.wrapped),
        wrapIv: toBase64(w.iv),
        wrapTag: toBase64(w.tag),
        wrappedByKeyId: office.id,
        algo: ENC_ALGO,
      });
      return this.cacheClient(cacheKey, id, plaintext);
    } catch (err) {
      zeroize(plaintext);
      if (err instanceof KeyRaceError) {
        const winner = await this.store.getActiveClientKey(orgId, clientId);
        if (!winner) throw err;
        return this.cacheClient(cacheKey, winner.id, this.unwrapClient(office.plaintext, winner));
      }
      throw err;
    }
  }

  // Resolve the OWNER key for an attachment: a client file → that client's key,
  // an office file → the office key. (create_attachment enforces the same
  // owner↔key coherence in the DB; this just picks the right one.)
  async resolveOwnerKey(orgId: string, owner: AttachmentOwner): Promise<ResolvedKey> {
    return owner.kind === "client"
      ? this.getOrCreateClientKey(orgId, owner.clientId)
      : this.getOrCreateOfficeKey(orgId);
  }

  wrapDek(ownerKeyPlaintext: Buffer, dek: Buffer): WrappedDek {
    const w = wrapKey(ownerKeyPlaintext, dek);
    return { wrapped: toBase64(w.wrapped), iv: toBase64(w.iv), tag: toBase64(w.tag) };
  }

  unwrapDek(ownerKeyPlaintext: Buffer, wrapped: WrappedDek): Buffer {
    return unwrapKey(ownerKeyPlaintext, {
      wrapped: fromBase64(wrapped.wrapped),
      iv: fromBase64(wrapped.iv),
      tag: fromBase64(wrapped.tag),
    });
  }

  // Zeroize every cached plaintext key and drop the caches. Call in a finally
  // once the request's crypto work is done.
  dispose(): void {
    for (const { plaintext } of this.officeCache.values()) zeroize(plaintext);
    for (const { plaintext } of this.clientCache.values()) zeroize(plaintext);
    this.officeCache.clear();
    this.clientCache.clear();
  }

  private unwrapOffice(rec: {
    wrappedKey: string;
    kmsKeyId: string | null;
  }): Promise<Buffer> {
    return this.provider.unwrapOfficeKey({
      wrapped: rec.wrappedKey,
      kmsKeyId: rec.kmsKeyId,
    });
  }

  private unwrapClient(
    officePlaintext: Buffer,
    rec: { wrappedKey: string; wrapIv: string; wrapTag: string },
  ): Buffer {
    return unwrapKey(officePlaintext, {
      wrapped: fromBase64(rec.wrappedKey),
      iv: fromBase64(rec.wrapIv),
      tag: fromBase64(rec.wrapTag),
    });
  }

  private cacheOffice(orgId: string, id: string, plaintext: Buffer): ResolvedKey {
    const resolved = { id, plaintext };
    this.officeCache.set(orgId, resolved);
    return resolved;
  }

  private cacheClient(cacheKey: string, id: string, plaintext: Buffer): ResolvedKey {
    const resolved = { id, plaintext };
    this.clientCache.set(cacheKey, resolved);
    return resolved;
  }
}
