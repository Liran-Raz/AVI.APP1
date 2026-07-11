import { Skeleton } from "@/components/ui/skeleton";

// Matches MessagesPage: conversation list (right) + thread (left).
export default function MessagesLoading() {
  return (
    <div className="h-full flex">
      <aside className="hidden md:flex w-72 border-l border-border flex-col p-3 gap-3">
        <Skeleton className="h-6 w-24" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </aside>
      <section className="flex-1 flex flex-col">
        <div className="h-14 border-b border-border flex items-center gap-2 px-4">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex-1 p-4 space-y-3">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-10 w-2/5 ml-auto" />
          <Skeleton className="h-10 w-1/3" />
        </div>
      </section>
    </div>
  );
}
