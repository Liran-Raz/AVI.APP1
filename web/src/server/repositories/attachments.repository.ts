import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Attachment, AttachmentCategory, AttachmentOwner } from "@/server/db/domain.types";
import type { OfficeFolder } from "@/server/validators/attachments.schema";

// Attachments repository (DEV-032) — the only layer that reads the attachments
// table, calls create_attachment(), or touches the private Storage bucket.
// Every query filters org_id explicitly (defense in depth on top of RLS). Rows
// are minted ONLY via the RPC (the table has no client INSERT grant); the sole
// client UPDATE is the archive toggle (the immutability trigger freezes the
// rest).

export const ATTACHMENTS_BUCKET = "attachments";

// ---- Storage (ciphertext bytes) ----

export async function uploadObject(
  objectKey: string,
  ciphertext: Buffer,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(objectKey, ciphertext, {
      contentType: "application/octet-stream", // opaque ciphertext
      upsert: false,
    });
  if (error) throw error;
}

export async function downloadObject(objectKey: string): Promise<Buffer> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .download(objectKey);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

// Best-effort cleanup — used when the row insert fails AFTER the bytes were
// uploaded, to avoid orphaning the object. Never throws (R2 reconciliation is
// the backstop if the delete grant is absent).
export async function removeObjectBestEffort(objectKey: string): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([objectKey]);
  } catch {
    // swallow — orphan reconciliation is a R2 concern
  }
}

// ---- Row mint (create_attachment RPC) ----

export type CreateAttachmentParams = {
  orgId: string;
  ownerKind: AttachmentOwner;
  clientId: string | null;
  category: AttachmentCategory;
  sourceTaskId: string | null;
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dekWrapped: string;
  dekIv: string;
  dekTag: string;
  fileIv: string;
  fileTag: string;
  keyId: string;
  contentSha256: string | null;
};

export async function createAttachment(
  params: CreateAttachmentParams,
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_attachment", {
    p_org_id: params.orgId,
    p_owner_kind: params.ownerKind,
    p_client_id: params.clientId,
    p_category: params.category,
    p_source_task_id: params.sourceTaskId,
    p_object_key: params.objectKey,
    p_file_name: params.fileName,
    p_mime_type: params.mimeType,
    p_size_bytes: params.sizeBytes,
    p_dek_wrapped: params.dekWrapped,
    p_dek_iv: params.dekIv,
    p_dek_tag: params.dekTag,
    p_file_iv: params.fileIv,
    p_file_tag: params.fileTag,
    p_key_id: params.keyId,
    p_content_sha256: params.contentSha256,
  } as never);
  if (error) throw error;
  return data as unknown as string;
}

// ---- Reads (RLS SELECT; the folder model = queries, not tables) ----

export async function findByIdAndOrgId(
  id: string,
  orgId: string,
): Promise<Attachment | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Attachment | null) ?? null;
}

export type ListScope =
  | { kind: "client"; clientId: string }
  | { kind: "task"; taskId: string }
  | { kind: "office"; folder: OfficeFolder };

export async function listByScope(
  orgId: string,
  scope: ListScope,
): Promise<Attachment[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("attachments")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (scope.kind === "client") {
    query = query
      .eq("owner_kind", "client")
      .eq("client_id", scope.clientId)
      .is("archived_at", null);
  } else if (scope.kind === "task") {
    query = query.eq("source_task_id", scope.taskId).is("archived_at", null);
  } else {
    switch (scope.folder) {
      case "files":
        query = query
          .eq("owner_kind", "office")
          .eq("category", "office_files")
          .is("archived_at", null);
        break;
      case "additional":
        query = query
          .eq("owner_kind", "office")
          .eq("category", "additional")
          .is("archived_at", null);
        break;
      case "tasks": // aggregate: ALL task-sourced files (office + client)
        query = query.not("source_task_id", "is", null).is("archived_at", null);
        break;
      case "clients": // aggregate: all client-owned files
        query = query.eq("owner_kind", "client").is("archived_at", null);
        break;
      case "archive": // aggregate: everything archived
        query = query.not("archived_at", "is", null);
        break;
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as Attachment[]) ?? [];
}

// ---- Archive toggle (the ONLY client UPDATE; trigger freezes everything else) ----

export async function setArchived(
  id: string,
  orgId: string,
  archived: boolean,
  archivedBy: string | null,
): Promise<Attachment | null> {
  const supabase = await createSupabaseServerClient();
  const patch = archived
    ? { archived_at: new Date().toISOString(), archived_by: archivedBy }
    : { archived_at: null, archived_by: null };
  const { data, error } = await supabase
    .from("attachments")
    .update(patch as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Attachment | null) ?? null;
}
