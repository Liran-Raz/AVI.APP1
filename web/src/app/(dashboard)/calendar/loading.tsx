import { Skeleton } from "@/components/ui/skeleton";

// Skeleton matches CalendarPage layout 1:1 — header, week-nav bar, then
// a 7-column week grid with a header row and several hour rows. Avoids
// layout shift when WeekGrid mounts.
export default function CalendarLoading() {
  // 6 hour rows is enough to fill the typical first viewport (08:00-13:00ish);
  // real WeekGrid renders 08:00-20:00 but the skeleton just needs to occupy
  // visual space, not match exactly.
  const HOUR_ROWS = 6;

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-7xl">
      {/* Header: title + action button */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Week navigation bar: prev/today/next group + week range + counter */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-9" />
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-8 w-9" />
        </div>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-24 mr-auto" />
      </div>

      {/* Week grid: day-header row + hour rows × 7 columns */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        {/* Day header row */}
        <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-border">
          <div className="p-2" />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="p-2 border-r border-border last:border-r-0">
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>

        {/* Hour rows */}
        {Array.from({ length: HOUR_ROWS }).map((_, h) => (
          <div
            key={h}
            className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-border last:border-b-0"
          >
            <div className="p-2">
              <Skeleton className="h-3 w-8" />
            </div>
            {Array.from({ length: 7 }).map((_, d) => (
              <div
                key={d}
                className="p-2 h-16 border-r border-border last:border-r-0"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
