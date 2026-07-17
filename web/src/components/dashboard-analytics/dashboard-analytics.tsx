"use client";

import type { DashboardStatsDTO } from "@/lib/api-client";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";

import { KpiCard } from "./kpi-card";
import { DonutChart } from "./donut-chart";
import { BarChart, type BarItem } from "./bar-chart";
import { TrendChart } from "./trend-chart";

// Owner dashboard layout (Stage 13 R4). Pure presentation — receives the
// server-computed stats and arranges KPI cards + hand-rolled charts on the Calm
// glass surface. Localized on the client (DEV-010): the server DTO carries a
// stable `key` per slice and the UI derives every label from it (the server's
// Hebrew `label` field is ignored).

function SectionCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-border glass-card shadow-card p-4 md:p-5 ${className ?? ""}`}
    >
      <header className="mb-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {subtitle ? (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

// `localeTag` is a BCP-47 tag from intlLocale(useLocale()) — keeps the date in
// the active UI language instead of a hardcoded "he-IL".
function formatUpdated(iso: string, localeTag: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(localeTag, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DashboardAnalytics({
  stats,
  officeName,
}: {
  stats: DashboardStatsDTO;
  officeName: string;
}) {
  const t = useT();
  const localeTag = intlLocale(useLocale());

  // Status slices carry a stable board-bucket key (todo / in_progress / done);
  // localize it from the shared kanban.* catalog.
  const statusSlices = stats.byStatus.map((s) => ({
    ...s,
    label: t(`kanban.${s.key}` as MessageKey),
  }));
  // Priority slices carry the priority key (urgent / normal / optional);
  // localize from the shared taskPriority.* catalog.
  const priorityBars: BarItem[] = stats.byPriority.map((p) => ({
    key: p.key,
    label: t(`taskPriority.${p.key}` as MessageKey),
    count: p.count,
    colorVar: p.colorVar,
  }));
  const memberBars: BarItem[] = stats.byMember.map((m) => ({
    key: m.userId || "unassigned",
    label: m.name,
    count: m.count,
    colorVar: "--primary",
  }));
  const clientBars: BarItem[] = stats.topClients.map((c) => ({
    key: c.clientId,
    label: c.name,
    count: c.count,
    colorVar: "--primary",
  }));

  return (
    <div className="p-4 md:p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-foreground">{t("dashboard.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {officeName} ·{" "}
          {t("dashboard.updatedAt", {
            date: formatUpdated(stats.generatedAt, localeTag),
          })}
        </p>
      </header>

      {stats.truncated ? (
        <div className="rounded-md border border-[var(--priority-urgent)]/30 bg-[var(--priority-urgent)]/5 px-4 py-2 text-sm text-foreground">
          {t("dashboard.truncatedNote")}
        </div>
      ) : null}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label={t("dashboard.kpi.active")} value={stats.totals.active} colorVar="--primary" />
        <KpiCard label={t("dashboard.kpi.open")} value={stats.totals.open} colorVar="--status-in-progress" />
        <KpiCard label={t("dashboard.kpi.done")} value={stats.totals.done} colorVar="--status-done" />
        <KpiCard
          label={t("dashboard.kpi.overdue")}
          value={stats.totals.overdue}
          colorVar="--priority-urgent"
          tone="alert"
          hint={t("dashboard.kpi.overdueHint")}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title={t("dashboard.chart.byStatus.title")}
          subtitle={t("dashboard.chart.byStatus.subtitle")}
        >
          <DonutChart slices={statusSlices} centerLabel={t("dashboard.chart.byStatus.center")} />
        </SectionCard>

        <SectionCard title={t("dashboard.chart.byPriority.title")}>
          <BarChart items={priorityBars} />
        </SectionCard>

        <SectionCard
          title={t("dashboard.chart.byMember.title")}
          subtitle={t("dashboard.chart.byMember.subtitle")}
          className="lg:col-span-2"
        >
          <BarChart items={memberBars} emptyLabel={t("dashboard.chart.byMember.empty")} />
        </SectionCard>

        <SectionCard
          title={t("dashboard.chart.trend.title")}
          subtitle={t("dashboard.chart.trend.subtitle")}
          className="lg:col-span-2"
        >
          <TrendChart points={stats.weeklyTrend} />
        </SectionCard>

        {clientBars.length > 0 ? (
          <SectionCard
            title={t("dashboard.chart.topClients.title")}
            subtitle={t("dashboard.chart.topClients.subtitle")}
            className="lg:col-span-2"
          >
            <BarChart items={clientBars} />
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
