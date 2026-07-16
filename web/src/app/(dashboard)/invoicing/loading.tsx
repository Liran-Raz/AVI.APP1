import { Skeleton } from "@/components/ui/skeleton";

// Skeleton matches the documents list — header + filter bar + table rows.
export default function InvoicingLoading() {
  const ROWS = 6;
  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Skeleton className="h-9 flex-1 min-w-[200px]" />
        <Skeleton className="h-9 w-[160px]" />
        <Skeleton className="h-9 w-[140px]" />
      </div>
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        {Array.from({ length: ROWS }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[100px_1fr_120px_120px_90px] gap-4 px-4 py-4 border-b border-border last:border-b-0 items-center"
          >
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
