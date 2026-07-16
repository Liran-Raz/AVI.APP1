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

// דוחות (DEV-026 R4) — doc-type summary (the §2.6 validation report), sales +
// receipts books, monthly VAT summary, client balances, CSV downloads and the
// מבנה-אחיד (ממשק פתוח) export dialog. One range drives every tab. Amounts
// are integer agorot from the API; formatting happens here only.

type TabKey = "summary" | "sales" | "receipts" | "vat" | "balance";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "summary", label: "סיכום מסמכים" },
  { key: "sales", label: "ספר מכירות" },
  { key: "receipts", label: "ספר תקבולים" },
  { key: "vat", label: 'סיכום מע״מ' },
  { key: "balance", label: "מאזן לקוחות" },
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

function formatDateHe(isoDate: string | null): string {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function formatMonthHe(month: string): string {
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
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(
    null,
  );

  // ממשק פתוח dialog
  const [ofOpen, setOfOpen] = useState(false);
  const [ofSummary, setOfSummary] = useState<OpenFormatSummaryDTO | null>(null);
  const [ofError, setOfError] = useState<string | null>(null);

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
          message:
            e instanceof ApiError && e.code === "VALIDATION_ERROR"
              ? "הטווח שנבחר גדול מדי — צמצם את טווח התאריכים."
              : "טעינת הדוחות נכשלה. נסה שוב.",
        });
      });
    return () => {
      cancelled = true;
    };
    // `range` is fully encoded in fetchKey; listing both would double-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, rangeValid]);

  const data = result?.key === fetchKey ? result.data : null;
  const error = failure?.key === fetchKey ? failure.message : null;
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
    setOfError(null);
    apiClient.reports
      .openFormatSummary(range)
      .then(setOfSummary)
      .catch((e: unknown) => {
        const reason =
          e instanceof ApiError && typeof e.details === "object" && e.details
            ? (e.details as { reason?: string }).reason
            : undefined;
        setOfError(
          reason === "business_id_missing"
            ? "חסר מספר עוסק/ח.פ בפרופיל העסק — השלם אותו בהגדרות הנהלת החשבונות ונסה שוב."
            : e instanceof ApiError && e.code === "FORBIDDEN"
              ? "ייצוא מבנה-אחיד זמין לבעל המשרד בלבד."
              : "הכנת הייצוא נכשלה. נסה שוב.",
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

  const printedAt = useMemo(() => formatDateHe(iso(new Date())), []);

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-6xl">
      {/* header */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-5 print-hide">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="size-6 text-primary" />
            דוחות
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ספרי מכירות ותקבולים, סיכום מע״מ ומאזן לקוחות — לפי טווח תאריכים
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" />
          הדפסה
        </Button>
      </div>

      {/* print-only header (§2.6 — visual output incl. print) */}
      <div className="print-only mb-4">
        <div className="text-lg font-bold">{officeName}</div>
        <div className="text-sm">
          {TABS.find((t) => t.key === tab)?.label} · טווח:{" "}
          {formatDateHe(range.from)} – {formatDateHe(range.to)} · הודפס:{" "}
          {printedAt}
        </div>
      </div>

      {/* range bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4 print-hide">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["year", `שנת המס ${new Date().getFullYear()}`, taxYearRange],
              ["quarter", "רבעון נוכחי", quarterRange],
              ["month", "החודש", monthRange],
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
            מותאם אישית
          </span>
        </div>
        <div className="flex items-center gap-2 ms-auto text-xs text-muted-foreground">
          מ-
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            className="h-9 rounded-md border border-input bg-card px-2.5 text-xs text-foreground"
          />
          עד
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
          תאריך ההתחלה מאוחר מתאריך הסיום — תקן את הטווח.
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
            נסה שוב
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
              title="מסמכים בטווח"
              value={String(kpis.docCount)}
              sub={
                kpis.cancelledCount > 0
                  ? `מתוכם ${kpis.cancelledCount} מבוטלים`
                  : "ללא ביטולים"
              }
            />
            <KpiCard
              title='מכירות (לפני מע״מ)'
              value={formatAgorot(kpis.salesNet)}
              sub="נטו אחרי זיכויים"
              tone="primary"
            />
            <KpiCard
              title='מע״מ עסקאות'
              value={formatAgorot(kpis.salesVat)}
              sub="לפי הדוחות בטווח"
              tone="primary"
            />
            <KpiCard
              title="תקבולים"
              value={formatAgorot(kpis.receipts)}
              sub={
                kpis.withholding > 0
                  ? `+ ${formatAgorot(kpis.withholding)} ניכוי במקור`
                  : "כולל כל אמצעי התשלום"
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
              ממשק פתוח — ייצוא קבצים במבנה אחיד
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                בעלים בלבד
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              מפיק INI.TXT + BKMVDATA.TXT לפי הוראות מס הכנסה (גרסה 1.31) עבור
              הטווח שנבחר — לביקורת, לרואה חשבון מבקר או לבדיקה בסימולטור של
              רשות המסים.
            </p>
          </div>
          <Button onClick={openOfDialog} disabled={!rangeValid}>
            יצוא קבצים
          </Button>
        </div>
      )}

      {/* tabs */}
      <div className="mb-4 flex w-max max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card/70 p-1 print-hide">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
              tab === t.key
                ? "bg-background text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
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
        title="ממשק פתוח — סיכום הפקה"
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
                    הורדת קובץ הייצוא
                  </a>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.print()}
                  className="print-hide"
                >
                  <Printer className="size-4" />
                  הדפסת הדוח
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setOfOpen(false)}>
              סגירה
            </Button>
          </div>
        }
      >
        <OpenFormatDialogBody summary={ofSummary} error={ofError} />
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
  return status === "cancelled" ? (
    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10.5px] font-bold text-destructive">
      מבוטל
    </span>
  ) : (
    <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">
      הופק
    </span>
  );
}

function EmptyRows({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-4 py-10 text-center text-sm text-muted-foreground"
      >
        אין נתונים בטווח שנבחר
      </td>
    </tr>
  );
}

const TH = "px-3.5 py-2.5 text-right text-[11px] font-bold text-muted-foreground bg-primary/[0.04] border-b border-border whitespace-nowrap";
const TD = "px-3.5 py-2.5 border-b border-border/60 whitespace-nowrap text-[13px]";
const NUM = "text-left tabular-nums [direction:ltr]";
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
  const [showAll, setShowAll] = useState(false);
  const managed = rows.filter((r) => r.managed);
  const visible = showAll ? rows : managed;
  return (
    <ReportCard
      title="סיכום מסמכים לפי סוג"
      subtitle="דוח האימות הנדרש לרישום (סעיף 2.6 להוראות) — כמות וסכום לכל סוג מסמך רשמי"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs font-semibold text-primary hover:underline print-hide"
          >
            {showAll ? "רק סוגים מנוהלים" : "כל 27 הסוגים"}
          </button>
          {csv}
        </div>
      }
      foot="מסמכים מבוטלים נספרים בכמות אך אינם נכללים בסכום. סוגים שאינם מנוהלים בתוכנה מוצגים באפס — כנדרש בהוראות."
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>קוד</th>
              <th className={TH}>סוג המסמך</th>
              <th className={TH}>סטטוס בתוכנה</th>
              <th className={cn(TH, NUM)}>כמות</th>
              <th className={cn(TH, NUM)}>מבוטלים</th>
              <th className={cn(TH, NUM)}>סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <EmptyRows colSpan={6} />
            ) : (
              visible.map((r) => (
                <tr key={r.docType} className={cn(!r.managed && "opacity-60")}>
                  <td className={TD}>{r.docType}</td>
                  <td className={TD}>{r.nameHe}</td>
                  <td className={TD}>
                    {r.managed ? (
                      <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">
                        מנוהל
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold text-muted-foreground">
                        לא מנוהל
                      </span>
                    )}
                  </td>
                  <td className={cn(TD, NUM)}>{r.count}</td>
                  <td className={cn(TD, NUM)}>{r.cancelledCount}</td>
                  <td className={cn(TD, NUM)}>{formatAgorot(r.totalAgorot)}</td>
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
  return (
    <ReportCard
      title="ספר מכירות"
      subtitle="חשבוניות מס, חשבוניות מס-קבלה וזיכויים — כרונולוגי"
      actions={csv}
      foot="שורות מבוטלות נשארות בספר (מסומנות) אך אינן נסכמות; זיכויים מוצגים בשלילי ונגרעים מהסיכום."
    >
      {/* desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>תאריך</th>
              <th className={TH}>מסמך</th>
              <th className={TH}>לקוח</th>
              <th className={TH}>סטטוס</th>
              <th className={cn(TH, NUM)}>לפני מע״מ</th>
              <th className={cn(TH, NUM)}>מע״מ</th>
              <th className={cn(TH, NUM)}>סה״כ</th>
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
                    <td className={TD}>{formatDateHe(r.docDate)}</td>
                    <td className={cn(TD, neg && "text-destructive")}>
                      {r.docTypeLabel} #{r.number}
                    </td>
                    <td className={TD}>{r.buyerName ?? "—"}</td>
                    <td className={TD}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className={cn(TD, NUM, neg && "text-destructive")}>
                      {formatAgorot(neg ? -r.netAgorot : r.netAgorot)}
                    </td>
                    <td className={cn(TD, NUM, neg && "text-destructive")}>
                      {formatAgorot(neg ? -r.vatAgorot : r.vatAgorot)}
                    </td>
                    <td className={cn(TD, NUM, neg && "text-destructive")}>
                      {formatAgorot(r.signedTotalAgorot)}
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
                  סה״כ ({book.totals.documentCount} מסמכים, ללא מבוטלים)
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(book.totals.netAgorot)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(book.totals.vatAgorot)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(book.totals.totalAgorot)}
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
            אין נתונים בטווח שנבחר
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
                      {r.docTypeLabel} #{r.number}
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {formatDateHe(r.docDate)} · {r.buyerName ?? "—"}
                    </span>
                    <span
                      className={cn(
                        "text-sm font-bold tabular-nums text-foreground",
                        neg && "text-destructive",
                      )}
                    >
                      {formatAgorot(r.signedTotalAgorot)}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between bg-primary/[0.04] px-4 py-3 text-sm font-bold">
              <span>סה״כ ({book.totals.documentCount} מסמכים)</span>
              <span className="tabular-nums">
                {formatAgorot(book.totals.totalAgorot)}
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
  const methodsLine =
    book.totalsByMethod.length > 0
      ? book.totalsByMethod
          .map((m) => `${m.methodLabel} ${formatAgorot(m.amountAgorot)}`)
          .join(" · ")
      : "";
  return (
    <ReportCard
      title="ספר תקבולים"
      subtitle="שורת תקבול לכל אמצעי תשלום (קבלות וחשבוניות מס-קבלה)"
      actions={csv}
      foot={
        book.withholdingAgorot > 0
          ? `בנוסף נוכה במקור ${formatAgorot(book.withholdingAgorot)} (מתועד על גבי הקבלות).`
          : "קבלה עם כמה תשלומים מציגה שורה לכל תשלום — בדיוק כמו בקובץ המבנה האחיד."
      }
    >
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>תאריך</th>
              <th className={TH}>מסמך</th>
              <th className={TH}>משלם</th>
              <th className={TH}>אמצעי</th>
              <th className={TH}>ת. פירעון</th>
              <th className={TH}>סטטוס</th>
              <th className={cn(TH, NUM)}>סכום</th>
            </tr>
          </thead>
          <tbody>
            {book.rows.length === 0 ? (
              <EmptyRows colSpan={7} />
            ) : (
              book.rows.map((r) => (
                <tr key={`${r.documentId}-${r.paymentLineNo}`}>
                  <td className={TD}>{formatDateHe(r.docDate)}</td>
                  <td className={TD}>
                    {r.docTypeLabel} #{r.number}
                  </td>
                  <td className={TD}>{r.buyerName ?? "—"}</td>
                  <td className={TD}>{r.methodLabel}</td>
                  <td className={TD}>{formatDateHe(r.dueDate)}</td>
                  <td className={TD}>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className={cn(TD, NUM)}>{formatAgorot(r.amountAgorot)}</td>
                </tr>
              ))
            )}
          </tbody>
          {book.rows.length > 0 && (
            <tfoot>
              <tr>
                <td className={FOOT_TD} colSpan={6}>
                  סה״כ תקבולים{methodsLine ? ` · ${methodsLine}` : ""}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(book.totalAgorot)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="md:hidden">
        {book.rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            אין נתונים בטווח שנבחר
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
                    {r.docTypeLabel} #{r.number}
                  </span>
                  <span className="text-sm font-bold tabular-nums">
                    {formatAgorot(r.amountAgorot)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDateHe(r.docDate)} · {r.buyerName ?? "—"} ·{" "}
                  {r.methodLabel}
                  {r.dueDate ? ` · פירעון ${formatDateHe(r.dueDate)}` : ""}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between bg-primary/[0.04] px-4 py-3 text-sm font-bold">
              <span>סה״כ תקבולים</span>
              <span className="tabular-nums">{formatAgorot(book.totalAgorot)}</span>
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
  return (
    <ReportCard
      title='סיכום מע״מ עסקאות'
      subtitle="ריכוז חודשי — עסקאות, זיכויים ונטו"
      actions={csv}
      foot='אינפורמטיבי לצורך הדיווח התקופתי — אינו מחליף את דוח המע״מ הרשמי. עוסק פטור יראה כאן אפסי מע״מ.'
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>חודש</th>
              <th className={cn(TH, NUM)}>עסקאות (לפני מע״מ)</th>
              <th className={cn(TH, NUM)}>מע״מ עסקאות</th>
              <th className={cn(TH, NUM)}>זיכויים</th>
              <th className={cn(TH, NUM)}>מע״מ זיכויים</th>
              <th className={cn(TH, NUM)}>נטו</th>
              <th className={cn(TH, NUM)}>מע״מ נטו</th>
            </tr>
          </thead>
          <tbody>
            {vat.rows.length === 0 ? (
              <EmptyRows colSpan={7} />
            ) : (
              vat.rows.map((r) => (
                <tr key={r.month}>
                  <td className={TD}>{formatMonthHe(r.month)}</td>
                  <td className={cn(TD, NUM)}>{formatAgorot(r.salesNetAgorot)}</td>
                  <td className={cn(TD, NUM)}>{formatAgorot(r.salesVatAgorot)}</td>
                  <td className={cn(TD, NUM, r.creditNetAgorot > 0 && "text-destructive")}>
                    {formatAgorot(-r.creditNetAgorot)}
                  </td>
                  <td className={cn(TD, NUM, r.creditVatAgorot > 0 && "text-destructive")}>
                    {formatAgorot(-r.creditVatAgorot)}
                  </td>
                  <td className={cn(TD, NUM, "font-semibold")}>
                    {formatAgorot(r.netAgorot)}
                  </td>
                  <td className={cn(TD, NUM, "font-semibold")}>
                    {formatAgorot(r.vatAgorot)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {vat.rows.length > 0 && (
            <tfoot>
              <tr>
                <td className={FOOT_TD}>סה״כ</td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(vat.totals.salesNetAgorot)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(vat.totals.salesVatAgorot)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(-vat.totals.creditNetAgorot)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(-vat.totals.creditVatAgorot)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(vat.totals.netAgorot)}
                </td>
                <td className={cn(FOOT_TD, NUM)}>
                  {formatAgorot(vat.totals.vatAgorot)}
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
  return (
    <ReportCard
      title="מאזן לקוחות"
      subtitle="חיובים מול תקבולים לכל לקוח בטווח — אינפורמטיבי"
      actions={csv}
      foot="יתרה חיובית = הלקוח טרם שילם את מלוא החיובים בטווח. ממוין מהיתרה הגבוהה לנמוכה."
    >
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>לקוח</th>
              <th className={cn(TH, NUM)}>חיובים</th>
              <th className={cn(TH, NUM)}>תקבולים</th>
              <th className={cn(TH, NUM)}>מזה ניכוי במקור</th>
              <th className={cn(TH, NUM)}>יתרה</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRows colSpan={5} />
            ) : (
              rows.map((r) => (
                <tr key={r.clientKey}>
                  <td className={cn(TD, "font-medium")}>{r.buyerName}</td>
                  <td className={cn(TD, NUM)}>{formatAgorot(r.chargedAgorot)}</td>
                  <td className={cn(TD, NUM)}>{formatAgorot(r.receivedAgorot)}</td>
                  <td className={cn(TD, NUM)}>
                    {formatAgorot(r.withholdingAgorot)}
                  </td>
                  <td
                    className={cn(
                      TD,
                      NUM,
                      "font-bold",
                      r.balanceAgorot > 0 && "text-destructive",
                    )}
                  >
                    {formatAgorot(r.balanceAgorot)}
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
            אין נתונים בטווח שנבחר
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
                  {formatAgorot(r.balanceAgorot)}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                חיובים {formatAgorot(r.chargedAgorot)} · תקבולים{" "}
                {formatAgorot(r.receivedAgorot)}
                {r.withholdingAgorot > 0
                  ? ` · ניכוי במקור ${formatAgorot(r.withholdingAgorot)}`
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
        מכין את סיכום ההפקה…
      </div>
    );
  }
  const countRows: Array<[string, string, number]> = [
    ["A100", "רשומת פתיחה", 1],
    ["C100", "כותרת מסמך", summary.counts.C100],
    ["D110", "פרטי מסמך (שורות)", summary.counts.D110],
    ["D120", "פרטי קבלה (תקבולים)", summary.counts.D120],
    ["Z900", "רשומת סיום", 1],
  ];
  return (
    <div className="of-print-area flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-muted-foreground">בית העסק</dt>
        <dd className="font-semibold">
          {summary.business.name} · עוסק {summary.business.vatId}
        </dd>
        {/* the file's declared range (1024/1025) — the server clamps a future
            end date to the production day, per the spec */}
        <dt className="text-muted-foreground">טווח נתונים</dt>
        <dd className="font-semibold">
          {formatDateHe(summary.range.from)} – {formatDateHe(summary.range.to)}
        </dd>
        <dt className="text-muted-foreground">הופק בתאריך</dt>
        <dd className="font-semibold">
          {formatDateHe(summary.generatedDate)} ·{" "}
          {summary.generatedTime.slice(0, 2)}:{summary.generatedTime.slice(2)}
        </dd>
        <dt className="text-muted-foreground">נתיב לחילוץ</dt>
        <dd className="font-mono text-xs [direction:ltr] text-left">
          {summary.savedPath}
        </dd>
        <dt className="text-muted-foreground">תוכנה</dt>
        <dd className="font-semibold">
          {summary.software.name} {summary.software.version} · מס׳ רישום:{" "}
          {summary.software.registrationNumber ?? "טרם נרשם"}
        </dd>
      </dl>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className={TH}>קוד רשומה</th>
              <th className={TH}>תיאור</th>
              <th className={cn(TH, NUM)}>סך רשומות</th>
            </tr>
          </thead>
          <tbody>
            {countRows.map(([code, label, n]) => (
              <tr key={code}>
                <td className={TD}>{code}</td>
                <td className={TD}>{label}</td>
                <td className={cn(TD, NUM)}>{n}</td>
              </tr>
            ))}
            <tr>
              <td className={FOOT_TD} colSpan={2}>
                סה״כ רשומות בקובץ
              </td>
              <td className={cn(FOOT_TD, NUM)}>{summary.counts.total}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
        הקובץ יורד כ-ZIP אחד ובו עץ התיקיות הרשמי (INI.TXT + BKMVDATA.zip) + דף
        הוראות חילוץ. את הדוח הזה ניתן להדפיס — זהו הפלט הנדרש בסיום כל הפקה
        (נספח 4 להוראות). בטווח נכללו {summary.documentCount} מסמכים.
      </div>

      {summary.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
          <b>אזהרות נתונים (לא חוסם):</b>
          <ul className="mt-1 list-inside list-disc">
            {summary.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
