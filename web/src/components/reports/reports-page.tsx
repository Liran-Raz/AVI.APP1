"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Download,
  FileDown,
  Loader2,
  Printer,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveModal } from "@/components/messages/responsive-modal";
import {
  ApiError,
  apiClient,
  type ClientBalanceRow,
  type DocTypeSummaryRow,
  type OpenFormatSummaryDTO,
  type ReceiptsBookDTO,
  type ReportRangeQuery,
  type SalesBookDTO,
  type VatSummaryDTO,
} from "@/lib/api-client";
import { formatAgorot } from "@/lib/money";
import { hasCapability, PERMISSIONS, type Capability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";

// דוחות (DEV-026 R4) — doc-type summary (the §2.6 validation report), sales +
// receipts books, monthly VAT summary, client balances, CSV downloads and the
// מבנה-אחיד (ממשק פתוח) export dialog. One range drives every tab. Amounts
// are integer agorot from the API; formatting happens here only.

type TabKey = "summary" | "sales" | "receipts" | "vat" | "balance";

const TABS: Array<{ key: TabKey; labelKey: MessageKey }> = [
  { key: "summary", labelKey: "reports.tabs.summary" },
  { key: "sales", labelKey: "reports.tabs.sales" },
  { key: "receipts", labelKey: "reports.tabs.receipts" },
  { key: "vat", labelKey: "reports.tabs.vat" },
  { key: "balance", labelKey: "reports.tabs.balance" },
];

type ReportsData = {
  summary: DocTypeSummaryRow[];
  sales: SalesBookDTO;
  receipts: ReceiptsBookDTO;
  vat: VatSummaryDTO;
  balances: ClientBalanceRow[];
};

// ---- date helpers (local time; the office operates in Israel) -------------

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function taxYearRange(now = new Date()): ReportRangeQuery {
  return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
}

function quarterRange(now = new Date()): ReportRangeQuery {
  const q = Math.floor(now.getMonth() / 3);
  const from = new Date(now.getFullYear(), q * 3, 1);
  const to = new Date(now.getFullYear(), q * 3 + 3, 0);
  return { from: iso(from), to: iso(to) };
}

function monthRange(now = new Date()): ReportRangeQuery {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: iso(from), to: iso(to) };
}

// dd/mm/yyyy — locale-neutral digits-only display, kept identical in every
// UI language.
function formatDate(isoDate: string | null): string {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${m}/${y}`;
}

// ---------------------------------------------------------------------------

export function ReportsPage({
  officeName,
  capabilities,
}: {
  officeName: string;
  capabilities: Capability[];
}) {
  const t = useT();
  const localeTag = intlLocale(useLocale());
  const canExportCsv = hasCapability(capabilities, PERMISSIONS.REPORTS_EXPORT);
  const canOpenFormat = hasCapability(capabilities, PERMISSIONS.INVOICES_EXPORT);

  const [range, setRange] = useState<ReportRangeQuery>(() => taxYearRange());
  const [tab, setTab] = useState<TabKey>("summary");
  const [reloadKey, setReloadKey] = useState(0);
  // Loading/stale handling is DERIVED (no synchronous setState in the fetch
  // effect): a result/failure is stamped with the range+reload key it answers;
  // anything stamped differently is ignored, so a stale response can neither
  // render into a newer range nor flash old data (the chat-poll lesson).
  const [result, setResult] = useState<{ key: string; data: ReportsData } | null>(
    null,
  );
  const [failure, setFailure] = useState<{ key: string; messageKey: MessageKey } | null>(
    null,
  );

  // ממשק פתוח dialog
  const [ofOpen, setOfOpen] = useState(false);
  const [ofSummary, setOfSummary] = useState<OpenFormatSummaryDTO | null>(null);
  const [ofErrorKey, setOfErrorKey] = useState<MessageKey | null>(null);

  const rangeValid = range.from <= range.to;
  const fetchKey = `${range.from}|${range.to}|${reloadKey}`;

  useEffect(() => {
    if (!rangeValid) return;
    let cancelled = false;
    Promise.all([
      apiClient.reports.summary(range),
      apiClient.reports.sales(range),
      apiClient.reports.receipts(range),
      apiClient.reports.vat(range),
      apiClient.reports.clientBalances(range),
    ])
      .then(([summary, sales, receipts, vat, balances]) => {
        if (cancelled) return;
        setResult({
          key: fetchKey,
          data: {
            summary: summary.rows,
            sales,
            receipts,
            vat,
            balances: balances.rows,
          },
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFailure({
          key: fetchKey,
          messageKey:
            e instanceof ApiError && e.code === "VALIDATION_ERROR"
              ? "reports.errors.rangeTooLarge"
              : "reports.errors.loadFailed",
        });
      });
    return () => {
      cancelled = true;
    };
    // `range` is fully encoded in fetchKey; listing both would double-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, rangeValid]);

  const data = result?.key === fetchKey ? result.data : null;
  const error = failure?.key === fetchKey ? t(failure.messageKey) : null;
  const loading = rangeValid && !data && !error;

  // Preset detection for the chips.
  const activePreset = useMemo(() => {
    const eq = (a: ReportRangeQuery, b: ReportRangeQuery) =>
      a.from === b.from && a.to === b.to;
    if (eq(range, taxYearRange())) return "year";
    if (eq(range, quarterRange())) return "quarter";
    if (eq(range, monthRange())) return "month";
    return "custom";
  }, [range]);

  // KPI strip values.
  const kpis = useMemo(() => {
    if (!data) return null;
    const docCount = data.summary.reduce((n, r) => n + r.count, 0);
    const cancelledCount = data.summary.reduce((n, r) => n + r.cancelledCount, 0);
    return {
      docCount,
      cancelledCount,
      salesNet: data.vat.totals.netAgorot,
      salesVat: data.vat.totals.vatAgorot,
      receipts: data.receipts.totalAgorot,
      withholding: data.receipts.withholdingAgorot,
    };
  }, [data]);

  const openOfDialog = () => {
    setOfOpen(true);
    setOfSummary(null);
    setOfErrorKey(null);
    apiClient.reports
      .openFormatSummary(range)
      .then(setOfSummary)
      .catch((e: unknown) => {
        const reason =
          e instanceof ApiError && typeof e.details === "object" && e.details
            ? (e.details as { reason?: string }).reason
            : undefined;
        setOfErrorKey(
          reason === "business_id_missing"
            ? "reports.openformat.errors.businessIdMissing"
            : e instanceof ApiError && e.code === "FORBIDDEN"
              ? "reports.openformat.errors.forbidden"
              : "reports.openformat.errors.prepareFailed",
        );
      });
  };

  const csvLink = (report: Parameters<typeof apiClient.reports.csvUrl>[0]) =>
    canExportCsv ? (
      <Button asChild variant="outline" size="sm" className="print-hide">
        <a href={apiClient.reports.csvUrl(report, range)} download>
          <FileDown className="size-4" />
          CSV
        </a>
      </Button>
    ) : null;

  const printedAt = useMemo(() => formatDate(iso(new Date())), []);
  const activeTab = TABS.find((tb) => tb.key === tab);

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-6xl">
      {/* header */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-5 print-hide">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="size-6 text-primary" />
            {t("reports.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("reports.subtitle")}
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" />
          {t("reports.print.button")}
        </Button>
      </div>

      {/* print-only header (§2.6 — visual output incl. print) */}
      <div className="print-only mb-4">
        <div className="text-lg font-bold">{officeName}</div>
        <div className="text-sm">
          {activeTab ? t(activeTab.labelKey) : null}
          {t("reports.print.headerLine", {
            from: formatDate(range.from),
            to: formatDate(range.to),
            printed: printedAt,
          })}
        </div>
      </div>

      {/* range bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4 print-hide">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              [
                "year",
                t("reports.presets.taxYear", { year: new Date().getFullYear() }),
                taxYearRange,
              ],
              ["quarter", t("reports.presets.quarter"), quarterRange],
              ["month", t("reports.presets.month"), monthRange],
            ] as const
          ).map(([key, label, make]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(make())}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                activePreset === key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/50",
              )}
            >
              {label}
            </button>
          ))}
          <span
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-semibold",
              activePreset === "custom"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border",
            )}
          >
            {t("reports.presets.custom")}
          </span>
        </div>
        <div className="flex items-center gap-2 ms-auto text-xs text-muted-foreground">
          {t("reports.range.from")}
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            className="h-9 rounded-md border border-input bg-card px-2.5 text-xs text-foreground"
          />
          {t("reports.range.to")}
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            className="h-9 rounded-md border border-input bg-card px-2.5 text-xs text-foreground"
          />
        </div>
      </div>

      {!rangeValid && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive print-hide">
          {t("reports.errors.invalidRange")}
        </div>
      )}

      {error && rangeValid && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive print-hide">
          {error}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw className="size-4" />
            {t("reports.errors.retry")}
          </Button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 print-hide">
        {loading || !kpis ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))
        ) : (
          <>
            <KpiCard
              title={t("reports.kpi.docsInRange")}
              value={String(kpis.docCount)}
              sub={
                kpis.cancelledCount > 0
                  ? t("reports.kpi.cancelledOfThem", {
                      count: kpis.cancelledCount,
                    })
                  : t("reports.kpi.noCancellations")
              }
            />
            <KpiCard
              title={t("reports.kpi.salesNet")}
              value={formatAgorot(kpis.salesNet, localeTag)}
              sub={t("reports.kpi.netAfterCredits")}
              tone="primary"
            />
            <KpiCard
              title={t("reports.kpi.salesVat")}
              value={formatAgorot(kpis.salesVat, localeTag)}
              sub={t("reports.kpi.salesVatSub")}
              tone="primary"
            />
            <KpiCard
              title={t("reports.kpi.receipts")}
              value={formatAgorot(kpis.receipts, localeTag)}
              sub={
                kpis.withholding > 0
                  ? t("reports.kpi.plusWithholding", {
                      amount: formatAgorot(kpis.withholding, localeTag),
                    })
                  : t("reports.kpi.allMethods")
              }
              tone="success"
            />
          </>
        )}
      </div>

      {/* ממשק פתוח card (owner only) */}
      {canOpenFormat && (
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border-2 border-primary/30 bg-gradient-to-l from-primary/5 to-card p-4 print-hide">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Download className="size-5" />
          </div>
          <div className="min-w-[230px] flex-1">
            <div className="flex items-center gap-2 font-bold">
              {t("reports.openformat.cardTitle")}
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                {t("reports.openformat.ownerOnlyBadge")}
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t("reports.openformat.cardDesc")}
            </p>
          </div>
          <Button onClick={openOfDialog} disabled={!rangeValid}>
            {t("reports.openformat.exportButton")}
          </Button>
        </div>
      )}

      {/* tabs */}
      <div className="mb-4 flex w-max max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card/70 p-1 print-hide">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={cn(
              "whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
              tab === tb.key
                ? "bg-background text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {/* active report */}
      {loading ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-b-0"
            >
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-44" />
              <Skeleton className="ms-auto h-4 w-24" />
            </div>
          ))}
        </div>
      ) : !data ? null : (
        <>
          {tab === "summary" && (
            <SummaryReport rows={data.summary} csv={csvLink("summary")} />
          )}
          {tab === "sales" && (
            <SalesReport book={data.sales} csv={csvLink("sales")} />
          )}
          {tab === "receipts" && (
            <ReceiptsReport book={data.receipts} csv={csvLink("receipts")} />
          )}
          {tab === "vat" && <VatReport vat={data.vat} csv={csvLink("vat")} />}
          {tab === "balance" && (
            <BalanceReport rows={data.balances} csv={csvLink("client-balances")} />
          )}
        </>
      )}

      {/* ממשק פתוח dialog */}
      <ResponsiveModal
        open={ofOpen}
        onOpenChange={(o) => setOfOpen(o)}
        title={t("reports.openformat.dialogTitle")}
        footer={
          <div className="flex flex-wrap gap-2">
            {ofSummary && (
              <>
                <Button asChild>
                  <a
                    href={apiClient.reports.openFormatDownloadUrl(range)}
                    download
                  >
                    <Download className="size-4" />
                    {t("reports.openformat.downloadFile")}
                  </a>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.print()}
                  className="print-hide"
                >
                  <Printer className="size-4" />
                  {t("reports.openformat.printReport")}
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setOfOpen(false)}>
              {t("common.close")}
            </Button>
          </div>
        }
      >
        <OpenFormatDialogBody
          summary={ofSummary}
          error={ofErrorKey ? t(ofErrorKey) : null}
        />
      </ResponsiveModal>
    </div>
  );
}

// ============================================================
// KPI card
// ============================================================

function KpiCard({
  title,
  value,
  sub,
  tone,
}: {
  title: string;
  value: string;
  sub: string;
  tone?: "primary" | "success";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      <div
        className={cn(
          "mt-0.5 text-xl font-extrabold tabular-nums",
          tone === "primary" && "text-primary",
          tone === "success" && "text-emerald-700",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

// ============================================================
// Shared table shells
// ============================================================

function ReportCard({
  title,
  subtitle,
  actions,
  foot,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  foot?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-bold">{title}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {subtitle}
          </div>
        </div>
        {actions}
      </div>
      {children}
      {foot && (
        <div className="border-t border-border bg-primary/[0.02] px-4 py-2 text-[11px] text-muted-foreground print-hide">
          {foot}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: "issued" | "cancelled" }) {
  const t = useT();
  return status === "cancelled" ? (
    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10.5px] font-bold text-destructive">
      {t("docStatus.cancelled")}
    </span>
  ) : (
    <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">
      {t("docStatus.issued")}
    </span>
  );
}

function EmptyRows({ colSpan }: { colSpan: number }) {
  const t = useT();
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-4 py-10 text-center text-sm text-muted-foreground"
      >
        {t("reports.emptyRange")}
      </td>
    </tr>
  );
}

const TH = "px-3.5 py-2.5 text-start text-[11px] font-bold text-muted-foreground bg-primary/[0.04] border-b border-border whitespace-nowrap";
const TD = "px-3.5 py-2.5 border-b border-border/60 whitespace-nowrap text-[13px]";
// The cell forces direction:ltr, so rtl:/ltr: variants (keyed off <html dir>)
// pin the number to the visual END of the row in both UI directions — text-end
// here would flip the Hebrew rendering.
const NUM = "rtl:text-left ltr:text-right tabular-nums [direction:ltr]";
const FOOT_TD = "px-3.5 py-2.5 bg-primary/[0.04] font-bold border-t-2 border-border text-[13px]";

// ============================================================
// Tab: סיכום מסמכים (נספח-1 / §2.6)
// ============================================================

function SummaryReport({
  rows,
  csv,
}: {
  rows: DocTypeSummaryRow[];
  csv: React.ReactNode;
}) {
  const t = useT();
  const localeTag = intlLocale(useLocale());
  const [showAll, setShowAll] = useState(false);
  const managed = rows.filter((r) => r.managed);
  const visible = showAll ? rows : managed;
  return (
    <ReportCard
      title={t("reports.summary.title")}
      subtitle={t("reports.summary.subtitle")}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs font-semibold text-primary hover:underline print-hide"
          >
            {showAll ? t("reports.summary.managedOnly") : t("reports.summary.all27")}
          </button>
          {csv}
        </div>
      }
      foot={t("reports.summary.foot")}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>{t("reports.summary.code")}</th>
              <th className={TH}>{t("reports.summary.docType")}</th>
              <th className={TH}>{t("reports.summary.softwareStatus")}</th>
              <th className={cn(TH, NUM)}>{t("reports.summary.count")}</th>
              <th className={cn(TH, NUM)}>{t("reports.summary.cancelledCount")}</th>
              <th className={cn(TH, NUM)}>{t("reports.table.total")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <EmptyRows colSpan={6} />
            ) : (
              visible.map((r) => (
                <tr key={r.docType} className={cn(!r.managed && "opacity-60")}>
                  <td className={TD}>{r.docType}</td>
                  <td className={TD}>
                    {t(`nispach1.${r.docType}` as MessageKey)}
                  </td>
                  <td className={TD}>
                    {r.managed ? (
                      <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">
                        {t("reports.summary.managedBadge")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold text-muted-foreground">
                        {t("reports.summary.notManagedBadge")}
                      </span>
                    )}
                  </td>
                  <td className={cn(TD, NUM)}>{r.count}</td>
                  <td className={cn(TD, NUM)}>{r.cancelledCount}</td>
                  <td className={cn(TD, NUM)}>
                    {formatAgorot(r.totalAgorot, localeTag)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </ReportCard>
  );
}

// ============================================================
// Tab: ספר מכירות
// ============================================================

function SalesReport({ book, csv }: { book: SalesBookDTO; csv: React.ReactNode }) {
  const t = useT();
  const localeTag = intlLocale(useLocale());
  return (
    <ReportCard
      title={t("reports.tabs.sales")}
      subtitle={t("reports.salesBook.subtitle")}
      actions={csv}
      foot={t("reports.salesBook.foot")}
    >
      {/* desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>{t("reports.table.date")}</th>
              <th className={TH}>{t("reports.table.document")}</th>
              <th className={TH}>{t("reports.table.client")}</th>
              <th className={TH}>{t("reports.table.status")}</th>
              <th className={cn(TH, NUM)}>{t("reports.salesBook.beforeVat")}</th>
              <th className={cn(TH, NUM)}>{t("reports.salesBook.vat")}</th>
              <th className={cn(TH, NUM)}>{t("reports.table.total")}</th>
            </tr>
          </thead>
          <tbody>
            {book.rows.length === 0 ? (
              <EmptyRows colSpan={7} />
            ) : (
              book.rows.map((r) => {
                const neg = r.docType === "330";
                return (
                  <tr key={r.id}>
                    <td className={TD}>{formatDate(r.docDate)}</td>
                    <td className={cn(TD, neg && "text-destructive")}>
                      {t(`docType.${r.docType}` as MessageKey)} #{r.number}
                    </td>
                    <td className={TD}>{r.buyerName ?? "—"}</td>
                    <td className={TD}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className={cn(TD, NUM, neg && "text-destructive")}>
                      {formatAgorot(neg ? -r.netAgorot : r.netAgorot, localeTag)}
                    </td>
                    <td className={cn(TD, NUM, neg && "text-destructive")}>
                      {formatAgorot(neg ? -r.vatAgorot : r.vatAgorot, localeTag)}
                    </td>
                    <td className={cn(TD, NUM, neg && "text-destructive")}>
                      {formatAgorot(r.signedTotalAgorot, localeTag)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {book.rows.length > 0 && (
            <tfoot>
              <tr>
                <td className={FOOT_TD} colSpan={4}>
                  {t("reports.salesBook.totalWithCount", {
                    count: book.totals.documentCount,
                  })}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(book.totals.netAgorot, localeTag)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(book.totals.vatAgorot, localeTag)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(book.totals.totalAgorot, localeTag)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {/* mobile cards */}
      <div className="md:hidden">
        {book.rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t("reports.emptyRange")}
          </div>
        ) : (
          <>
            {book.rows.map((r) => {
              const neg = r.docType === "330";
              return (
                <div
                  key={r.id}
                  className="border-b border-border/60 px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        neg && "text-destructive",
                      )}
                    >
                      {t(`docType.${r.docType}` as MessageKey)} #{r.number}
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {formatDate(r.docDate)} · {r.buyerName ?? "—"}
                    </span>
                    <span
                      className={cn(
                        "text-sm font-bold tabular-nums text-foreground",
                        neg && "text-destructive",
                      )}
                    >
                      {formatAgorot(r.signedTotalAgorot, localeTag)}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between bg-primary/[0.04] px-4 py-3 text-sm font-bold">
              <span>
                {t("reports.salesBook.totalWithCountMobile", {
                  count: book.totals.documentCount,
                })}
              </span>
              <span className="tabular-nums">
                {formatAgorot(book.totals.totalAgorot, localeTag)}
              </span>
            </div>
          </>
        )}
      </div>
    </ReportCard>
  );
}

// ============================================================
// Tab: ספר תקבולים
// ============================================================

function ReceiptsReport({
  book,
  csv,
}: {
  book: ReceiptsBookDTO;
  csv: React.ReactNode;
}) {
  const t = useT();
  const localeTag = intlLocale(useLocale());
  const methodsLine =
    book.totalsByMethod.length > 0
      ? book.totalsByMethod
          .map(
            (m) =>
              `${t(`paymentMethod.${m.method}` as MessageKey)} ${formatAgorot(m.amountAgorot, localeTag)}`,
          )
          .join(" · ")
      : "";
  return (
    <ReportCard
      title={t("reports.tabs.receipts")}
      subtitle={t("reports.receiptsBook.subtitle")}
      actions={csv}
      foot={
        book.withholdingAgorot > 0
          ? t("reports.receiptsBook.footWithholding", {
              amount: formatAgorot(book.withholdingAgorot, localeTag),
            })
          : t("reports.receiptsBook.footMultiPayment")
      }
    >
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>{t("reports.table.date")}</th>
              <th className={TH}>{t("reports.table.document")}</th>
              <th className={TH}>{t("reports.receiptsBook.payer")}</th>
              <th className={TH}>{t("reports.receiptsBook.method")}</th>
              <th className={TH}>{t("reports.receiptsBook.dueDate")}</th>
              <th className={TH}>{t("reports.table.status")}</th>
              <th className={cn(TH, NUM)}>{t("reports.table.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {book.rows.length === 0 ? (
              <EmptyRows colSpan={7} />
            ) : (
              book.rows.map((r) => (
                <tr key={`${r.documentId}-${r.paymentLineNo}`}>
                  <td className={TD}>{formatDate(r.docDate)}</td>
                  <td className={TD}>
                    {t(`docType.${r.docType}` as MessageKey)} #{r.number}
                  </td>
                  <td className={TD}>{r.buyerName ?? "—"}</td>
                  <td className={TD}>
                    {t(`paymentMethod.${r.method}` as MessageKey)}
                  </td>
                  <td className={TD}>{formatDate(r.dueDate)}</td>
                  <td className={TD}>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className={cn(TD, NUM)}>
                    {formatAgorot(r.amountAgorot, localeTag)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {book.rows.length > 0 && (
            <tfoot>
              <tr>
                <td className={FOOT_TD} colSpan={6}>
                  {t("reports.receiptsBook.total")}
                  {methodsLine ? ` · ${methodsLine}` : ""}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(book.totalAgorot, localeTag)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="md:hidden">
        {book.rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t("reports.emptyRange")}
          </div>
        ) : (
          <>
            {book.rows.map((r) => (
              <div
                key={`${r.documentId}-${r.paymentLineNo}`}
                className="border-b border-border/60 px-4 py-3 last:border-b-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {t(`docType.${r.docType}` as MessageKey)} #{r.number}
                  </span>
                  <span className="text-sm font-bold tabular-nums">
                    {formatAgorot(r.amountAgorot, localeTag)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDate(r.docDate)} · {r.buyerName ?? "—"} ·{" "}
                  {t(`paymentMethod.${r.method}` as MessageKey)}
                  {r.dueDate
                    ? t("reports.receiptsBook.dueSuffix", {
                        date: formatDate(r.dueDate),
                      })
                    : ""}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between bg-primary/[0.04] px-4 py-3 text-sm font-bold">
              <span>{t("reports.receiptsBook.total")}</span>
              <span className="tabular-nums">
                {formatAgorot(book.totalAgorot, localeTag)}
              </span>
            </div>
          </>
        )}
      </div>
    </ReportCard>
  );
}

// ============================================================
// Tab: סיכום מע״מ
// ============================================================

function VatReport({ vat, csv }: { vat: VatSummaryDTO; csv: React.ReactNode }) {
  const t = useT();
  const localeTag = intlLocale(useLocale());
  return (
    <ReportCard
      title={t("reports.vat.title")}
      subtitle={t("reports.vat.subtitle")}
      actions={csv}
      foot={t("reports.vat.foot")}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>{t("reports.vat.month")}</th>
              <th className={cn(TH, NUM)}>{t("reports.vat.salesBeforeVat")}</th>
              <th className={cn(TH, NUM)}>{t("reports.vat.salesVat")}</th>
              <th className={cn(TH, NUM)}>{t("reports.vat.credits")}</th>
              <th className={cn(TH, NUM)}>{t("reports.vat.creditsVat")}</th>
              <th className={cn(TH, NUM)}>{t("reports.vat.net")}</th>
              <th className={cn(TH, NUM)}>{t("reports.vat.netVat")}</th>
            </tr>
          </thead>
          <tbody>
            {vat.rows.length === 0 ? (
              <EmptyRows colSpan={7} />
            ) : (
              vat.rows.map((r) => (
                <tr key={r.month}>
                  <td className={TD}>{formatMonth(r.month)}</td>
                  <td className={cn(TD, NUM)}>
                    {formatAgorot(r.salesNetAgorot, localeTag)}
                  </td>
                  <td className={cn(TD, NUM)}>
                    {formatAgorot(r.salesVatAgorot, localeTag)}
                  </td>
                  <td className={cn(TD, NUM, r.creditNetAgorot > 0 && "text-destructive")}>
                    {formatAgorot(-r.creditNetAgorot, localeTag)}
                  </td>
                  <td className={cn(TD, NUM, r.creditVatAgorot > 0 && "text-destructive")}>
                    {formatAgorot(-r.creditVatAgorot, localeTag)}
                  </td>
                  <td className={cn(TD, NUM, "font-semibold")}>
                    {formatAgorot(r.netAgorot, localeTag)}
                  </td>
                  <td className={cn(TD, NUM, "font-semibold")}>
                    {formatAgorot(r.vatAgorot, localeTag)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {vat.rows.length > 0 && (
            <tfoot>
              <tr>
                <td className={FOOT_TD}>{t("reports.table.total")}</td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(vat.totals.salesNetAgorot, localeTag)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(vat.totals.salesVatAgorot, localeTag)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(-vat.totals.creditNetAgorot, localeTag)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(-vat.totals.creditVatAgorot, localeTag)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(vat.totals.netAgorot, localeTag)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(vat.totals.vatAgorot, localeTag)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </ReportCard>
  );
}

// ============================================================
// Tab: מאזן לקוחות
// ============================================================

function BalanceReport({
  rows,
  csv,
}: {
  rows: ClientBalanceRow[];
  csv: React.ReactNode;
}) {
  const t = useT();
  const localeTag = intlLocale(useLocale());
  return (
    <ReportCard
      title={t("reports.tabs.balance")}
      subtitle={t("reports.balances.subtitle")}
      actions={csv}
      foot={t("reports.balances.foot")}
    >
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>{t("reports.table.client")}</th>
              <th className={cn(TH, NUM)}>{t("reports.balances.charged")}</th>
              <th className={cn(TH, NUM)}>{t("reports.balances.received")}</th>
              <th className={cn(TH, NUM)}>
                {t("reports.balances.ofWhichWithholding")}
              </th>
              <th className={cn(TH, NUM)}>{t("reports.balances.balance")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRows colSpan={5} />
            ) : (
              rows.map((r) => (
                <tr key={r.clientKey}>
                  <td className={cn(TD, "font-medium")}>{r.buyerName}</td>
                  <td className={cn(TD, NUM)}>
                    {formatAgorot(r.chargedAgorot, localeTag)}
                  </td>
                  <td className={cn(TD, NUM)}>
                    {formatAgorot(r.receivedAgorot, localeTag)}
                  </td>
                  <td className={cn(TD, NUM)}>
                    {formatAgorot(r.withholdingAgorot, localeTag)}
                  </td>
                  <td
                    className={cn(
                      TD,
                      NUM,
                      "font-bold",
                      r.balanceAgorot > 0 && "text-destructive",
                    )}
                  >
                    {formatAgorot(r.balanceAgorot, localeTag)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="md:hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t("reports.emptyRange")}
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.clientKey}
              className="border-b border-border/60 px-4 py-3 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{r.buyerName}</span>
                <span
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    r.balanceAgorot > 0 && "text-destructive",
                  )}
                >
                  {formatAgorot(r.balanceAgorot, localeTag)}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("reports.balances.mobileLine", {
                  charged: formatAgorot(r.chargedAgorot, localeTag),
                  received: formatAgorot(r.receivedAgorot, localeTag),
                })}
                {r.withholdingAgorot > 0
                  ? t("reports.balances.mobileWithholdingSuffix", {
                      amount: formatAgorot(r.withholdingAgorot, localeTag),
                    })
                  : ""}
              </div>
            </div>
          ))
        )}
      </div>
    </ReportCard>
  );
}

// ============================================================
// ממשק פתוח dialog body (the נספח-4 production report)
// ============================================================

function OpenFormatDialogBody({
  summary,
  error,
}: {
  summary: OpenFormatSummaryDTO | null;
  error: string | null;
}) {
  const t = useT();
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("reports.openformat.preparing")}
      </div>
    );
  }
  const countRows: Array<[string, MessageKey, number]> = [
    ["A100", "reports.openformat.recordOpening", 1],
    ["C100", "reports.openformat.recordDocHeader", summary.counts.C100],
    ["D110", "reports.openformat.recordDocLines", summary.counts.D110],
    ["D120", "reports.openformat.recordReceipt", summary.counts.D120],
    ["Z900", "reports.openformat.recordClosing", 1],
  ];
  return (
    <div className="of-print-area flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-muted-foreground">{t("reports.openformat.business")}</dt>
        <dd className="font-semibold">
          {t("reports.openformat.businessLine", {
            name: summary.business.name,
            vatId: summary.business.vatId,
          })}
        </dd>
        {/* the file's declared range (1024/1025) — the server clamps a future
            end date to the production day, per the spec */}
        <dt className="text-muted-foreground">
          {t("reports.openformat.dataRange")}
        </dt>
        <dd className="font-semibold">
          {formatDate(summary.range.from)} – {formatDate(summary.range.to)}
        </dd>
        <dt className="text-muted-foreground">
          {t("reports.openformat.generatedAt")}
        </dt>
        <dd className="font-semibold">
          {formatDate(summary.generatedDate)} ·{" "}
          {summary.generatedTime.slice(0, 2)}:{summary.generatedTime.slice(2)}
        </dd>
        <dt className="text-muted-foreground">
          {t("reports.openformat.savedPath")}
        </dt>
        <dd className="font-mono text-xs [direction:ltr] text-left">
          {summary.savedPath}
        </dd>
        <dt className="text-muted-foreground">
          {t("reports.openformat.software")}
        </dt>
        <dd className="font-semibold">
          {summary.software.name} {summary.software.version}
          {t("reports.openformat.registrationLine", {
            number:
              summary.software.registrationNumber ??
              t("reports.openformat.notRegistered"),
          })}
        </dd>
      </dl>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className={TH}>{t("reports.openformat.table.recordCode")}</th>
              <th className={TH}>{t("reports.openformat.table.description")}</th>
              <th className={cn(TH, NUM)}>
                {t("reports.openformat.table.recordCount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {countRows.map(([code, labelKey, n]) => (
              <tr key={code}>
                <td className={TD}>{code}</td>
                <td className={TD}>{t(labelKey)}</td>
                <td className={cn(TD, NUM)}>{n}</td>
              </tr>
            ))}
            <tr>
              <td className={FOOT_TD} colSpan={2}>
                {t("reports.openformat.totalRecords")}
              </td>
              <td className={cn(FOOT_TD, NUM)}>{summary.counts.total}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
        {t("reports.openformat.downloadNote", { count: summary.documentCount })}
      </div>

      {summary.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
          <b>{t("reports.openformat.warningsTitle")}</b>
          <ul className="mt-1 list-inside list-disc">
            {/* server-generated warnings render as-is (Hebrew, like the CSV —
                documented product decision) */}
            {summary.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
