import { notFound } from "next/navigation";

import { ReportsPage } from "@/components/reports/reports-page";
import { isInvoicingUiEnabled } from "@/server/auth/invoicing.flags";
import { can, resolveCapabilities } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";

// דוחות (DEV-026 R4) — the reports screen: doc-type summary, sales/receipts
// books, VAT summary, client balances + the מבנה-אחיד export.
// Gate: INVOICING_UI flag (404 when off) + reports.view (owner/manager —
// employees 404, matching the hidden nav). Services re-check every permission;
// capabilities are passed down as display hints only.
export default async function ReportsRoutePage() {
  if (!isInvoicingUiEnabled()) notFound();

  const session = await requireSession();
  if (!can(session, PERMISSIONS.REPORTS_VIEW)) notFound();

  return (
    <ReportsPage
      officeName={session.organization.name}
      capabilities={resolveCapabilities(session)}
    />
  );
}
