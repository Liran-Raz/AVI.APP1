"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Ban,
  Download,
  FileMinus2,
  Loader2,
  Pencil,
  Printer,
  Stamp,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveModal } from "@/components/messages/responsive-modal";
import {
  ApiError,
  apiClient,
  type DocumentDTO,
  type LedgerDTO,
  type VatRateDTO,
} from "@/lib/api-client";
import { formatAgorot } from "@/lib/money";
import { hasCapability, PERMISSIONS, type Capability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";
import { DOC_STATUS_BADGE } from "./labels";
import { DocumentWizard, type WizardClient } from "./document-wizard";

// תצוגת מסמך (DEV-026 R2) — snapshot header, lines/payments, totals, and the
// lifecycle actions (issue / edit / delete drafts; cancel / credit issued).
// PDF + "מקור"/"העתק" printing arrive in R3 — until then the on-screen view
// is a preview, not a legal original.

export function DocumentView({
  initialDoc,
  ledger,
  vatRates,
  clients,
  capabilities,
}: {
  initialDoc: DocumentDTO;
  ledger: LedgerDTO;
  vatRates: VatRateDTO[];
  clients: WizardClient[];
  capabilities: Capability[];
}) {
  const t = useT();
  const localeTag = intlLocale(useLocale());
  const router = useRouter();
  const [doc, setDoc] = useState(initialDoc);
  const [busy, setBusy] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const canIssue = hasCapability(capabilities, PERMISSIONS.INVOICES_ISSUE);
  const canCancel = hasCapability(capabilities, PERMISSIONS.INVOICES_CANCEL);
  const canCredit = hasCapability(capabilities, PERMISSIONS.INVOICES_CREDIT);
  const canCreate = hasCapability(capabilities, PERMISSIONS.INVOICES_CREATE);
  const canSend = hasCapability(capabilities, PERMISSIONS.INVOICES_SEND);

  // The מקור (original) is deliverable once, by a sender, on a live document.
  const canDeliverOriginal =
    canSend && doc.status === "issued" && doc.deliveredAt === null;

  function pdfUrl(copy: "original" | "copy"): string {
    return `/api/documents/${doc.id}/pdf?copy=${copy}`;
  }

  async function openPdf(copy: "original" | "copy", forPrint: boolean) {
    setBusy(forPrint ? "print" : "pdf");
    try {
      const res = await fetch(pdfUrl(copy));
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error?.message ?? t("invoicing.view.pdfFailed"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (forPrint && win) win.addEventListener("load", () => win.print());
      // Give the tab time to load before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (copy === "original") await reload(); // reflect delivered state
    } catch {
      toast.error(t("invoicing.view.pdfError"));
    } finally {
      setBusy(null);
    }
  }

  async function reload() {
    try {
      setDoc(await apiClient.documents.get(doc.id));
    } catch {
      router.refresh();
    }
  }

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setBusy(null);
    }
  }

  const isDraft = doc.status === "draft";
  const isIssued = doc.status === "issued";

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-3xl space-y-5">
      <div>
        <Link href="/invoicing" className="text-sm text-primary hover:underline">
          {t("invoicing.backToDocuments")}
        </Link>
      </div>

      {/* Header */}
      <div className="border border-border rounded-lg glass-card shadow-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold">
              {t(`docType.${doc.docType}` as MessageKey)}{" "}
              {doc.number !== null && (
                <span className="font-mono text-base">#{doc.number}</span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("invoicing.view.datePrefix", { date: formatDocDate(doc.docDate) })}
              {doc.issuedAt &&
                t("invoicing.view.issuedPrefix", {
                  datetime: new Date(doc.issuedAt).toLocaleString(localeTag, {
                    dateStyle: "short",
                    timeStyle: "short",
                  }),
                })}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex rounded-full px-3 py-1 text-xs font-medium",
              DOC_STATUS_BADGE[doc.status],
            )}
          >
            {t(`docStatus.${doc.status}` as MessageKey)}
          </span>
        </div>

        {doc.status === "cancelled" && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {t("invoicing.view.cancelledBanner")}
            {doc.cancelReason ? ` — ${doc.cancelReason}` : ""}
            {t("invoicing.view.cancelledBannerSuffix")}
          </div>
        )}
        {doc.baseDocumentId && (
          <p className="mt-3 text-sm">
            <span className="text-muted-foreground">
              {t("invoicing.view.creditFor")}
            </span>
            <Link
              href={`/invoicing/documents/${doc.baseDocumentId}`}
              className="text-primary hover:underline font-medium"
            >
              {doc.baseDocumentType
                ? t(`docType.${doc.baseDocumentType}` as MessageKey)
                : t("invoicing.view.originalDocument")}
              {doc.baseDocumentNumber !== null && (
                <span className="font-mono"> #{doc.baseDocumentNumber}</span>
              )}
            </Link>
          </p>
        )}

        {/* Parties */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-1">
              {t("invoicing.view.from")}
            </p>
            <p className="font-medium">
              {doc.sellerLegalName ?? ledger.legalName}
            </p>
            <p className="text-muted-foreground" dir="ltr">
              {doc.sellerBusinessId ?? ledger.businessId ?? ""}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">
              {t("invoicing.view.to")}
            </p>
            <p className="font-medium">{doc.buyerName ?? "—"}</p>
            {doc.buyerTaxId && (
              <p className="text-muted-foreground" dir="ltr">
                {doc.buyerTaxId}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Lines */}
      {doc.lines.length > 0 && (
        <div className="border border-border rounded-lg glass-card shadow-card overflow-hidden">
          <div className="grid grid-cols-[1fr_70px_110px_110px] gap-3 px-4 py-2.5 border-b border-border text-xs text-muted-foreground">
            <span>{t("invoicing.view.table.description")}</span>
            <span>{t("invoicing.view.table.quantity")}</span>
            <span>{t("invoicing.view.table.price")}</span>
            <span>{t("invoicing.view.table.total")}</span>
          </div>
          {doc.lines.map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-[1fr_70px_110px_110px] gap-3 px-4 py-3 border-b border-border last:border-b-0 text-sm items-center"
            >
              <span>{l.description}</span>
              <span dir="ltr">{l.quantity}</span>
              <span dir="ltr">{formatAgorot(l.unitPrice, localeTag)}</span>
              <span dir="ltr" className="font-medium">
                {formatAgorot(l.lineTotal, localeTag)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Payments */}
      {doc.payments.length > 0 && (
        <div className="border border-border rounded-lg glass-card shadow-card overflow-hidden">
          <div className="grid grid-cols-[1fr_130px_110px] gap-3 px-4 py-2.5 border-b border-border text-xs text-muted-foreground">
            <span>{t("invoicing.view.table.paymentMethod")}</span>
            <span>{t("invoicing.view.table.dueDate")}</span>
            <span>{t("invoicing.view.table.amount")}</span>
          </div>
          {doc.payments.map((p) => (
            <div
              key={p.id}
              className="grid grid-cols-[1fr_130px_110px] gap-3 px-4 py-3 border-b border-border last:border-b-0 text-sm items-center"
            >
              <span>
                {p.method >= 1 && p.method <= 9
                  ? t(`paymentMethod.${p.method}` as MessageKey)
                  : p.method}
                {p.chequeNo && (
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {" "}
                    ({p.bankNo}/{p.branchNo}/{p.accountNo} #{p.chequeNo})
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">
                {p.dueDate ? formatDocDate(p.dueDate) : "—"}
              </span>
              <span dir="ltr" className="font-medium">
                {formatAgorot(p.amount, localeTag)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Totals */}
      <div className="border border-border rounded-lg glass-card shadow-card p-5 text-sm space-y-1 max-w-sm ms-auto">
        {(doc.docType === "305" || doc.docType === "320" || doc.docType === "330") && (
          <>
            <TotalRow
              label={t("invoicing.totals.beforeVat")}
              value={formatAgorot(doc.netAmount, localeTag)}
            />
            <TotalRow
              label={`${t("invoicing.totals.vat")}${doc.vatRateBp !== null ? ` ${doc.vatRateBp / 100}%` : ""}`}
              value={formatAgorot(doc.vatAmount, localeTag)}
            />
          </>
        )}
        <div className="border-t border-border pt-1 mt-1">
          <TotalRow
            label={t("invoicing.totals.total")}
            value={formatAgorot(doc.totalAmount, localeTag)}
            bold
          />
        </div>
        {doc.withholdingAmount > 0 && (
          <TotalRow
            label={t("invoicing.totals.withholding")}
            value={formatAgorot(doc.withholdingAmount, localeTag)}
          />
        )}
        {doc.status === "draft" && (
          <p className="text-xs text-muted-foreground pt-1">
            {t("invoicing.view.draftAmountsNote")}
          </p>
        )}
      </div>

      {doc.notes && (
        <p className="text-sm text-muted-foreground border border-border rounded-lg p-4">
          {doc.notes}
        </p>
      )}

      {/* PDF (issued/cancelled only) */}
      {!isDraft && (
        <div className="flex flex-wrap gap-2 items-center">
          {canDeliverOriginal ? (
            <Button
              onClick={() => void openPdf("original", false)}
              disabled={busy !== null}
            >
              {busy === "pdf" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {t("invoicing.view.downloadOriginal")}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => void openPdf("copy", false)}
              disabled={busy !== null}
            >
              {busy === "pdf" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {t("invoicing.view.downloadCopy")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() =>
              void openPdf(canDeliverOriginal ? "original" : "copy", true)
            }
            disabled={busy !== null}
          >
            {busy === "print" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Printer className="size-4" />
            )}
            {t("invoicing.view.print")}
          </Button>
          {doc.deliveredAt && (
            <span className="text-xs text-muted-foreground">
              {t("invoicing.view.deliveredHint")}
            </span>
          )}
        </div>
      )}

      {/* Lifecycle actions */}
      <div className="flex flex-wrap gap-2">
        {isDraft && canIssue && (
          <Button
            onClick={() =>
              run("issue", async () => {
                const res = await apiClient.documents.issue(doc.id);
                toast.success(
                  t("invoicing.view.issuedToast", { number: res.number }),
                );
                await reload();
              })
            }
            disabled={busy !== null || !ledger.issueReady}
            title={
              ledger.issueReady ? undefined : t("invoicing.completeBusinessFirst")
            }
          >
            {busy === "issue" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Stamp className="size-4" />
            )}
            {t("invoicing.view.issue")}
          </Button>
        )}
        {isDraft && canCreate && (
          <>
            <Button
              variant="outline"
              onClick={() => setEditOpen(true)}
              disabled={busy !== null}
            >
              <Pencil className="size-4" />
              {t("common.edit")}
            </Button>
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() =>
                run("delete", async () => {
                  await apiClient.documents.remove(doc.id);
                  toast.success(t("invoicing.view.draftDeleted"));
                  router.push("/invoicing");
                })
              }
              disabled={busy !== null}
            >
              {busy === "delete" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {t("common.delete")}
            </Button>
          </>
        )}
        {isIssued && canCancel && doc.deliveredAt === null && (
          <Button
            variant="outline"
            className="text-destructive"
            onClick={() => setCancelOpen(true)}
            disabled={busy !== null}
          >
            <Ban className="size-4" />
            {t("invoicing.view.cancelDocument")}
          </Button>
        )}
        {isIssued && canCredit && (doc.docType === "305" || doc.docType === "320") && (
          <Button
            variant="outline"
            onClick={() =>
              run("credit", async () => {
                const res = await apiClient.documents.credit(doc.id);
                toast.success(t("invoicing.view.creditDraftCreated"));
                router.push(`/invoicing/documents/${res.id}`);
              })
            }
            disabled={busy !== null}
          >
            {busy === "credit" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileMinus2 className="size-4" />
            )}
            {t("invoicing.view.createCredit")}
          </Button>
        )}
      </div>

      {/* Edit wizard (drafts) */}
      <DocumentWizard
        open={editOpen}
        onOpenChange={setEditOpen}
        ledger={ledger}
        vatRates={vatRates}
        clients={clients}
        canIssue={canIssue}
        editDoc={doc}
        onSaved={(docId, issued) => {
          setEditOpen(false);
          if (issued) toast.success(t("invoicing.toasts.issued"));
          if (docId === doc.id) void reload();
          else router.push(`/invoicing/documents/${docId}`);
        }}
      />

      {/* Cancel dialog */}
      <ResponsiveModal
        open={cancelOpen}
        onOpenChange={(o) => busy === null && setCancelOpen(o)}
        title={t("invoicing.view.cancelDocument")}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("invoicing.view.cancelDialogBody")}
          </p>
          <div className="space-y-2">
            <Label htmlFor="cancelReason">
              {t("invoicing.view.cancelReasonLabel")}
            </Label>
            <Input
              id="cancelReason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              maxLength={300}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={busy !== null || cancelReason.trim().length === 0}
              onClick={() =>
                run("cancel", async () => {
                  await apiClient.documents.cancel(doc.id, {
                    reason: cancelReason.trim(),
                  });
                  toast.success(t("invoicing.view.cancelledToast"));
                  setCancelOpen(false);
                  await reload();
                })
              }
            >
              {busy === "cancel" && <Loader2 className="size-4 animate-spin" />}
              {t("invoicing.view.confirmCancel")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={busy !== null}
            >
              {t("invoicing.view.back")}
            </Button>
          </div>
        </div>
      </ResponsiveModal>
    </div>
  );
}

function TotalRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "font-semibold" : "text-muted-foreground"}>
        {label}
      </span>
      <span className={bold ? "font-semibold" : ""} dir="ltr">
        {value}
      </span>
    </div>
  );
}

// dd.mm.yyyy — locale-neutral digits-only display, kept identical in every
// UI language.
function formatDocDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
