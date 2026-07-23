import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { requireCapability } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import type { FullSession } from "@/server/auth/session";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromBase64,
  generateDek,
  toBase64,
} from "@/server/crypto/envelope";
import { zeroize } from "@/server/crypto/zeroize";
import type { Attachment } from "@/server/db/domain.types";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "@/server/errors/app-error";
import { KeyUnavailableError, toSafeKeyErrorMeta } from "@/server/keys/key-errors";
import {
  KeyHierarchy,
  type AttachmentOwner,
} from "@/server/keys/key-hierarchy";
import { getKeyProvider } from "@/server/keys/key-provider.factory";
import * as attachmentsRepo from "@/server/repositories/attachments.repository";
import {
  createSupabaseKeyStore,
  revokeClientKey,
} from "@/server/repositories/encryption-keys.repository";
import * as clientsRepo from "@/server/repositories/clients.repository";
import * as tasksRepo from "@/server/repositories/tasks.repository";
import {
  assertAllowedUpload,
  sanitizeFileName,
  type ListAttachmentsQuery,
  type OfficeFolder,
  type UploadAttachmentMeta,
} from "@/server/validators/attachments.schema";

// Attachments service (DEV-032) — orchestrates routing + envelope encryption +
// storage + the DB mint, behind capability gates, and maps rows to DTOs that
// carry NO crypto material / object key / org id. This is the only place the
// crypto core, the key hierarchy, and the storage repo meet per request; a
// KeyHierarchy is created PER CALL and disposed (zeroized) in a finally.

export type AttachmentDTO = {
  id: string;
  ownerKind: Attachment["owner_kind"];
  clientId: string | null;
  category: Attachment["category"];
  sourceTaskId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  archivedAt: string | null;
  archivedBy: string | null;
  uploadedBy: string | null;
  createdAt: string;
  encAlgo: string; // for the "encrypted" pill in the UI
};

export type UploadFile = { bytes: Buffer; fileName: string; mimeType: string };

export type DownloadedAttachment = {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
};

function toDTO(row: Attachment): AttachmentDTO {
  // Strip org_id, object_key, all crypto columns (dek_*/file_*), key_id,
  // content_sha256, storage_provider, updated_at — none reach the client.
  return {
    id: row.id,
    ownerKind: row.owner_kind,
    clientId: row.client_id,
    category: row.category,
    sourceTaskId: row.source_task_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    encAlgo: row.enc_algo,
  };
}

// ============================================================
// Routing — the locked folder model (memory/plan). A task WITH a client routes
// under that client (per-client key); a task WITHOUT one is office-owned.
// ============================================================

type Routing = {
  owner: AttachmentOwner;
  clientId: string | null;
  category: Attachment["category"];
  sourceTaskId: string | null;
};

const CLIENT_DIRECT_CATEGORIES = new Set<string>([
  "certificates_reports",
  "client_uploaded",
  "additional",
]);
const OFFICE_DIRECT_CATEGORIES = new Set<string>(["office_files", "additional"]);

async function resolveRouting(
  session: FullSession,
  meta: UploadAttachmentMeta,
): Promise<Routing> {
  const orgId = session.organization.id;

  if (meta.context === "task") {
    if (!meta.contextId) throw new ValidationError("A task id is required");
    const task = await tasksRepo.findByIdAndOrgId(meta.contextId, orgId);
    if (!task) throw new ValidationError("Task not found in this office");
    // task file → forced category task_files; owner follows the task's client.
    if (task.client_id) {
      return {
        owner: { kind: "client", clientId: task.client_id },
        clientId: task.client_id,
        category: "task_files",
        sourceTaskId: task.id,
      };
    }
    return {
      owner: { kind: "office" },
      clientId: null,
      category: "task_files",
      sourceTaskId: task.id,
    };
  }

  if (meta.context === "client") {
    if (!meta.contextId) throw new ValidationError("A client id is required");
    const client = await clientsRepo.findByIdAndOrgId(meta.contextId, orgId);
    if (!client) throw new ValidationError("Client not found in this office");
    if (!CLIENT_DIRECT_CATEGORIES.has(meta.category)) {
      throw new ValidationError("Invalid folder for a client file");
    }
    return {
      owner: { kind: "client", clientId: client.id },
      clientId: client.id,
      category: meta.category,
      sourceTaskId: null,
    };
  }

  // office
  if (!OFFICE_DIRECT_CATEGORIES.has(meta.category)) {
    throw new ValidationError("Invalid folder for an office file");
  }
  return {
    owner: { kind: "office" },
    clientId: null,
    category: meta.category,
    sourceTaskId: null,
  };
}

// A create_attachment RPC rejection (membership/routing/key coherence). Never
// leak raw Postgres — log a safe category server-side, return a generic 400.
function translateCreateError(err: unknown): never {
  console.error("[attachments] create failed", {
    category:
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code)
        : "unknown",
  });
  throw new ValidationError("Could not save the file");
}

// ============================================================
// Reads
// ============================================================

export async function listAttachments(
  session: FullSession,
  query: ListAttachmentsQuery,
): Promise<{ items: AttachmentDTO[] }> {
  requireCapability(session, PERMISSIONS.ATTACHMENTS_VIEW);
  const orgId = session.organization.id;

  let scope: attachmentsRepo.ListScope;
  if (query.scope === "client") {
    scope = {
      kind: "client",
      clientId: query.clientId as string,
      category: query.category,
    };
  } else if (query.scope === "task") {
    scope = { kind: "task", taskId: query.taskId as string };
  } else {
    scope = { kind: "office", folder: query.folder as OfficeFolder };
  }

  const rows = await attachmentsRepo.listByScope(orgId, scope);
  return { items: rows.map(toDTO) };
}

// ============================================================
// Upload — the envelope flow
// ============================================================

export async function uploadAttachment(
  session: FullSession,
  meta: UploadAttachmentMeta,
  file: UploadFile,
): Promise<AttachmentDTO> {
  requireCapability(session, PERMISSIONS.ATTACHMENTS_UPLOAD);
  const orgId = session.organization.id;

  // 1. Content gate — size + declared MIME + magic-byte sniff (413/415).
  assertAllowedUpload(file.bytes, file.mimeType);

  // 2. Routing decision (owner / category / provenance).
  const routing = await resolveRouting(session, meta);

  const kh = new KeyHierarchy(getKeyProvider(), createSupabaseKeyStore());
  try {
    // 3. Owner key (create-if-missing for upload).
    const ownerKey = await kh.resolveOwnerKey(orgId, routing.owner);

    // 4. Encrypt bytes + wrap the DEK.
    const dek = generateDek();
    try {
      const enc = aesGcmEncrypt(dek, file.bytes);
      const wrappedDek = kh.wrapDek(ownerKey.plaintext, dek);
      const contentSha256 = toBase64(
        createHash("sha256").update(file.bytes).digest(),
      );

      // 5. Upload ciphertext to a random org-scoped object key (no PII/name).
      const objectKey = `org/${orgId}/${randomUUID()}`;
      await attachmentsRepo.uploadObject(objectKey, enc.ciphertext);

      // 6. Mint the row via the RPC (rolling back the object on failure).
      let id: string;
      try {
        id = await attachmentsRepo.createAttachment({
          orgId,
          ownerKind: routing.owner.kind,
          clientId: routing.clientId,
          category: routing.category,
          sourceTaskId: routing.sourceTaskId,
          objectKey,
          fileName: sanitizeFileName(file.fileName),
          mimeType: file.mimeType,
          sizeBytes: file.bytes.length,
          dekWrapped: wrappedDek.wrapped,
          dekIv: wrappedDek.iv,
          dekTag: wrappedDek.tag,
          fileIv: toBase64(enc.iv),
          fileTag: toBase64(enc.tag),
          keyId: ownerKey.id,
          contentSha256,
        });
      } catch (err) {
        await attachmentsRepo.removeObjectBestEffort(objectKey);
        translateCreateError(err);
      }

      const row = await attachmentsRepo.findByIdAndOrgId(id, orgId);
      if (!row) {
        throw new AppError(
          "INTERNAL_ERROR",
          "Attachment could not be read back",
          500,
        );
      }
      return toDTO(row);
    } finally {
      zeroize(dek);
    }
  } finally {
    kh.dispose();
  }
}

// ============================================================
// Download — decrypt + return plaintext bytes
// ============================================================

export async function getAttachmentDownload(
  session: FullSession,
  id: string,
): Promise<DownloadedAttachment> {
  requireCapability(session, PERMISSIONS.ATTACHMENTS_VIEW);
  const orgId = session.organization.id;

  const row = await attachmentsRepo.findByIdAndOrgId(id, orgId);
  if (!row) throw new NotFoundError("Attachment not found");

  const owner: AttachmentOwner =
    row.owner_kind === "client" && row.client_id
      ? { kind: "client", clientId: row.client_id }
      : { kind: "office" };

  const kh = new KeyHierarchy(getKeyProvider(), createSupabaseKeyStore());
  try {
    let ownerKey;
    try {
      // Read-only resolve — a crypto-shredded/absent key throws (never creates).
      ownerKey = await kh.resolveOwnerKeyForRead(orgId, owner);
    } catch (err) {
      if (err instanceof KeyUnavailableError) {
        throw new NotFoundError("File is no longer available");
      }
      console.error("[attachments] key resolve failed", toSafeKeyErrorMeta(err));
      throw new AppError("INTERNAL_ERROR", "Could not open the file", 500);
    }

    // R1a has no key rotation: the file's key MUST be the current active key.
    // If it differs (a future rotation), refuse rather than mis-decrypt.
    if (ownerKey.id !== row.key_id) {
      throw new NotFoundError("File is no longer available");
    }

    const dek = kh.unwrapDek(ownerKey.plaintext, {
      wrapped: row.dek_wrapped,
      iv: row.dek_iv,
      tag: row.dek_tag,
    });
    try {
      const ciphertext = await attachmentsRepo.downloadObject(row.object_key);
      const plaintext = aesGcmDecrypt(dek, {
        iv: fromBase64(row.file_iv),
        ciphertext,
        tag: fromBase64(row.file_tag),
      });
      return {
        bytes: plaintext,
        fileName: row.file_name,
        mimeType: row.mime_type,
      };
    } finally {
      zeroize(dek);
    }
  } finally {
    kh.dispose();
  }
}

// ============================================================
// Archive toggle (the "delete" capability in R1a; hard-delete = R2)
// ============================================================

export async function setArchived(
  session: FullSession,
  id: string,
  archived: boolean,
): Promise<AttachmentDTO> {
  requireCapability(session, PERMISSIONS.ATTACHMENTS_DELETE);
  const orgId = session.organization.id;
  const existing = await attachmentsRepo.findByIdAndOrgId(id, orgId);
  if (!existing) throw new NotFoundError("Attachment not found");
  const row = await attachmentsRepo.setArchived(
    id,
    orgId,
    archived,
    session.user.id,
  );
  if (!row) throw new NotFoundError("Attachment not found");
  return toDTO(row);
}

// ============================================================
// Crypto-shred a client (owner/manager; client offboarding). Renders every one
// of that client's files permanently undecryptable, no storage I/O.
// ============================================================

export async function cryptoShredClient(
  session: FullSession,
  clientId: string,
): Promise<void> {
  requireCapability(session, PERMISSIONS.ATTACHMENTS_MANAGE);
  const orgId = session.organization.id;
  const client = await clientsRepo.findByIdAndOrgId(clientId, orgId);
  if (!client) throw new NotFoundError("Client not found");
  await revokeClientKey(orgId, clientId);
}
