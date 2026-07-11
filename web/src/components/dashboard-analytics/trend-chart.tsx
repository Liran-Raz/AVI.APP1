import type { WeekPoint } from "@/lib/api-client";

// Hand-rolled SVG line chart (Stage 13 R4) — created vs completed tasks over the
// last 8 weeks. No chart library. Two polylines + dots over a shared scale, a
// few faint gridlines, week labels on the x-axis. Time runs oldest→newest,
// left→right (the standard time-series convention, even in an RTL UI). Native
// <title> tooltips, zero JS → server-renderable.

const W = 640;
const H = 240;
const PAD_X = 34;
const PAD_TOP = 16;
const PAD_BOTTOM = 40;
const PLOT_W = W - PAD_X * 2;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;
const BASE_Y = PAD_TOP + PLOT_H;

function formatWeek(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

function buildPath(values: number[], xs: number[], yFor: (v: number) => number) {
  return values.map((v, i) => `${i === 0 ? "M" : "L"} ${xs[i]} ${yFor(v)}`).join(" ");
}

export function TrendChart({ points }: { points: WeekPoint[] }) {
  const n = points.length;
  const yMax = Math.max(
    1,
    ...points.map((p) => Math.max(p.created, p.completed)),
  );
  const xFor = (i: number) => (n <= 1 ? PAD_X + PLOT_W / 2 : PAD_X + (i * PLOT_W) / (n - 1));
  const yFor = (v: number) => PAD_TOP + PLOT_H * (1 - v / yMax);
  const xs = points.map((_, i) => xFor(i));

  const createdPath = buildPath(points.map((p) => p.created), xs, yFor);
  const completedPath = buildPath(points.map((p) => p.completed), xs, yFor);

  // Three gridlines: 0, mid, max.
  const gridValues = [0, Math.round(yMax / 2), yMax];

  return (
    <div>
      {/* Legend (HTML — RTL-native) */}
      <div className="flex items-center gap-4 mb-2 text-sm">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm"
            style={{ backgroundColor: "var(--primary)" }}
            aria-hidden
          />
          נוצרו
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm"
            style={{ backgroundColor: "var(--status-done)" }}
            aria-hidden
          />
          הושלמו
        </span>
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="נוצרו מול הושלמו ב-8 השבועות האחרונים"
      >
        {/* Gridlines + y labels */}
        {gridValues.map((v) => {
          const y = yFor(v);
          return (
            <g key={v}>
              <line
                x1={PAD_X}
                y1={y}
                x2={W - PAD_X}
                y2={y}
                stroke="var(--border)"
                strokeWidth={1}
                opacity={0.5}
              />
              <text
                x={PAD_X - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                style={{ fontSize: 10 }}
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* Completed (area + line) */}
        <path
          d={`${completedPath} L ${xs[n - 1]} ${BASE_Y} L ${xs[0]} ${BASE_Y} Z`}
          fill="var(--status-done)"
          opacity={0.1}
        />
        <path
          d={completedPath}
          fill="none"
          stroke="var(--status-done)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Created (line) */}
        <path
          d={createdPath}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dots + tooltips + x labels */}
        {points.map((p, i) => (
          <g key={p.weekStart}>
            <circle cx={xs[i]} cy={yFor(p.completed)} r={3} fill="var(--status-done)">
              <title>
                שבוע {formatWeek(p.weekStart)} — הושלמו: {p.completed}
              </title>
            </circle>
            <circle cx={xs[i]} cy={yFor(p.created)} r={3} fill="var(--primary)">
              <title>
                שבוע {formatWeek(p.weekStart)} — נוצרו: {p.created}
              </title>
            </circle>
            <text
              x={xs[i]}
              y={H - PAD_BOTTOM + 20}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 10 }}
            >
              {formatWeek(p.weekStart)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
