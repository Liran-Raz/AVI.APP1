import type { DashboardStatsDTO } from "@/lib/api-client";

import { KpiCard } from "./kpi-card";
import { DonutChart } from "./donut-chart";
import { BarChart, type BarItem } from "./bar-chart";
import { TrendChart } from "./trend-chart";

// Owner dashboard layout (Stage 13 R4). Pure presentation — receives the
// server-computed stats and arranges KPI cards + hand-rolled charts on the Calm
// glass surface. Server-renderable (no hooks / no "use client").

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

function formatUpdated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("he-IL", {
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
  const priorityBars: BarItem[] = stats.byPriority.map((p) => ({
    key: p.key,
    label: p.label,
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
        <h1 className="text-xl font-bold text-foreground">דשבורד ניהולי</h1>
        <p className="text-sm text-muted-foreground">
          {officeName} · עודכן {formatUpdated(stats.generatedAt)}
        </p>
      </header>

      {stats.truncated ? (
        <div className="rounded-md border border-[var(--priority-urgent)]/30 bg-[var(--priority-urgent)]/5 px-4 py-2 text-sm text-foreground">
          מוצג מדגם חלקי של המשימות (נפח גדול) — המספרים עשויים להיות נמוכים מהערך המלא.
        </div>
      ) : null}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label='סה"כ פעילות' value={stats.totals.active} colorVar="--primary" />
        <KpiCard label="פתוחות" value={stats.totals.open} colorVar="--status-in-progress" />
        <KpiCard label="הושלמו" value={stats.totals.done} colorVar="--status-done" />
        <KpiCard
          label="באיחור"
          value={stats.totals.overdue}
          colorVar="--priority-urgent"
          tone="alert"
          hint="תאריך יעד עבר, טרם הושלמו"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="פילוח לפי סטטוס" subtitle="כל המשימות הפעילות">
          <DonutChart slices={stats.byStatus} centerLabel="משימות" />
        </SectionCard>

        <SectionCard title="לפי עדיפות">
          <BarChart items={priorityBars} />
        </SectionCard>

        <SectionCard
          title="עומס לפי איש צוות"
          subtitle="משימות פתוחות (חדשות + במעקב)"
          className="lg:col-span-2"
        >
          <BarChart items={memberBars} emptyLabel="אין משימות פתוחות" />
        </SectionCard>

        <SectionCard
          title="קצב — נוצרו מול הושלמו"
          subtitle="8 השבועות האחרונים"
          className="lg:col-span-2"
        >
          <TrendChart points={stats.weeklyTrend} />
        </SectionCard>

        {clientBars.length > 0 ? (
          <SectionCard
            title="לקוחות מובילים"
            subtitle="לפי מספר משימות פעילות"
            className="lg:col-span-2"
          >
            <BarChart items={clientBars} />
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
