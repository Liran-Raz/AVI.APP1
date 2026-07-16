"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, FileMinus2, Loader2, Pencil, Stamp, Trash2 } from "lucide-react";

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
import {
  DOC_STATUS_BADGE,
  DOC_STATUS_LABELS,
  DOC_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
} from "./labels";
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
        toast.error("שגיאה לא צפויה");
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
          → חזרה למסמכים
        </Link>
      </div>

      {/* Header */}
      <div className="border border-border rounded-lg glass-card shadow-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold">
              {DOC_TYPE_LABELS[doc.docType]}{" "}
              {doc.number !== null && (
                <span className="font-mono text-base">#{doc.number}</span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              תאריך: {formatHeDate(doc.docDate)}
              {doc.issuedAt &&
                ` · הופק: ${new Date(doc.issuedAt).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}`}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex rounded-full px-3 py-1 text-xs font-medium",
              DOC_STATUS_BADGE[doc.status],
            )}
          >
            {DOC_STATUS_LABELS[doc.status]}
          </span>
        </div>

        {doc.status === "cancelled" && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            המסמך בוטל
            {doc.cancelReason ? ` — ${doc.cancelReason}` : ""}. המספר נשמר
            ומדווח כמבוטל בייצוא.
          </div>
        )}
        {doc.baseDocumentId && (
          <p className="mt-3 text-sm">
            <span className="text-muted-foreground">זיכוי עבור </span>
            <Link
              href={`/invoicing/documents/${doc.baseDocumentId}`}
              className="text-primary hover:underline font-medium"
            >
              {doc.baseDocumentType
                ? DOC_TYPE_LABELS[doc.baseDocumentType]
                : "המסמך המקורי"}
              {doc.baseDocumentNumber !== null && (
                <span className="font-mono"> #{doc.baseDocumentNumber}</span>
              )}
            </Link>
          </p>
        )}

        {/* Parties */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-1">מאת</p>
            <p className="font-medium">
              {doc.sellerLegalName ?? ledger.legalName}
            </p>
            <p className="text-muted-foreground" dir="ltr">
              {doc.sellerBusinessId ?? ledger.businessId ?? ""}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">לכבוד</p>
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
            <span>תיאור</span>
            <span>כמות</span>
            <span>מחיר</span>
            <span>סה״כ</span>
          </div>
          {doc.lines.map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-[1fr_70px_110px_110px] gap-3 px-4 py-3 border-b border-border last:border-b-0 text-sm items-center"
            >
              <span>{l.description}</span>
              <span dir="ltr">{l.quantity}</span>
              <span dir="ltr">{formatAgorot(l.unitPrice)}</span>
              <span dir="ltr" className="font-medium">
                {formatAgorot(l.lineTotal)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Payments */}
      {doc.payments.length > 0 && (
        <div className="border border-border rounded-lg glass-card shadow-card overflow-hidden">
          <div className="grid grid-cols-[1fr_130px_110px] gap-3 px-4 py-2.5 border-b border-border text-xs text-muted-foreground">
            <span>אמצעי תשלום</span>
            <span>פירעון</span>
            <span>סכום</span>
          </div>
          {doc.payments.map((p) => (
            <div
              key={p.id}
              className="grid grid-cols-[1fr_130px_110px] gap-3 px-4 py-3 border-b border-border last:border-b-0 text-sm items-center"
            >
              <span>
                {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                {p.chequeNo && (
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {" "}
                    ({p.bankNo}/{p.branchNo}/{p.accountNo} #{p.chequeNo})
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">
                {p.dueDate ? formatHeDate(p.dueDate) : "—"}
              </span>
              <span dir="ltr" className="font-medium">
                {formatAgorot(p.amount)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Totals */}
      <div className="border border-border rounded-lg glass-card shadow-card p-5 text-sm space-y-1 max-w-sm mr-auto">
        {(doc.docType === "305" || doc.docType === "320" || doc.docType === "330") && (
          <>
            <TotalRow label='סה״כ לפני מע"מ' value={formatAgorot(doc.netAmount)} />
            <TotalRow
              label={`מע"מ${doc.vatRateBp !== null ? ` ${doc.vatRateBp / 100}%` : ""}`}
              value={formatAgorot(doc.vatAmount)}
            />
          </>
        )}
        <div className="border-t border-border pt-1 mt-1">
          <TotalRow label='סה״כ' value={formatAgorot(doc.totalAmount)} bold />
        </div>
        {doc.withholdingAmount > 0 && (
          <TotalRow
            label="ניכוי מס במקור"
            value={formatAgorot(doc.withholdingAmount)}
          />
        )}
        {doc.status === "draft" && (
          <p className="text-xs text-muted-foreground pt-1">
            טיוטה — הסכומים הסופיים מחושבים בהפקה.
          </p>
        )}
      </div>

      {doc.notes && (
        <p className="text-sm text-muted-foreground border border-border rounded-lg p-4">
          {doc.notes}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {isDraft && canIssue && (
          <Button
            onClick={() =>
              run("issue", async () => {
                const res = await apiClient.documents.issue(doc.id);
                toast.success(`המסמך הופק — מספר ${res.number}`);
                await reload();
              })
            }
            disabled={busy !== null || !ledger.issueReady}
            title={ledger.issueReady ? undefined : "השלימו את פרטי העסק לפני הפקה"}
          >
            {busy === "issue" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Stamp className="size-4" />
            )}
            הפקה
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
              עריכה
            </Button>
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() =>
                run("delete", async () => {
                  await apiClient.documents.remove(doc.id);
                  toast.success("הטיוטה נמחקה");
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
              מחיקה
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
            ביטול מסמך
          </Button>
        )}
        {isIssued && canCredit && (doc.docType === "305" || doc.docType === "320") && (
          <Button
            variant="outline"
            onClick={() =>
              run("credit", async () => {
                const res = await apiClient.documents.credit(doc.id);
                toast.success("נוצרה טיוטת זיכוי — בדקו והפיקו");
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
            יצירת זיכוי
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
          if (issued) toast.success("המסמך הופק בהצלחה");
          if (docId === doc.id) void reload();
          else router.push(`/invoicing/documents/${docId}`);
        }}
      />

      {/* Cancel dialog */}
      <ResponsiveModal
        open={cancelOpen}
        onOpenChange={(o) => busy === null && setCancelOpen(o)}
        title="ביטול מסמך"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            הביטול אפשרי רק כל עוד המסמך לא נמסר ללקוח. המספר נשמר והמסמך ידווח
            כמבוטל. אם המסמך כבר נמסר — יש להפיק חשבונית זיכוי במקום.
          </p>
          <div className="space-y-2">
            <Label htmlFor="cancelReason">סיבת הביטול *</Label>
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
                  toast.success("המסמך בוטל");
                  setCancelOpen(false);
                  await reload();
                })
              }
            >
              {busy === "cancel" && <Loader2 className="size-4 animate-spin" />}
              אישור ביטול
            </Button>
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={busy !== null}
            >
              חזרה
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

function formatHeDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
