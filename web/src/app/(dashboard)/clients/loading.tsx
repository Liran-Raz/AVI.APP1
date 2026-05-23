import { Skeleton } from "@/components/ui/skeleton";

// Skeleton matches ClientsPage layout 1:1 — same container max-width,
// same header, same filter bar, then a table-like card with a header row
// and several body rows.
export default function ClientsLoading() {
  const ROWS = 6;

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-6xl">
      {/* Header: title + action button */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Filter bar: search + 2 selects + counter */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Skeleton className="h-9 flex-1 min-w-[200px]" />
        <Skeleton className="h-9 w-[180px]" />
        <Skeleton className="h-9 w-[140px]" />
        <Skeleton className="h-4 w-24 mr-auto" />
      </div>

      {/* Table card */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        {/* Table header row */}
        <div className="grid grid-cols-[1.5fr_1fr_1fr_1.5fr_100px_40px] gap-4 px-4 py-3 border-b border-border">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-14" />
          <span />
        </div>

        {/* Table body rows */}
        {Array.from({ length: ROWS }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[1.5fr_1fr_1fr_1.5fr_100px_40px] gap-4 px-4 py-4 border-b border-border last:border-b-0 items-center"
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
