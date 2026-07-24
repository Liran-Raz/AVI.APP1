import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { KeyHierarchy } from "./key-hierarchy";
import { makeLocalKeyProvider } from "./local-key-provider";
import type { KeyProvider } from "./key-provider";
import {
  KeyRaceError,
  type ClientKeyRecord,
  type InsertClientKeyInput,
  type InsertOfficeKeyInput,
  type KeyStore,
  type OfficeKeyRecord,
} from "./key-store";

// In-memory KeyStore double + the REAL local provider (real crypto). Proves the
// hierarchy creates-then-caches, re-reads + unwraps the full chain across fresh
// instances, wraps/unwraps DEKs, recovers from an insert race, and zeroizes on
// dispose — all without Supabase or a cloud KMS.

class FakeKeyStore implements KeyStore {
  officeByOrg = new Map<string, OfficeKeyRecord>();
  clientByKey = new Map<string, ClientKeyRecord>();
  calls = { getOffice: 0, insertOffice: 0, getClient: 0, insertClient: 0 };

  private seq = 0;
  private officeRaceWinner: OfficeKeyRecord | null = null;
  private officeInsertAttempted = false;

  // Arm the office-insert race: getActive returns null until an insert is
  // attempted (which loses with KeyRaceError), then returns the winner.
  armOfficeRace(winner: OfficeKeyRecord): void {
    this.officeRaceWinner = winner;
    this.officeInsertAttempted = false;
  }

  async getActiveOfficeKey(orgId: string): Promise<OfficeKeyRecord | null> {
    this.calls.getOffice++;
    if (this.officeRaceWinner) {
      return this.officeInsertAttempted ? this.officeRaceWinner : null;
    }
    return this.officeByOrg.get(orgId) ?? null;
  }

  async insertOfficeKey(input: InsertOfficeKeyInput): Promise<{ id: string }> {
    this.calls.insertOffice++;
    if (this.officeRaceWinner) {
      this.officeInsertAttempted = true;
      throw new KeyRaceError();
    }
    if (this.officeByOrg.has(input.orgId)) throw new KeyRaceError();
    const id = `office-${++this.seq}`;
    this.officeByOrg.set(input.orgId, {
      id,
      wrappedKey: input.wrappedKey,
      kmsKeyId: input.kmsKeyId,
      algo: input.algo,
      keyVersion: 1,
    });
    return { id };
  }

  async getActiveClientKey(
    orgId: string,
    clientId: string,
  ): Promise<ClientKeyRecord | null> {
    this.calls.getClient++;
    return this.clientByKey.get(`${orgId}:${clientId}`) ?? null;
  }

  async insertClientKey(input: InsertClientKeyInput): Promise<{ id: string }> {
    this.calls.insertClient++;
    const k = `${input.orgId}:${input.clientId}`;
    if (this.clientByKey.has(k)) throw new KeyRaceError();
    const id = `client-${++this.seq}`;
    this.clientByKey.set(k, {
      id,
      wrappedKey: input.wrappedKey,
      wrapIv: input.wrapIv,
      wrapTag: input.wrapTag,
      wrappedByKeyId: input.wrappedByKeyId,
      algo: input.algo,
      keyVersion: 1,
    });
    return { id };
  }
}

const KEK_B64 = randomBytes(32).toString("base64");
let provider: KeyProvider;
let store: FakeKeyStore;

beforeAll(() => {
  process.env.AVI_MASTER_KEK_B64 = KEK_B64;
  provider = makeLocalKeyProvider();
});
afterAll(() => {
  delete process.env.AVI_MASTER_KEK_B64;
});
beforeEach(() => {
  store = new FakeKeyStore();
});

describe("office keys", () => {
  it("creates once, then serves from the per-request cache", async () => {
    const kh = new KeyHierarchy(provider, store);
    const first = await kh.getOrCreateOfficeKey("org1");
    const second = await kh.getOrCreateOfficeKey("org1");
    expect(second).toBe(first); // same cached object
    expect(first.plaintext).toHaveLength(32);
    expect(store.calls.insertOffice).toBe(1);
    expect(store.calls.getOffice).toBe(1); // second call never hit the store
  });

  it("a fresh hierarchy re-reads + unwraps to the SAME plaintext", async () => {
    const a = new KeyHierarchy(provider, store);
    const created = await a.getOrCreateOfficeKey("org1");
    const value = Buffer.from(created.plaintext);

    const b = new KeyHierarchy(provider, store);
    const reread = await b.getOrCreateOfficeKey("org1");
    expect(reread.plaintext.equals(value)).toBe(true);
    expect(store.calls.insertOffice).toBe(1); // only the first created
  });

  it("recovers from an insert race (loses, re-reads the winner)", async () => {
    const winnerPlain = randomBytes(32);
    const wrapped = await provider.wrapOfficeKey(winnerPlain);
    store.armOfficeRace({
      id: "winner",
      wrappedKey: wrapped.wrapped,
      kmsKeyId: wrapped.kmsKeyId,
      algo: "AES-256-GCM",
      keyVersion: 1,
    });

    const kh = new KeyHierarchy(provider, store);
    const resolved = await kh.getOrCreateOfficeKey("orgR");
    expect(resolved.id).toBe("winner");
    expect(resolved.plaintext.equals(winnerPlain)).toBe(true);
    expect(store.calls.insertOffice).toBe(1); // attempted once, lost
  });
});

describe("client keys", () => {
  it("mints a client key wrapped by the office key, and re-reads it", async () => {
    const a = new KeyHierarchy(provider, store);
    const office = await a.getOrCreateOfficeKey("org1");
    const client = await a.getOrCreateClientKey("org1", "clientX");
    const value = Buffer.from(client.plaintext);

    const rec = store.clientByKey.get("org1:clientX");
    expect(rec?.wrappedByKeyId).toBe(office.id);

    const b = new KeyHierarchy(provider, store);
    const reread = await b.getOrCreateClientKey("org1", "clientX");
    expect(reread.plaintext.equals(value)).toBe(true);
    expect(store.calls.insertClient).toBe(1);
  });

  it("resolveOwnerKey routes client vs office", async () => {
    const kh = new KeyHierarchy(provider, store);
    const office = await kh.getOrCreateOfficeKey("org1");
    const asOffice = await kh.resolveOwnerKey("org1", { kind: "office" });
    expect(asOffice.id).toBe(office.id);
    const asClient = await kh.resolveOwnerKey("org1", {
      kind: "client",
      clientId: "clientX",
    });
    expect(asClient.id).not.toBe(office.id);
    expect(asClient.plaintext).toHaveLength(32);
  });
});

describe("DEK wrap/unwrap", () => {
  it("round-trips a per-file DEK under the owner key", async () => {
    const kh = new KeyHierarchy(provider, store);
    const owner = await kh.getOrCreateOfficeKey("org1");
    const dek = randomBytes(32);
    const wrapped = kh.wrapDek(owner.plaintext, dek);
    expect(kh.unwrapDek(owner.plaintext, wrapped).equals(dek)).toBe(true);
  });
});

describe("dispose", () => {
  it("zeroizes cached plaintext and clears the caches", async () => {
    const kh = new KeyHierarchy(provider, store);
    const office = await kh.getOrCreateOfficeKey("org1");
    const ref = office.plaintext;
    expect(ref.some((b) => b !== 0)).toBe(true);

    kh.dispose();
    expect(ref.every((b) => b === 0)).toBe(true); // wiped in place

    // cache cleared → the next resolve hits the store again
    const before = store.calls.getOffice;
    await kh.getOrCreateOfficeKey("org1");
    expect(store.calls.getOffice).toBe(before + 1);
  });
});
