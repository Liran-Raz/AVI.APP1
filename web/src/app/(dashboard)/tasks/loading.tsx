import { Skeleton } from "@/components/ui/skeleton";

// Skeleton matches TasksPage layout 1:1 — same container, same header row,
// same filter bar shape, same 3-column Kanban grid with cards. Goal is
// zero layout shift when the server-rendered page swaps in.
export default function TasksLoading() {
  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-7xl">
      {/* Header: title + action button */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Filter bar: search + 2 selects + counter */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Skeleton className="h-9 flex-1 min-w-[200px]" />
        <Skeleton className="h-9 w-[160px]" />
        <Skeleton className="h-9 w-[140px]" />
        <Skeleton className="h-4 w-24 mr-auto" />
      </div>

      {/* Kanban: 3 columns, each with 3 card skeletons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((col) => (
          <div
            key={col}
            className="rounded-lg border border-border bg-card/50 p-3 space-y-3"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <div className="space-y-2 min-h-[60px]">
              {[0, 1, 2].map((card) => (
                <div
                  key={card}
                  className="rounded-md border border-border bg-card p-3 space-y-2"
                >
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <div className="flex items-center gap-2 pt-1">
                    <Skeleton className="h-4 w-14 rounded-full" />
                    <Skeleton className="h-3 w-20 mr-auto" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
