import { notFound } from "next/navigation";

import { DocumentView } from "@/components/invoicing/document-view";
import { isInvoicingUiEnabled } from "@/server/auth/invoicing.flags";
import { can, resolveCapabilities } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors/app-error";
import * as clientsService from "@/server/services/clients.service";
import * as documentsService from "@/server/services/documents.service";
import * as ledgersService from "@/server/services/ledgers.service";

// תצוגת מסמך (DEV-026 R2) — full document with the lifecycle actions.
export default async function DocumentViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isInvoicingUiEnabled()) notFound();

  const session = await requireSession();
  if (!can(session, PERMISSIONS.INVOICES_VIEW)) notFound();

  const { id } = await params;

  let doc;
  try {
    doc = await documentsService.getDocument(session, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const [ledger, vatRates, clients] = await Promise.all([
    ledgersService.getSelfLedger(session),
    documentsService.listVatRates(session),
    clientsService.listClients(session, {
      status: "active",
      limit: 200,
      offset: 0,
    }),
  ]);

  return (
    <DocumentView
      initialDoc={doc}
      ledger={ledger}
      vatRates={vatRates}
      clients={clients.items.map((c) => ({ id: c.id, name: c.name }))}
      capabilities={resolveCapabilities(session)}
    />
  );
}
