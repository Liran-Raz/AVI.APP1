import "server-only";

// Feature flag for the DEV-026 invoicing module (הנהלת חשבונות + דוחות).
// DISABLED by default (enabled only for the exact value "1"); missing/any
// other value => off. Mirrors role-management.flags.ts.
//
//   INVOICING_UI — render the invoicing + reports nav entries and pages.
//
// IMPORTANT — the flag is NOT the security boundary. It gates only the app
// routes/UI. The data boundary lives in the DATABASE (migration 0027): RLS
// org-scoping on ledgers/documents, fail-closed counters, and the legal state
// transitions locked behind SECURITY DEFINER RPCs + immutability triggers.
// The service layer additionally re-checks permissions (invoices.* keys).

export const INVOICING_UI_ENV = "INVOICING_UI";

export function isInvoicingUiEnabled(): boolean {
  return process.env[INVOICING_UI_ENV] === "1";
}
