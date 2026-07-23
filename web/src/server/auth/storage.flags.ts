import "server-only";

// Feature flag for the DEV-032 encrypted-attachments module. DISABLED by
// default (enabled only for the exact value "1"); missing/any other value =>
// off. Mirrors invoicing.flags.ts.
//
//   STORAGE_UI — render the storage nav entry + the attachments UI (client tab,
//   task edit-dialog section, office-library page).
//
// IMPORTANT — the flag is NOT the security boundary. It gates only the app
// routes/UI. The data boundary lives in the DATABASE (migration 0031): RLS
// org-scoping on attachments, the fail-closed encryption_keys table, INSERT
// only via create_attachment(), and the immutability trigger. Encryption
// itself runs in the service via the KMS/local key provider. The service layer
// additionally re-checks permissions (attachments.* keys).

export const STORAGE_UI_ENV = "STORAGE_UI";

export function isStorageUiEnabled(): boolean {
  return process.env[STORAGE_UI_ENV] === "1";
}
