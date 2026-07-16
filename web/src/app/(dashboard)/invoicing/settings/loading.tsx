import { Skeleton } from "@/components/ui/skeleton";

// Skeleton matches InvoicingPage (R1) — header + readiness banner + a
// settings-card with form-row pairs.
export default function InvoicingLoading() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <Skeleton className="h-14 w-full rounded-lg" />

      <div className="border border-border rounded-lg bg-card p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  );
}
