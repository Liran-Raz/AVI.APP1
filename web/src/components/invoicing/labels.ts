// Badge styles + numeric display helpers for the invoicing domain (DEV-026).
// The user-facing labels (doc types, statuses, payment methods) live in the
// i18n catalogs (docType.* / docStatus.* / paymentMethod.*) and are rendered
// via t() in the consumer components.

import type { DocumentSummaryDTO } from "@/lib/api-client";

// Chip classes reuse the existing status palette (globals.css tokens).
export const DOC_STATUS_BADGE: Record<DocumentSummaryDTO["status"], string> = {
  draft: "bg-status-received/15 text-status-received",
  issued: "bg-status-done/15 text-status-done",
  cancelled: "bg-destructive/10 text-destructive",
};

/** Display id: issued docs show their legal number, drafts show a dash. */
export function formatDocNumber(doc: {
  number: number | null;
  status: DocumentSummaryDTO["status"];
}): string {
  return doc.number !== null ? `#${doc.number}` : "—";
}
