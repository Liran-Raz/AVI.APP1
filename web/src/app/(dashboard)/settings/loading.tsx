import { Skeleton } from "@/components/ui/skeleton";

// Skeleton matches SettingsPage — container, header, a tab strip, and a
// card of form fields. Avoids layout shift when the page swaps in.
export default function SettingsLoading() {
  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-3xl">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Tab strip */}
      <div className="flex gap-2 mb-4">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>

      {/* Form card */}
      <div className="border border-border rounded-lg glass-card shadow-card p-6 space-y-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}
