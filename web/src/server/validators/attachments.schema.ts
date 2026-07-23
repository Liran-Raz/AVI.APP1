import { z } from "zod";

import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/server/errors/app-error";

// DEV-032 attachments validation. Two layers:
//   * zod schemas for the upload METADATA + the list query (structural), and
//   * assertAllowedUpload() for the file BYTES — magic-byte sniffing that never
//     trusts the client-declared MIME and rejects HTML/SVG/script outright.

// ============================================================
// Folders / contexts
// ============================================================

export const ATTACHMENT_CATEGORIES = [
  "certificates_reports",
  "task_files",
  "client_uploaded",
  "additional",
  "office_files",
] as const;
export const attachmentCategorySchema = z.enum(ATTACHMENT_CATEGORIES);
export type AttachmentCategoryValue = z.infer<typeof attachmentCategorySchema>;

// Where the user is uploading FROM. The service maps this to the stored owner
// (client|office) + category + provenance and the DB CHECK is the backstop.
export const ATTACHMENT_CONTEXTS = ["client", "office", "task"] as const;

// Office aggregate/stored folders the list endpoint can address.
export const OFFICE_FOLDERS = [
  "files", // stored: owner=office, category=office_files
  "additional", // stored: owner=office, category=additional
  "tasks", // aggregate: source_task_id is not null (ALL task-sourced files)
  "clients", // aggregate: owner=client (all clients' files)
  "archive", // aggregate: archived_at is not null
] as const;

// ============================================================
// Size cap
// ============================================================

// R1a caps uploads at 4MB — safely under Vercel's ~4.5MB request-body limit.
// The DB CHECK allows 25MB; the Cloud Run path (R1b) lifts this cap by moving
// the byte path off Vercel. Keep this the R1a authority.
export const R1A_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// ============================================================
// MIME allowlist (declared) — necessary but NOT sufficient (see the sniffer).
// ============================================================

const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const ALLOWED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/webp",
  MIME_DOCX,
  MIME_XLSX,
  "application/msword", // legacy .doc
  "application/vnd.ms-excel", // legacy .xls
  "text/plain",
  "text/csv",
]);

// ============================================================
// Filename sanitizer — display only (the object_key never carries the name).
// Drops path separators, control chars, and filesystem-hostile chars; caps
// length. Char-by-char (no control-char regex) to stay lint-clean + explicit.
// ============================================================

const HOSTILE_FILENAME_CHARS = new Set([...'<>:"|?*']);

export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? raw; // drop any path
  let out = "";
  for (const ch of base) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue; // control chars
    if (HOSTILE_FILENAME_CHARS.has(ch)) continue;
    out += ch;
  }
  return out.trim().slice(0, 200) || "file";
}

// ============================================================
// Byte-level content check (magic bytes). Runs on the PLAINTEXT bytes in the
// service, before encryption.
// ============================================================

type SniffFamily =
  | "pdf"
  | "png"
  | "jpeg"
  | "tiff"
  | "webp"
  | "zip" // docx/xlsx (OOXML is a zip)
  | "ole" // legacy doc/xls (OLE compound)
  | "text"
  | "markup" // html/svg/xml/script — ALWAYS rejected
  | "unknown";

function startsWith(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

function looksLikeMarkup(buf: Buffer): boolean {
  // Inspect a decoded head; strip a UTF-8 BOM + leading whitespace.
  let head = buf.subarray(0, 1024).toString("latin1");
  if (head.charCodeAt(0) === 0xef) head = head.slice(3); // UTF-8 BOM bytes as latin1
  head = head.replace(/^\s+/, "");
  if (head.startsWith("<")) return true;
  const lower = head.toLowerCase();
  return (
    lower.includes("<script") ||
    lower.includes("<svg") ||
    lower.includes("<html") ||
    lower.includes("<!doctype") ||
    lower.includes("<?xml")
  );
}

function isProbablyText(buf: Buffer): boolean {
  // No NUL byte in the first 8KB → treat as a text candidate. Binary formats
  // (handled above by magic bytes) reliably contain NULs.
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return false;
  }
  return true;
}

function sniff(buf: Buffer): SniffFamily {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  if (
    startsWith(buf, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a])
  )
    return "tiff";
  if (
    startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && // RIFF
    buf.length >= 12 &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "webp";
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return "zip"; // PK\x03\x04
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return "ole";
  if (isProbablyText(buf)) return looksLikeMarkup(buf) ? "markup" : "text";
  return "unknown";
}

// declared MIME → the byte family it must sniff to.
const MIME_TO_FAMILY: Record<string, SniffFamily> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/tiff": "tiff",
  "image/webp": "webp",
  [MIME_DOCX]: "zip",
  [MIME_XLSX]: "zip",
  "application/msword": "ole",
  "application/vnd.ms-excel": "ole",
  "text/plain": "text",
  "text/csv": "text",
};

// Throws PayloadTooLargeError (413) / UnsupportedMediaTypeError (415). A file
// passes ONLY if: within the size cap, its declared MIME is allowlisted, its
// bytes are NOT markup/script, and the sniffed family matches the declared type.
export function assertAllowedUpload(
  bytes: Buffer,
  declaredMime: string,
  maxBytes: number = R1A_MAX_UPLOAD_BYTES,
): void {
  if (bytes.length === 0) {
    throw new UnsupportedMediaTypeError("Empty file");
  }
  if (bytes.length > maxBytes) {
    throw new PayloadTooLargeError();
  }
  if (!ALLOWED_MIME_TYPES.has(declaredMime)) {
    throw new UnsupportedMediaTypeError();
  }
  const family = sniff(bytes);
  if (family === "markup") {
    throw new UnsupportedMediaTypeError("HTML/SVG/script content is not allowed");
  }
  const expected = MIME_TO_FAMILY[declaredMime];
  if (family !== expected) {
    throw new UnsupportedMediaTypeError(
      "File content does not match its declared type",
    );
  }
}

// ============================================================
// zod schemas — upload metadata + list query
// ============================================================

// An optional uuid: an empty string / null is treated as absent. Output is
// `string | undefined` so the key can be omitted (office uploads carry none).
function optionalUuid() {
  return z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.string().uuid("Invalid id").optional(),
  );
}

export const uploadAttachmentMetaSchema = z
  .object({
    context: z.enum(ATTACHMENT_CONTEXTS),
    contextId: optionalUuid(),
    category: attachmentCategorySchema,
  })
  .strict()
  .refine((d) => d.context === "office" || Boolean(d.contextId), {
    message: "A client id or task id is required for this upload",
    path: ["contextId"],
  });

// NOT .strict(): the route parses Object.fromEntries(searchParams), so an
// unrelated query param must strip, not 400.
export const listAttachmentsQuerySchema = z
  .object({
    scope: z.enum(ATTACHMENT_CONTEXTS),
    clientId: optionalUuid(),
    taskId: optionalUuid(),
    folder: z.enum(OFFICE_FOLDERS).optional(),
  })
  .refine((q) => q.scope !== "client" || Boolean(q.clientId), {
    message: "clientId is required when scope=client",
    path: ["clientId"],
  })
  .refine((q) => q.scope !== "task" || Boolean(q.taskId), {
    message: "taskId is required when scope=task",
    path: ["taskId"],
  })
  .refine((q) => q.scope !== "office" || Boolean(q.folder), {
    message: "folder is required when scope=office",
    path: ["folder"],
  });

export const attachmentIdParamSchema = z.object({
  id: z.string().uuid("Invalid attachment id"),
});

export const archiveAttachmentSchema = z
  .object({
    archived: z.boolean(),
  })
  .strict();

// ============================================================
// Inferred types
// ============================================================

export type UploadAttachmentMeta = z.infer<typeof uploadAttachmentMetaSchema>;
export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;
export type ArchiveAttachmentPayload = z.infer<typeof archiveAttachmentSchema>;
export type OfficeFolder = (typeof OFFICE_FOLDERS)[number];
