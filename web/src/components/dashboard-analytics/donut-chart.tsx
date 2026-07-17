"use client";

import type { CountSlice } from "@/lib/api-client";
import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";

// Hand-rolled SVG donut (Stage 13 R4) — no chart library. Each slice is one
// <circle> sharing the same radius, sized via stroke-dasharray and positioned
// via a cumulative stroke-dashoffset (the classic single-ring donut technique).
// Direction-agnostic, so it needs no RTL handling; the legend beside it is
// HTML and inherits the page's RTL. Native <title> tooltips. Slice labels arrive
// already localized (DEV-010); this component localizes only its own aria-label.

const SIZE = 180;
const STROKE = 30;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const CENTER = SIZE / 2;

export function DonutChart({
  slices,
  centerLabel,
}: {
  slices: CountSlice[];
  centerLabel?: string;
}) {
  const t = useT();
  const localeTag = intlLocale(useLocale());
  const total = slices.reduce((sum, s) => sum + s.count, 0);

  let acc = 0;
  const arcs = slices.map((s) => {
    const frac = total > 0 ? s.count / total : 0;
    const dash = frac * C;
    const el = (
      <circle
        key={s.key}
        cx={CENTER}
        cy={CENTER}
        r={R}
        fill="none"
        stroke={`var(${s.colorVar})`}
        strokeWidth={STROKE}
        strokeDasharray={`${dash} ${C - dash}`}
        strokeDashoffset={-acc}
        // Start at 12 o'clock and go clockwise.
        transform={`rotate(-90 ${CENTER} ${CENTER})`}
      >
        <title>
          {s.label}: {s.count} ({total > 0 ? Math.round(frac * 100) : 0}%)
        </title>
      </circle>
    );
    acc += dash;
    return el;
  });

  return (
    <div className="flex items-center gap-5 flex-wrap justify-center">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={t("dashboard.donut.aria", { total })}
      >
        {/* Track */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R}
          fill="none"
          stroke="var(--border)"
          strokeWidth={STROKE}
          opacity={0.35}
        />
        {total > 0 ? arcs : null}
        <text
          x={CENTER}
          y={CENTER - 4}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: 30, fontWeight: 700 }}
        >
          {total.toLocaleString(localeTag)}
        </text>
        {centerLabel ? (
          <text
            x={CENTER}
            y={CENTER + 18}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 12 }}
          >
            {centerLabel}
          </text>
        ) : null}
      </svg>

      {/* Legend (HTML — RTL-native) */}
      <ul className="space-y-1.5 text-sm">
        {slices.map((s) => {
          const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className="inline-block size-3 rounded-sm shrink-0"
                style={{ backgroundColor: `var(${s.colorVar})` }}
                aria-hidden
              />
              <span className="text-foreground">{s.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {s.count.toLocaleString(localeTag)} · {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
