// Hebrew labels + badge styles for the invoicing domain (DEV-026).
// Doc-type keys are the official מבנה-אחיד codes.

import type { DocumentSummaryDTO } from "@/lib/api-client";

export const DOC_TYPE_LABELS: Record<DocumentSummaryDTO["docType"], string> = {
  "305": "חשבונית מס",
  "320": "חשבונית מס-קבלה",
  "330": "חשבונית זיכוי",
  "400": "קבלה",
};

export const DOC_STATUS_LABELS: Record<DocumentSummaryDTO["status"], string> = {
  draft: "טיוטה",
  issued: "הופק",
  cancelled: "מבוטל",
};

// Chip classes reuse the existing status palette (globals.css tokens).
export const DOC_STATUS_BADGE: Record<DocumentSummaryDTO["status"], string> = {
  draft: "bg-status-received/15 text-status-received",
  issued: "bg-status-done/15 text-status-done",
  cancelled: "bg-destructive/10 text-destructive",
};

// Payment methods per מבנה אחיד D120 field 1306.
export const PAYMENT_METHOD_LABELS: Record<number, string> = {
  1: "מזומן",
  2: "המחאה",
  3: "כרטיס אשראי",
  4: "העברה בנקאית",
  5: "תווי קנייה",
  6: "תלוש החלפה",
  7: "שטר",
  8: "הוראת קבע",
  9: "אחר",
};

/** Display id: issued docs show their legal number, drafts show a dash. */
export function formatDocNumber(doc: {
  number: number | null;
  status: DocumentSummaryDTO["status"];
}): string {
  return doc.number !== null ? `#${doc.number}` : "—";
}
