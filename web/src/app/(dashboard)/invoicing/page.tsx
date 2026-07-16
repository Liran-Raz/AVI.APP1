import { notFound } from "next/navigation";

import { LedgerSettings } from "@/components/invoicing/ledger-settings";
import { isInvoicingUiEnabled } from "@/server/auth/invoicing.flags";
import { can } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import * as ledgersService from "@/server/services/ledgers.service";

// הנהלת חשבונות (DEV-026 R1) — the invoicing area shell. R1 ships the business
// profile (self-ledger) settings; the documents list/wizard arrive in R2.
//
// Access: the INVOICING_UI flag must be on (otherwise 404 — the feature does
// not exist as far as users are concerned) AND the viewer needs invoices.view.
// The service layer re-checks every permission; this is the display gate.
export default async function InvoicingPage() {
  if (!isInvoicingUiEnabled()) notFound();

  const session = await requireSession();
  if (!can(session, PERMISSIONS.INVOICES_VIEW)) notFound();

  const ledger = await ledgersService.getSelfLedger(session);
  const canManage = can(session, PERMISSIONS.LEDGERS_MANAGE);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">הנהלת חשבונות</h1>
        <p className="text-sm text-muted-foreground mt-1">
          ניהול מסמכי מס — חשבוניות, קבלות וזיכויים. בשלב זה: הגדרת פרטי העסק
          שיודפסו על המסמכים.
        </p>
      </div>

      <LedgerSettings initial={ledger} canManage={canManage} />
    </div>
  );
}
