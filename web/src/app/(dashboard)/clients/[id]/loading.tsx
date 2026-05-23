import { Skeleton } from "@/components/ui/skeleton";

// Skeleton matches ClientDetail layout 1:1 — back button, header card
// (avatar + name + status badge + 4-field info grid), contacts section
// (heading + add button + 2-column grid of contact cards).
export default function ClientDetailLoading() {
  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-5xl">
      {/* Back button */}
      <div className="mb-4">
        <Skeleton className="h-8 w-32" />
      </div>

      {/* Client header card */}
      <div className="border border-border rounded-lg bg-card shadow-card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <Skeleton className="size-12 rounded-lg" />
            <div className="space-y-2 pt-1">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>

        {/* Info grid: email, phone, address */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          <div className="space-y-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>

      {/* Contacts section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>

        {/* 2-column grid of contact card skeletons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card shadow-card p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-7 w-7 rounded-md" />
              </div>
              <Skeleton className="h-4 w-24" />
              <div className="space-y-1 pt-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-36" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
