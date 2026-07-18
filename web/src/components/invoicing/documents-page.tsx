"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilePlus2, Search, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ApiError,
  apiClient,
  type DocumentSummaryDTO,
  type LedgerDTO,
  type VatRateDTO,
} from "@/lib/api-client";
import { formatAgorot } from "@/lib/money";
import { hasCapability, PERMISSIONS, type Capability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";
import { DOC_STATUS_BADGE, formatDocNumber } from "./labels";
import { DocumentWizard, type WizardClient } from "./document-wizard";

// מסך המסמכים (DEV-026 R2): list + filters + the creation wizard.
// Desktop = table, mobile = cards (the clients-page dual-layout pattern).

type TypeFilter = "all" | "305" | "320" | "400" | "330";
type StatusFilter = "all" | "draft" | "issued" | "cancelled";

export function DocumentsPage({
  ledger,
  initialItems,
  vatRates,
  clients,
  capabilities,
}: {
  ledger: LedgerDTO;
  initialItems: DocumentSummaryDTO[];
  vatRates: VatRateDTO[];
  clients: WizardClient[];
  capabilities: Capability[];
}) {
  const t = useT();
  const localeTag = intlLocale(useLocale());
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const canCreate = hasCapability(capabilities, PERMISSIONS.INVOICES_CREATE);
  const canIssue = hasCapability(capabilities, PERMISSIONS.INVOICES_ISSUE);
  const canManageLedger = hasCapability(capabilities, PERMISSIONS.LEDGERS_MANAGE);

  async function refresh(
    type = typeFilter,
    status = statusFilter,
    term = search,
  ) {
    setLoading(true);
    try {
      const { items: next } = await apiClient.documents.list({
        docType: type === "all" ? undefined : type,
        status: status,
        search: term.trim() || undefined,
        limit: 50,
        offset: 0,
      });
      setItems(next);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error(t("invoicing.toasts.loadError"));
    } finally {
      setLoading(false);
    }
  }

  const emptyText = useMemo(() => {
    if (loading) return t("invoicing.loading");
    if (items.length === 0)
      return search || typeFilter !== "all" || statusFilter !== "all"
        ? t("invoicing.emptyFiltered")
        : t("invoicing.emptyNone");
    return null;
  }, [loading, items.length, search, typeFilter, statusFilter, t]);

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">{t("invoicing.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ledger.legalName}
            {ledger.businessId
              ? t("invoicing.businessIdSuffix", { id: ledger.businessId })
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManageLedger && (
            <Button variant="outline" asChild>
              <Link href="/invoicing/settings">
                <Settings2 className="size-4" />
                {t("invoicing.settings.title")}
              </Link>
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => setWizardOpen(true)}>
              <FilePlus2 className="size-4" />
              {t("invoicing.newDocument")}
            </Button>
          )}
        </div>
      </div>

      {/* Not-issue-ready banner */}
      {!ledger.issueReady && (
        <div className="mb-4 rounded-lg border border-status-received/30 bg-status-received/10 p-3 text-sm text-status-received">
          {t("invoicing.banner.beforeStrong")}
          <strong>{t("invoicing.banner.strong")}</strong>
          {t("invoicing.banner.afterStrong")}
          {canManageLedger ? " — " : t("invoicing.banner.ownerOnlySuffix")}
          {canManageLedger && (
            <Link href="/invoicing/settings" className="underline">
              {t("invoicing.banner.completeLink")}
            </Link>
          )}
          {t("invoicing.banner.draftsNote")}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void refresh();
            }}
            placeholder={t("invoicing.searchPlaceholder")}
            className="ps-9"
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(v) => {
            const next = v as TypeFilter;
            setTypeFilter(next);
            void refresh(next, statusFilter);
          }}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("invoicing.filters.allTypes")}</SelectItem>
            {(["305", "320", "400", "330"] as const).map((dt) => (
              <SelectItem key={dt} value={dt}>
                {t(`docType.${dt}` as MessageKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            const s = v as StatusFilter;
            setStatusFilter(s);
            void refresh(typeFilter, s);
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("invoicing.filters.allStatuses")}
            </SelectItem>
            <SelectItem value="draft">{t("invoicing.filters.drafts")}</SelectItem>
            <SelectItem value="issued">{t("invoicing.filters.issued")}</SelectItem>
            <SelectItem value="cancelled">
              {t("invoicing.filters.cancelled")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block border border-border rounded-lg glass-card shadow-card overflow-hidden">
        <div className="grid grid-cols-[90px_1.2fr_1.6fr_110px_130px_110px] gap-4 px-4 py-3 border-b border-border text-xs text-muted-foreground">
          <span>{t("invoicing.table.number")}</span>
          <span>{t("invoicing.table.type")}</span>
          <span>{t("invoicing.table.client")}</span>
          <span>{t("invoicing.table.date")}</span>
          <span>{t("invoicing.table.amount")}</span>
          <span>{t("invoicing.table.status")}</span>
        </div>
        {items.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => router.push(`/invoicing/documents/${d.id}`)}
            className="grid w-full grid-cols-[90px_1.2fr_1.6fr_110px_130px_110px] gap-4 px-4 py-3.5 border-b border-border last:border-b-0 items-center text-start text-sm hover:bg-accent/40 transition-colors"
          >
            <span className="font-mono text-xs">{formatDocNumber(d)}</span>
            <span>{t(`docType.${d.docType}` as MessageKey)}</span>
            <span className="truncate">{d.buyerName ?? "—"}</span>
            <span className="text-muted-foreground">{formatDocDate(d.docDate)}</span>
            <span className="font-medium" dir="ltr">
              {d.status === "draft" && d.totalAmount === 0
                ? "—"
                : formatAgorot(d.totalAmount, localeTag)}
            </span>
            <span>
              <span
                className={cn(
                  "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                  DOC_STATUS_BADGE[d.status],
                )}
              >
                {t(`docStatus.${d.status}` as MessageKey)}
              </span>
            </span>
          </button>
        ))}
        {emptyText && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {items.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => router.push(`/invoicing/documents/${d.id}`)}
            className="w-full border border-border rounded-lg glass-card shadow-card p-4 text-start"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {t(`docType.${d.docType}` as MessageKey)}{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDocNumber(d)}
                </span>
              </span>
              <span
                className={cn(
                  "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                  DOC_STATUS_BADGE[d.status],
                )}
              >
                {t(`docStatus.${d.status}` as MessageKey)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="truncate text-muted-foreground">
                {d.buyerName ?? "—"}
              </span>
              <span className="font-medium" dir="ltr">
                {d.status === "draft" && d.totalAmount === 0
                  ? "—"
                  : formatAgorot(d.totalAmount, localeTag)}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {formatDocDate(d.docDate)}
            </div>
          </button>
        ))}
        {emptyText && (
          <div className="border border-border rounded-lg glass-card p-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        )}
      </div>

      {/* Creation wizard */}
      <DocumentWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        ledger={ledger}
        vatRates={vatRates}
        clients={clients}
        canIssue={canIssue}
        onSaved={(docId, issued) => {
          setWizardOpen(false);
          void refresh();
          router.push(`/invoicing/documents/${docId}`);
          if (issued) toast.success(t("invoicing.toasts.issued"));
          else toast.success(t("invoicing.toasts.draftSaved"));
        }}
      />
    </div>
  );
}

// dd.mm.yyyy — locale-neutral digits-only display, kept identical in every
// UI language.
function formatDocDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
