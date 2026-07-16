import { Skeleton } from "@/components/ui/skeleton";

// Skeleton matching the reports screen — range bar + KPI strip + one card.
export default function ReportsLoading() {
  const ROWS = 6;
  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="space-y-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-9 w-64 ms-auto" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <div className="border border-border rounded-2xl bg-card overflow-hidden">
        {Array.from({ length: ROWS }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[80px_1fr_100px_100px_100px] gap-4 px-4 py-4 border-b border-border last:border-b-0 items-center"
          >
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
