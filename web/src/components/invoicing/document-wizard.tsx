"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResponsiveModal } from "@/components/messages/responsive-modal";
import {
  ApiError,
  apiClient,
  type CreateDocumentPayload,
  type DocumentDTO,
  type DocumentLinePayload,
  type DocumentPaymentPayload,
  type LedgerDTO,
  type VatRateDTO,
} from "@/lib/api-client";
import {
  agorotToInputValue,
  computeLineTotalAgorot,
  computeVatAgorot,
  formatAgorot,
  parseSheqelToAgorot,
} from "@/lib/money";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";

// אשף מסמך (DEV-026 R2) — create/edit a DRAFT, optionally issue immediately.
// All ₪ inputs are kept as STRINGS and parsed with the string-safe money
// helpers on save (no float math near tax amounts). The DB RPC recomputes
// all totals authoritatively at issue time — the numbers here are a preview.

export type WizardClient = { id: string; name: string };

type LineRow = {
  description: string;
  quantity: string;
  unitPrice: string; // ₪
  lineDiscount: string; // ₪
};

type PaymentRow = {
  method: string; // "1".."9"
  amount: string; // ₪
  dueDate: string;
  bankNo: string;
  branchNo: string;
  accountNo: string;
  chequeNo: string;
};

const EMPTY_LINE: LineRow = {
  description: "",
  quantity: "1",
  unitPrice: "",
  lineDiscount: "",
};
const EMPTY_PAYMENT: PaymentRow = {
  method: "4",
  amount: "",
  dueDate: "",
  bankNo: "",
  branchNo: "",
  accountNo: "",
  chequeNo: "",
};

const CREATABLE_TYPES = ["305", "320", "400", "330"] as const;
type CreatableType = (typeof CREATABLE_TYPES)[number];

// Payment-method codes per מבנה אחיד D120 field 1306 (labels: paymentMethod.*).
const PAYMENT_METHOD_CODES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
] as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DocumentWizard({
  open,
  onOpenChange,
  ledger,
  vatRates,
  clients,
  canIssue,
  onSaved,
  editDoc,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ledger: LedgerDTO;
  vatRates: VatRateDTO[];
  clients: WizardClient[];
  canIssue: boolean;
  onSaved: (docId: string, issued: boolean) => void;
  /** When present the wizard edits this DRAFT instead of creating. */
  editDoc?: DocumentDTO;
}) {
  const t = useT();
  // The form mounts fresh on every open (and per edited doc) — state seeds in
  // the useState initializers below, no effects, no stale carry-over.
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={editDoc ? t("invoicing.wizard.editTitle") : t("invoicing.newDocument")}
    >
      {open && (
        <WizardForm
          key={editDoc?.id ?? "new"}
          ledger={ledger}
          vatRates={vatRates}
          clients={clients}
          canIssue={canIssue}
          onSaved={onSaved}
          editDoc={editDoc}
        />
      )}
    </ResponsiveModal>
  );
}

function WizardForm({
  ledger,
  vatRates,
  clients,
  canIssue,
  onSaved,
  editDoc,
}: {
  ledger: LedgerDTO;
  vatRates: VatRateDTO[];
  clients: WizardClient[];
  canIssue: boolean;
  onSaved: (docId: string, issued: boolean) => void;
  editDoc?: DocumentDTO;
}) {
  const t = useT();
  const localeTag = intlLocale(useLocale());
  const isEdit = Boolean(editDoc);
  const [docType, setDocType] = useState<CreatableType>(() =>
    editDoc && (CREATABLE_TYPES as readonly string[]).includes(editDoc.docType)
      ? (editDoc.docType as CreatableType)
      : "305",
  );
  const [clientId, setClientId] = useState<string>(editDoc?.clientId ?? "");
  const [buyerName, setBuyerName] = useState(
    editDoc && !editDoc.clientId ? (editDoc.buyerName ?? "") : "",
  );
  const [docDate, setDocDate] = useState(editDoc?.docDate ?? today());
  const [notes, setNotes] = useState(editDoc?.notes ?? "");
  const [withholding, setWithholding] = useState(
    editDoc && editDoc.withholdingAmount > 0
      ? agorotToInputValue(editDoc.withholdingAmount)
      : "",
  );
  const [lines, setLines] = useState<LineRow[]>(() =>
    editDoc && editDoc.lines.length > 0
      ? editDoc.lines.map((l) => ({
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: agorotToInputValue(l.unitPrice),
          lineDiscount:
            l.lineDiscount > 0 ? agorotToInputValue(l.lineDiscount) : "",
        }))
      : [{ ...EMPTY_LINE }],
  );
  const [payments, setPayments] = useState<PaymentRow[]>(() =>
    editDoc && editDoc.payments.length > 0
      ? editDoc.payments.map((p) => ({
          method: String(p.method),
          amount: agorotToInputValue(p.amount),
          dueDate: p.dueDate ?? "",
          bankNo: p.bankNo ?? "",
          branchNo: p.branchNo ?? "",
          accountNo: p.accountNo ?? "",
          chequeNo: p.chequeNo ?? "",
        }))
      : [{ ...EMPTY_PAYMENT }],
  );
  const [saving, setSaving] = useState(false);

  const hasLines =
    docType === "305" || docType === "320" || docType === "330";
  const hasPayments = docType === "320" || docType === "400";

  // ---- live totals preview (mirrors the DB math) ----
  const vatRateBp = useMemo(() => {
    if (docType === "400" || ledger.businessType === "patur") return 0;
    const applicable = vatRates
      .filter(
        (r) =>
          docDate >= r.effectiveFrom &&
          (r.effectiveTo === null || docDate <= r.effectiveTo),
      )
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
    return applicable[0]?.rateBp ?? 0;
  }, [docType, ledger.businessType, vatRates, docDate]);

  const linesTotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const qty = Number(l.quantity);
        const price = parseSheqelToAgorot(l.unitPrice) ?? 0;
        const disc = l.lineDiscount ? (parseSheqelToAgorot(l.lineDiscount) ?? 0) : 0;
        if (!Number.isFinite(qty) || qty <= 0 || price === 0) return sum;
        return sum + computeLineTotalAgorot(qty, price, disc);
      }, 0),
    [lines],
  );

  const paymentsTotal = useMemo(
    () =>
      payments.reduce(
        (sum, p) => sum + (parseSheqelToAgorot(p.amount) ?? 0),
        0,
      ),
    [payments],
  );

  const net = hasLines ? linesTotal : paymentsTotal;
  const vat = hasLines ? computeVatAgorot(net, vatRateBp) : 0;
  const total = net + vat;

  // ---- build + validate the payload ----
  function buildPayload(): CreateDocumentPayload | null {
    if (!clientId && !buyerName.trim()) {
      toast.error(t("invoicing.wizard.buyerRequired"));
      return null;
    }

    const parsedLines: DocumentLinePayload[] = [];
    if (hasLines) {
      for (const [i, l] of lines.entries()) {
        const isEmpty =
          !l.description.trim() && !l.unitPrice.trim() && l.quantity === "1";
        if (isEmpty && lines.length > 1) continue; // skip trailing blank rows
        if (!l.description.trim()) {
          toast.error(t("invoicing.wizard.lineMissingDescription", { line: i + 1 }));
          return null;
        }
        const qty = Number(l.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          toast.error(t("invoicing.wizard.lineInvalidQuantity", { line: i + 1 }));
          return null;
        }
        const price = parseSheqelToAgorot(l.unitPrice);
        if (price === null) {
          toast.error(t("invoicing.wizard.lineInvalidPrice", { line: i + 1 }));
          return null;
        }
        const disc = l.lineDiscount.trim()
          ? parseSheqelToAgorot(l.lineDiscount)
          : 0;
        if (disc === null) {
          toast.error(t("invoicing.wizard.lineInvalidDiscount", { line: i + 1 }));
          return null;
        }
        if (computeLineTotalAgorot(qty, price, disc) < 0) {
          toast.error(t("invoicing.wizard.lineDiscountTooBig", { line: i + 1 }));
          return null;
        }
        parsedLines.push({
          description: l.description.trim(),
          quantity: qty,
          unitPrice: price,
          lineDiscount: disc,
        });
      }
      if (parsedLines.length === 0) {
        toast.error(t("invoicing.wizard.linesRequired"));
        return null;
      }
    }

    const parsedPayments: DocumentPaymentPayload[] = [];
    if (hasPayments) {
      for (const [i, p] of payments.entries()) {
        const isEmpty = !p.amount.trim();
        if (isEmpty && payments.length > 1) continue;
        const amount = parseSheqelToAgorot(p.amount);
        if (amount === null || amount === 0) {
          toast.error(t("invoicing.wizard.paymentInvalidAmount", { payment: i + 1 }));
          return null;
        }
        const method = Number(p.method);
        if (method === 2 && !(p.bankNo && p.branchNo && p.accountNo && p.chequeNo)) {
          toast.error(t("invoicing.wizard.paymentChequeFields", { payment: i + 1 }));
          return null;
        }
        parsedPayments.push({
          method,
          amount,
          dueDate: p.dueDate || null,
          bankNo: p.bankNo || null,
          branchNo: p.branchNo || null,
          accountNo: p.accountNo || null,
          chequeNo: p.chequeNo || null,
          cardCompany: null,
          cardTxType: null,
          reference: null,
        });
      }
      if (parsedPayments.length === 0) {
        toast.error(t("invoicing.wizard.paymentsRequired"));
        return null;
      }
    }

    let withholdingAgorot = 0;
    if (withholding.trim()) {
      const w = parseSheqelToAgorot(withholding);
      if (w === null) {
        toast.error(t("invoicing.wizard.invalidWithholding"));
        return null;
      }
      withholdingAgorot = w;
    }

    return {
      ledgerId: ledger.id,
      docType,
      clientId: clientId || null,
      buyerName: clientId ? undefined : buyerName.trim(),
      docDate,
      valueDate: undefined,
      notes: notes.trim() ? notes.trim() : undefined,
      discount: 0,
      withholding: withholdingAgorot,
      lines: parsedLines,
      payments: parsedPayments,
    };
  }

  async function save(issueAfter: boolean) {
    const payload = buildPayload();
    if (!payload) return;

    if (issueAfter && docType === "320" && paymentsTotal !== total) {
      toast.error(
        t("invoicing.wizard.paymentsMismatch", {
          payments: formatAgorot(paymentsTotal, localeTag),
          total: formatAgorot(total, localeTag),
        }),
      );
      return;
    }

    setSaving(true);
    let docId: string | null = null;
    try {
      if (isEdit && editDoc) {
        const updated = await apiClient.documents.update(editDoc.id, {
          clientId: payload.clientId,
          buyerName: payload.buyerName,
          docDate: payload.docDate,
          notes: payload.notes ?? null,
          withholding: payload.withholding,
          lines: payload.lines,
          payments: payload.payments,
        });
        docId = updated.id;
      } else {
        const created = await apiClient.documents.create(payload);
        docId = created.id;
      }

      if (issueAfter) {
        await apiClient.documents.issue(docId);
        onSaved(docId, true);
      } else {
        onSaved(docId, false);
      }
    } catch (err) {
      if (docId && issueAfter) {
        // The draft was saved but issuing failed (e.g. business profile
        // incomplete) — land the user on the draft with the real reason.
        toast.error(
          err instanceof ApiError
            ? err.message
            : t("invoicing.wizard.savedButIssueFailed"),
        );
        onSaved(docId, false);
      } else if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
        {/* Type */}
        {!isEdit ? (
          <div className="space-y-2">
            <Label>{t("invoicing.wizard.docTypeLabel")}</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CREATABLE_TYPES.map((dt) => (
                <button
                  key={dt}
                  type="button"
                  onClick={() => setDocType(dt)}
                  className={
                    "rounded-lg border px-2 py-2 text-sm transition-colors " +
                    (docType === dt
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border hover:bg-accent/40")
                  }
                >
                  {t(`docType.${dt}` as MessageKey)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(`docType.${editDoc!.docType}` as MessageKey)}
          </p>
        )}

        {/* Buyer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("invoicing.wizard.clientLabel")}</Label>
            <Select
              value={clientId || "manual"}
              onValueChange={(v) => setClientId(v === "manual" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">
                  {t("invoicing.wizard.manualClient")}
                </SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {clientId === "" && (
            <div className="space-y-2">
              <Label htmlFor="wizBuyerName">
                {t("invoicing.wizard.buyerNameLabel")}
              </Label>
              <Input
                id="wizBuyerName"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                maxLength={50}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="wizDocDate">{t("invoicing.wizard.docDateLabel")}</Label>
            <Input
              id="wizDocDate"
              type="date"
              value={docDate}
              onChange={(e) => setDocDate(e.target.value)}
              dir="ltr"
            />
          </div>
        </div>

        {/* Lines */}
        {hasLines && (
          <div className="space-y-2">
            <Label>{t("invoicing.wizard.linesLabel")}</Label>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_70px_100px_100px_32px] gap-2 items-center"
                >
                  <Input
                    placeholder={t("invoicing.wizard.descriptionPlaceholder")}
                    value={l.description}
                    onChange={(e) =>
                      updateRow(setLines, i, { description: e.target.value })
                    }
                    maxLength={200}
                  />
                  <Input
                    placeholder={t("invoicing.wizard.quantityPlaceholder")}
                    value={l.quantity}
                    onChange={(e) =>
                      updateRow(setLines, i, { quantity: e.target.value })
                    }
                    dir="ltr"
                    inputMode="decimal"
                  />
                  <Input
                    placeholder={t("invoicing.wizard.pricePlaceholder")}
                    value={l.unitPrice}
                    onChange={(e) =>
                      updateRow(setLines, i, { unitPrice: e.target.value })
                    }
                    dir="ltr"
                    inputMode="decimal"
                  />
                  <Input
                    placeholder={t("invoicing.wizard.discountPlaceholder")}
                    value={l.lineDiscount}
                    onChange={(e) =>
                      updateRow(setLines, i, { lineDiscount: e.target.value })
                    }
                    dir="ltr"
                    inputMode="decimal"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setLines((rows) =>
                        rows.length > 1 ? rows.filter((_, j) => j !== i) : rows,
                      )
                    }
                    aria-label={t("invoicing.wizard.removeLineAria")}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((rows) => [...rows, { ...EMPTY_LINE }])}
            >
              <Plus className="size-4" />
              {t("invoicing.wizard.addLine")}
            </Button>
          </div>
        )}

        {/* Payments */}
        {hasPayments && (
          <div className="space-y-2">
            <Label>{t("invoicing.wizard.paymentsLabel")}</Label>
            <div className="space-y-3">
              {payments.map((p, i) => (
                <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="grid grid-cols-[1fr_110px_130px_32px] gap-2 items-center">
                    <Select
                      value={p.method}
                      onValueChange={(v) => updateRow(setPayments, i, { method: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHOD_CODES.map((k) => (
                          <SelectItem key={k} value={k}>
                            {t(`paymentMethod.${k}` as MessageKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder={t("invoicing.wizard.amountPlaceholder")}
                      value={p.amount}
                      onChange={(e) =>
                        updateRow(setPayments, i, { amount: e.target.value })
                      }
                      dir="ltr"
                      inputMode="decimal"
                    />
                    <Input
                      type="date"
                      value={p.dueDate}
                      onChange={(e) =>
                        updateRow(setPayments, i, { dueDate: e.target.value })
                      }
                      dir="ltr"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setPayments((rows) =>
                          rows.length > 1 ? rows.filter((_, j) => j !== i) : rows,
                        )
                      }
                      aria-label={t("invoicing.wizard.removePaymentAria")}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {p.method === "2" && (
                    <div className="grid grid-cols-4 gap-2">
                      <Input
                        placeholder={t("invoicing.wizard.bankPlaceholder")}
                        value={p.bankNo}
                        onChange={(e) =>
                          updateRow(setPayments, i, { bankNo: e.target.value })
                        }
                        dir="ltr"
                        inputMode="numeric"
                      />
                      <Input
                        placeholder={t("invoicing.wizard.branchPlaceholder")}
                        value={p.branchNo}
                        onChange={(e) =>
                          updateRow(setPayments, i, { branchNo: e.target.value })
                        }
                        dir="ltr"
                        inputMode="numeric"
                      />
                      <Input
                        placeholder={t("invoicing.wizard.accountPlaceholder")}
                        value={p.accountNo}
                        onChange={(e) =>
                          updateRow(setPayments, i, { accountNo: e.target.value })
                        }
                        dir="ltr"
                        inputMode="numeric"
                      />
                      <Input
                        placeholder={t("invoicing.wizard.chequeNoPlaceholder")}
                        value={p.chequeNo}
                        onChange={(e) =>
                          updateRow(setPayments, i, { chequeNo: e.target.value })
                        }
                        dir="ltr"
                        inputMode="numeric"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPayments((rows) => [...rows, { ...EMPTY_PAYMENT }])
              }
            >
              <Plus className="size-4" />
              {t("invoicing.wizard.addPayment")}
            </Button>
          </div>
        )}

        {/* Withholding (receipts) */}
        {hasPayments && (
          <div className="space-y-2 max-w-[200px]">
            <Label htmlFor="wizWithholding">
              {t("invoicing.wizard.withholdingLabel")}
            </Label>
            <Input
              id="wizWithholding"
              value={withholding}
              onChange={(e) => setWithholding(e.target.value)}
              dir="ltr"
              inputMode="decimal"
            />
          </div>
        )}

        {/* Notes */}
        <div className="space-y-2">
          <Label htmlFor="wizNotes">{t("invoicing.wizard.notesLabel")}</Label>
          <Input
            id="wizNotes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
          />
        </div>

        {/* Totals preview */}
        <div className="rounded-lg border border-border bg-card p-4 text-sm space-y-1">
          {hasLines && (
            <>
              <Row
                label={t("invoicing.totals.beforeVat")}
                value={formatAgorot(net, localeTag)}
              />
              <Row
                label={
                  t("invoicing.totals.vatWithRate", { rate: vatRateBp / 100 }) +
                  (ledger.businessType === "patur"
                    ? t("invoicing.totals.paturSuffix")
                    : "")
                }
                value={formatAgorot(vat, localeTag)}
              />
            </>
          )}
          {hasPayments && !hasLines && (
            <Row
              label={t("invoicing.totals.paymentsTotal")}
              value={formatAgorot(paymentsTotal, localeTag)}
            />
          )}
          <div className="border-t border-border pt-1 mt-1">
            <Row
              label={t("invoicing.totals.total")}
              value={formatAgorot(total, localeTag)}
              bold
            />
          </div>
          {docType === "320" && paymentsTotal !== total && (
            <p className="text-xs text-status-received pt-1">
              {t("invoicing.wizard.mismatchWarning", {
                payments: formatAgorot(paymentsTotal, localeTag),
              })}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 justify-start pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => void save(false)}
            disabled={saving}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t("invoicing.wizard.saveDraft")}
          </Button>
          {canIssue && (
            <Button
              type="button"
              onClick={() => void save(true)}
              disabled={saving || !ledger.issueReady}
              title={
                ledger.issueReady
                  ? undefined
                  : t("invoicing.completeBusinessFirst")
              }
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t("invoicing.wizard.saveAndIssue")}
            </Button>
          )}
      </div>
    </div>
  );
}

function Row({
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

function updateRow<T>(
  set: React.Dispatch<React.SetStateAction<T[]>>,
  index: number,
  patch: Partial<T>,
) {
  set((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
}
