import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";
import {
  ForbiddenError,
  NotFoundError,
  UnsupportedMediaTypeError,
} from "@/server/errors/app-error";

// Shared in-memory state for the mocked repositories. vi.hoisted runs before
// the vi.mock factories + the module imports, so all three see the same maps.
const h = vi.hoisted(() => {
  const objects = new Map<string, Buffer>();
  const rows = new Map<string, Record<string, unknown>>();
  const officeKeys = new Map<string, Record<string, unknown>>();
  const clientKeys = new Map<string, Record<string, unknown>>();
  const tasks = new Map<string, Record<string, unknown>>();
  const clients = new Map<string, Record<string, unknown>>();
  let seq = 0;
  return {
    objects,
    rows,
    officeKeys,
    clientKeys,
    tasks,
    clients,
    nextId: () => `id-${++seq}`,
    reset() {
      objects.clear();
      rows.clear();
      officeKeys.clear();
      clientKeys.clear();
      tasks.clear();
      clients.clear();
      seq = 0;
    },
  };
});

vi.mock("@/server/repositories/attachments.repository", () => ({
  ATTACHMENTS_BUCKET: "attachments",
  uploadObject: async (key: string, bytes: Buffer) => {
    h.objects.set(key, Buffer.from(bytes));
  },
  downloadObject: async (key: string) => {
    const b = h.objects.get(key);
    if (!b) throw new Error("object not found");
    return b;
  },
  removeObjectBestEffort: async (key: string) => {
    h.objects.delete(key);
  },
  createAttachment: async (p: Record<string, unknown>) => {
    const id = h.nextId();
    h.rows.set(id, {
      id,
      org_id: p.orgId,
      owner_kind: p.ownerKind,
      client_id: p.clientId ?? null,
      category: p.category,
      source_task_id: p.sourceTaskId ?? null,
      archived_at: null,
      archived_by: null,
      storage_provider: "supabase",
      object_key: p.objectKey,
      file_name: p.fileName,
      mime_type: p.mimeType,
      size_bytes: p.sizeBytes,
      content_sha256: p.contentSha256 ?? null,
      dek_wrapped: p.dekWrapped,
      dek_iv: p.dekIv,
      dek_tag: p.dekTag,
      file_iv: p.fileIv,
      file_tag: p.fileTag,
      key_id: p.keyId,
      enc_algo: "AES-256-GCM",
      uploaded_by: "u1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return id;
  },
  findByIdAndOrgId: async (id: string, orgId: string) => {
    const r = h.rows.get(id);
    return r && r.org_id === orgId ? r : null;
  },
  listByScope: async (
    orgId: string,
    scope: { kind: string; clientId?: string; taskId?: string; folder?: string },
  ) => {
    const all = [...h.rows.values()].filter((r) => r.org_id === orgId);
    if (scope.kind === "client")
      return all.filter(
        (r) =>
          r.owner_kind === "client" &&
          r.client_id === scope.clientId &&
          r.archived_at === null,
      );
    if (scope.kind === "task")
      return all.filter(
        (r) => r.source_task_id === scope.taskId && r.archived_at === null,
      );
    switch (scope.folder) {
      case "files":
        return all.filter(
          (r) =>
            r.owner_kind === "office" &&
            r.category === "office_files" &&
            r.archived_at === null,
        );
      case "additional":
        return all.filter(
          (r) =>
            r.owner_kind === "office" &&
            r.category === "additional" &&
            r.archived_at === null,
        );
      case "tasks":
        return all.filter(
          (r) => r.source_task_id !== null && r.archived_at === null,
        );
      case "clients":
        return all.filter(
          (r) => r.owner_kind === "client" && r.archived_at === null,
        );
      case "archive":
        return all.filter((r) => r.archived_at !== null);
      default:
        return [];
    }
  },
  setArchived: async (
    id: string,
    orgId: string,
    archived: boolean,
    by: string | null,
  ) => {
    const r = h.rows.get(id);
    if (!r || r.org_id !== orgId) return null;
    r.archived_at = archived ? new Date().toISOString() : null;
    r.archived_by = archived ? by : null;
    return r;
  },
}));

vi.mock("@/server/repositories/encryption-keys.repository", () => ({
  createSupabaseKeyStore: () => ({
    getActiveOfficeKey: async (orgId: string) => h.officeKeys.get(orgId) ?? null,
    insertOfficeKey: async (input: Record<string, unknown>) => {
      const id = h.nextId();
      h.officeKeys.set(input.orgId as string, {
        id,
        wrappedKey: input.wrappedKey,
        kmsKeyId: input.kmsKeyId,
        algo: input.algo,
        keyVersion: 1,
      });
      return { id };
    },
    getActiveClientKey: async (orgId: string, clientId: string) =>
      h.clientKeys.get(`${orgId}:${clientId}`) ?? null,
    insertClientKey: async (input: Record<string, unknown>) => {
      const id = h.nextId();
      h.clientKeys.set(`${input.orgId}:${input.clientId}`, {
        id,
        wrappedKey: input.wrappedKey,
        wrapIv: input.wrapIv,
        wrapTag: input.wrapTag,
        wrappedByKeyId: input.wrappedByKeyId,
        algo: input.algo,
        keyVersion: 1,
      });
      return { id };
    },
  }),
  // crypto-shred = the active client key is gone (no active row remains).
  revokeClientKey: async (orgId: string, clientId: string) => {
    h.clientKeys.delete(`${orgId}:${clientId}`);
  },
}));

vi.mock("@/server/repositories/tasks.repository", () => ({
  findByIdAndOrgId: async (id: string, orgId: string) => {
    const t = h.tasks.get(id);
    return t && t.org_id === orgId ? t : null;
  },
}));

vi.mock("@/server/repositories/clients.repository", () => ({
  findByIdAndOrgId: async (id: string, orgId: string) => {
    const c = h.clients.get(id);
    return c && c.org_id === orgId ? c : null;
  },
}));

// Import AFTER the mocks are registered.
import {
  cryptoShredClient,
  getAttachmentDownload,
  listAttachments,
  setArchived,
  uploadAttachment,
} from "./attachments.service";

const ORG = "org1";
const CLIENT_A = "11111111-1111-1111-1111-1111111111a1";
const TASK_WITH_CLIENT = "22222222-2222-2222-2222-2222222222b1";
const TASK_NO_CLIENT = "22222222-2222-2222-2222-2222222222b2";

function makeSession(role: "owner" | "admin" | "employee"): FullSession {
  return {
    user: { id: "u1" },
    profile: { id: "u1" },
    organization: { id: ORG },
    activeOrg: { id: ORG },
    activeRole: role,
    memberships: [],
  } as unknown as FullSession;
}

const PDF = () =>
  Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(64)]);

beforeAll(() => {
  process.env.AVI_MASTER_KEK_B64 = randomBytes(32).toString("base64");
});
afterAll(() => {
  delete process.env.AVI_MASTER_KEK_B64;
});
beforeEach(() => {
  h.reset();
  h.clients.set(CLIENT_A, { id: CLIENT_A, org_id: ORG, name: "Client A" });
  h.tasks.set(TASK_WITH_CLIENT, {
    id: TASK_WITH_CLIENT,
    org_id: ORG,
    client_id: CLIENT_A,
  });
  h.tasks.set(TASK_NO_CLIENT, {
    id: TASK_NO_CLIENT,
    org_id: ORG,
    client_id: null,
  });
});

describe("upload → download round-trip (real envelope crypto)", () => {
  it("encrypts at rest and decrypts back to the original bytes", async () => {
    const session = makeSession("owner");
    const plaintext = PDF();

    const dto = await uploadAttachment(
      session,
      { context: "client", contextId: CLIENT_A, category: "certificates_reports" },
      { bytes: plaintext, fileName: "דוח.pdf", mimeType: "application/pdf" },
    );

    expect(dto.ownerKind).toBe("client");
    expect(dto.clientId).toBe(CLIENT_A);
    expect(dto.category).toBe("certificates_reports");
    expect(dto.encAlgo).toBe("AES-256-GCM");
    // No crypto material leaks into the DTO.
    expect(dto).not.toHaveProperty("objectKey");
    expect(dto).not.toHaveProperty("dekWrapped");

    // The bytes stored at rest are ciphertext, NOT the plaintext.
    const row = h.rows.get(dto.id)!;
    const stored = h.objects.get(row.object_key as string)!;
    expect(stored.equals(plaintext)).toBe(false);

    const back = await getAttachmentDownload(session, dto.id);
    expect(back.bytes.equals(plaintext)).toBe(true);
    expect(back.fileName).toBe("דוח.pdf");
    expect(back.mimeType).toBe("application/pdf");
  });
});

describe("routing (locked folder model)", () => {
  it("a task WITH a client routes under the client (per-client key)", async () => {
    const session = makeSession("employee");
    const dto = await uploadAttachment(
      session,
      { context: "task", contextId: TASK_WITH_CLIENT, category: "task_files" },
      { bytes: PDF(), fileName: "a.pdf", mimeType: "application/pdf" },
    );
    expect(dto.ownerKind).toBe("client");
    expect(dto.clientId).toBe(CLIENT_A);
    expect(dto.category).toBe("task_files");
    expect(dto.sourceTaskId).toBe(TASK_WITH_CLIENT);
    // a client key was minted for CLIENT_A.
    expect(h.clientKeys.has(`${ORG}:${CLIENT_A}`)).toBe(true);
  });

  it("a task WITHOUT a client is office-owned", async () => {
    const session = makeSession("employee");
    const dto = await uploadAttachment(
      session,
      { context: "task", contextId: TASK_NO_CLIENT, category: "task_files" },
      { bytes: PDF(), fileName: "b.pdf", mimeType: "application/pdf" },
    );
    expect(dto.ownerKind).toBe("office");
    expect(dto.clientId).toBeNull();
    expect(dto.sourceTaskId).toBe(TASK_NO_CLIENT);
  });

  it("reuses the same office key across office uploads", async () => {
    const session = makeSession("owner");
    await uploadAttachment(
      session,
      { context: "office", category: "office_files" },
      { bytes: PDF(), fileName: "1.pdf", mimeType: "application/pdf" },
    );
    await uploadAttachment(
      session,
      { context: "office", category: "additional" },
      { bytes: PDF(), fileName: "2.pdf", mimeType: "application/pdf" },
    );
    expect(h.officeKeys.size).toBe(1);
  });
});

describe("content gate", () => {
  it("rejects HTML disguised as text/csv (415)", async () => {
    const session = makeSession("owner");
    await expect(
      uploadAttachment(
        session,
        { context: "office", category: "office_files" },
        {
          bytes: Buffer.from("<!doctype html><script>x</script>"),
          fileName: "evil.csv",
          mimeType: "text/csv",
        },
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
    // nothing was stored.
    expect(h.objects.size).toBe(0);
    expect(h.rows.size).toBe(0);
  });
});

describe("list (folders + aggregates)", () => {
  it("returns a client's files and the office task aggregate", async () => {
    const session = makeSession("owner");
    await uploadAttachment(
      session,
      { context: "client", contextId: CLIENT_A, category: "certificates_reports" },
      { bytes: PDF(), fileName: "c.pdf", mimeType: "application/pdf" },
    );
    await uploadAttachment(
      session,
      { context: "task", contextId: TASK_NO_CLIENT, category: "task_files" },
      { bytes: PDF(), fileName: "t.pdf", mimeType: "application/pdf" },
    );

    const clientList = await listAttachments(session, {
      scope: "client",
      clientId: CLIENT_A,
    });
    expect(clientList.items).toHaveLength(1);

    const officeTasks = await listAttachments(session, {
      scope: "office",
      folder: "tasks",
    });
    expect(officeTasks.items).toHaveLength(1);
    expect(officeTasks.items[0].sourceTaskId).toBe(TASK_NO_CLIENT);
  });
});

describe("archive toggle", () => {
  it("owner archives and un-archives; employee is denied", async () => {
    const owner = makeSession("owner");
    const dto = await uploadAttachment(
      owner,
      { context: "office", category: "office_files" },
      { bytes: PDF(), fileName: "x.pdf", mimeType: "application/pdf" },
    );

    const archived = await setArchived(owner, dto.id, true);
    expect(archived.archivedAt).not.toBeNull();

    const restored = await setArchived(owner, dto.id, false);
    expect(restored.archivedAt).toBeNull();

    await expect(
      setArchived(makeSession("employee"), dto.id, true),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("crypto-shred", () => {
  it("owner shreds a client → that client's files become undecryptable (404)", async () => {
    const owner = makeSession("owner");
    const dto = await uploadAttachment(
      owner,
      { context: "client", contextId: CLIENT_A, category: "certificates_reports" },
      { bytes: PDF(), fileName: "s.pdf", mimeType: "application/pdf" },
    );
    // decryptable before the shred
    await expect(getAttachmentDownload(owner, dto.id)).resolves.toBeDefined();

    await cryptoShredClient(owner, CLIENT_A);

    // the active client key is gone → download can no longer produce plaintext
    await expect(getAttachmentDownload(owner, dto.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("an employee cannot crypto-shred", async () => {
    await expect(
      cryptoShredClient(makeSession("employee"), CLIENT_A),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
