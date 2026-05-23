import { Skeleton } from "@/components/ui/skeleton";

// Skeleton matches TeamPage layout 1:1 — container, header (title +
// description + invite button), table card with header row and several
// member rows. Avoids layout shift when the server-rendered page swaps in.
export default function TeamLoading() {
  const ROWS = 4;

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="space-y-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Counter row */}
      <div className="flex items-center mb-4">
        <Skeleton className="h-4 w-20" />
      </div>

      {/* Members table card */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[2fr_1.5fr_1fr_100px_40px] gap-4 px-4 py-3 border-b border-border">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-14" />
          <span />
        </div>

        {/* Body rows */}
        {Array.from({ length: ROWS }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[2fr_1.5fr_1fr_100px_40px] gap-4 px-4 py-4 border-b border-border last:border-b-0 items-center"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
