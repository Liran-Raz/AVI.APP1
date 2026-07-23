import { describe, expect, it } from "vitest";

import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/server/errors/app-error";
import {
  assertAllowedUpload,
  listAttachmentsQuerySchema,
  R1A_MAX_UPLOAD_BYTES,
  sanitizeFileName,
  uploadAttachmentMetaSchema,
} from "./attachments.schema";

// Sample byte heads for each family.
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(32, 1)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);
const TEXT = Buffer.from("name,amount\nAcme,1200\n");
const HTML = Buffer.from("<!doctype html><html><body>x</body></html>");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 1)]);
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("assertAllowedUpload — accepts matching allowlisted types", () => {
  it("accepts a real PDF declared as application/pdf", () => {
    expect(() => assertAllowedUpload(PDF, "application/pdf")).not.toThrow();
  });
  it("accepts a real PNG", () => {
    expect(() => assertAllowedUpload(PNG, "image/png")).not.toThrow();
  });
  it("accepts a real JPEG", () => {
    expect(() => assertAllowedUpload(JPEG, "image/jpeg")).not.toThrow();
  });
  it("accepts CSV text", () => {
    expect(() => assertAllowedUpload(TEXT, "text/csv")).not.toThrow();
  });
  it("accepts a zip-based docx", () => {
    expect(() => assertAllowedUpload(ZIP, DOCX)).not.toThrow();
  });
});

describe("assertAllowedUpload — rejects dangerous / mismatched content", () => {
  it("rejects HTML uploaded as text/csv (415)", () => {
    expect(() => assertAllowedUpload(HTML, "text/csv")).toThrow(
      UnsupportedMediaTypeError,
    );
  });
  it("rejects SVG (markup) uploaded as text/plain (415)", () => {
    expect(() => assertAllowedUpload(SVG, "text/plain")).toThrow(
      UnsupportedMediaTypeError,
    );
  });
  it("rejects PNG bytes declared as application/pdf (sniff mismatch)", () => {
    expect(() => assertAllowedUpload(PNG, "application/pdf")).toThrow(
      UnsupportedMediaTypeError,
    );
  });
  it("rejects a non-allowlisted declared type", () => {
    expect(() => assertAllowedUpload(PDF, "image/svg+xml")).toThrow(
      UnsupportedMediaTypeError,
    );
  });
  it("rejects an empty file", () => {
    expect(() => assertAllowedUpload(Buffer.alloc(0), "application/pdf")).toThrow(
      UnsupportedMediaTypeError,
    );
  });
  it("rejects a file over the size cap (413)", () => {
    const big = Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(R1A_MAX_UPLOAD_BYTES + 1, 1),
    ]);
    expect(() => assertAllowedUpload(big, "application/pdf")).toThrow(
      PayloadTooLargeError,
    );
  });
});

describe("sanitizeFileName", () => {
  it("strips path components", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\x\\report.pdf")).toBe("report.pdf");
  });
  it("removes control + filesystem-hostile chars", () => {
    expect(sanitizeFileName('a<b>c:"d"|e?.pdf')).toBe("abcde.pdf");
  });
  it("keeps Hebrew names", () => {
    expect(sanitizeFileName("דוח שנתי.pdf")).toBe("דוח שנתי.pdf");
  });
  it("falls back to 'file' when everything is stripped", () => {
    expect(sanitizeFileName("///")).toBe("file");
  });
  it("caps the length", () => {
    expect(sanitizeFileName("a".repeat(500)).length).toBe(200);
  });
});

describe("uploadAttachmentMetaSchema", () => {
  it("accepts an office upload with no contextId", () => {
    const r = uploadAttachmentMetaSchema.safeParse({
      context: "office",
      category: "office_files",
    });
    expect(r.success).toBe(true);
  });
  it("requires contextId for a client upload", () => {
    const r = uploadAttachmentMetaSchema.safeParse({
      context: "client",
      category: "certificates_reports",
    });
    expect(r.success).toBe(false);
  });
  it("accepts a client upload with a uuid contextId", () => {
    const r = uploadAttachmentMetaSchema.safeParse({
      context: "client",
      contextId: "11111111-1111-4111-8111-111111111111",
      category: "certificates_reports",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown category", () => {
    const r = uploadAttachmentMetaSchema.safeParse({
      context: "office",
      category: "nope",
    });
    expect(r.success).toBe(false);
  });
});

describe("listAttachmentsQuerySchema", () => {
  it("requires clientId when scope=client", () => {
    expect(listAttachmentsQuerySchema.safeParse({ scope: "client" }).success).toBe(
      false,
    );
  });
  it("requires folder when scope=office", () => {
    expect(listAttachmentsQuerySchema.safeParse({ scope: "office" }).success).toBe(
      false,
    );
  });
  it("accepts scope=office with a folder", () => {
    expect(
      listAttachmentsQuerySchema.safeParse({ scope: "office", folder: "tasks" })
        .success,
    ).toBe(true);
  });
  it("strips an unrelated query param (not .strict())", () => {
    const r = listAttachmentsQuerySchema.safeParse({
      scope: "task",
      taskId: "11111111-1111-4111-8111-111111111111",
      utm_source: "x",
    });
    expect(r.success).toBe(true);
  });
});
