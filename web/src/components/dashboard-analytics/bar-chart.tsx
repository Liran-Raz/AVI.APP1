"use client";

import { intlLocale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/locale-provider";

// Horizontal bar chart for the owner dashboard (Stage 13 R4). Hand-rolled, no
// chart library. Rendered with HTML/CSS rather than SVG <rect>s on purpose:
// the category labels are Hebrew and the app is RTL, and CSS blocks give
// bulletproof right-to-left layout + crisp text where SVG text bidi is fiddly.
// Each fill grows from the inline-start (the right edge in RTL) — the natural
// direction. Bars are scaled to the largest value in the set.

export type BarItem = {
  key: string;
  label: string;
  count: number;
  colorVar: string;
};

export function BarChart({
  items,
  emptyLabel,
}: {
  items: BarItem[];
  emptyLabel?: string;
}) {
  const t = useT();
  const localeTag = intlLocale(useLocale());

  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        {emptyLabel ?? t("dashboard.chart.noData")}
      </div>
    );
  }

  const max = Math.max(1, ...items.map((i) => i.count));

  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const pct = Math.round((item.count / max) * 100);
        return (
          <li key={item.key} className="flex items-center gap-3">
            <span
              className="w-28 shrink-0 truncate text-sm text-foreground text-start"
              title={item.label}
            >
              {item.label}
            </span>
            <div
              className="flex-1 h-6 rounded-md bg-muted/50 overflow-hidden"
              role="img"
              aria-label={`${item.label}: ${item.count}`}
            >
              <div
                className="h-full rounded-md min-w-[2px] transition-[width]"
                style={{
                  width: `${pct}%`,
                  backgroundColor: `var(${item.colorVar})`,
                }}
              />
            </div>
            <span className="w-8 shrink-0 text-sm tabular-nums text-muted-foreground text-end">
              {item.count.toLocaleString(localeTag)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
