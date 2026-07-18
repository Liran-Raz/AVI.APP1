import { notFound } from "next/navigation";

import { LedgerSettings } from "@/components/invoicing/ledger-settings";
import { isInvoicingUiEnabled } from "@/server/auth/invoicing.flags";
import { can } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import * as ledgersService from "@/server/services/ledgers.service";

// פרטי העסק (DEV-026) — the ledger business-profile settings, under the
// invoicing area (/invoicing/settings). Same gates as the documents screen:
// the INVOICING_UI flag (404 when off) + invoices.view; edits re-checked
// server-side by ledgers.manage (owner-only). The rendered header lives in
// the client component (LedgerSettings) so its strings go through useT.
export default async function InvoicingSettingsPage() {
  if (!isInvoicingUiEnabled()) notFound();

  const session = await requireSession();
  if (!can(session, PERMISSIONS.INVOICES_VIEW)) notFound();

  const ledger = await ledgersService.getSelfLedger(session);
  const canManage = can(session, PERMISSIONS.LEDGERS_MANAGE);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      <LedgerSettings initial={ledger} canManage={canManage} />
    </div>
  );
}
