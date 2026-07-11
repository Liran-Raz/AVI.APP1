// A single KPI stat tile for the owner dashboard (Stage 13 R4). Presentational
// only — glass-card chrome, a big number, a Hebrew label, and a thin colored
// accent bar. `tone="alert"` tints the number (used for "באיחור"). Server-
// renderable (no hooks / no "use client").

export function KpiCard({
  label,
  value,
  colorVar,
  tone = "normal",
  hint,
}: {
  label: string;
  value: number;
  // CSS custom-property name for the accent (e.g. "--primary"). Theme-aware.
  colorVar: string;
  tone?: "normal" | "alert";
  hint?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border glass-card shadow-card p-4">
      <div
        className="absolute inset-y-0 right-0 w-1"
        style={{ backgroundColor: `var(${colorVar})` }}
        aria-hidden
      />
      <div className="text-sm text-muted-foreground">{label}</div>
      <div
        className="mt-1 text-3xl font-bold tabular-nums"
        style={tone === "alert" ? { color: `var(${colorVar})` } : undefined}
      >
        {value.toLocaleString("he-IL")}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}
