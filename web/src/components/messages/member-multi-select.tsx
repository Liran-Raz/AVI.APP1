"use client";

import { Check } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { MemberDTO } from "@/lib/api-client";

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0] ?? "") + (p[1]?.[0] ?? "");
}

// Toggle a value in a Set stored in React state — the shared helper for the pickers.
export function toggleInSet<T>(
  setState: React.Dispatch<React.SetStateAction<Set<T>>>,
  value: T,
): void {
  setState((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

// A touch-friendly multi-select list of members (44px+ rows, 20px checkbox).
// Controlled: the parent owns the `selected` Set. Renders guidance when empty.
export function MemberMultiSelect({
  members,
  selected,
  onToggle,
  emptyLabel = "אין חברי צוות זמינים.",
}: {
  members: MemberDTO[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyLabel?: string;
}) {
  if (members.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {members.map((m) => {
        const isSel = selected.has(m.id);
        return (
          <button
            key={m.id}
            type="button"
            role="checkbox"
            aria-checked={isSel}
            onClick={() => onToggle(m.id)}
            className={cn(
              "flex w-full items-center gap-3 border-b border-border px-3 py-3 text-right transition-colors last:border-b-0",
              isSel ? "bg-primary/5" : "hover:bg-muted/50",
            )}
          >
            <Avatar className="size-9">
              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                {initials(m.fullName)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {m.fullName}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {m.email}
              </span>
            </span>
            {/* Visual indicator only (the row button IS the checkbox — avoids an
                invalid nested <button> and exposes state via aria-checked above). */}
            <span
              aria-hidden
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                isSel
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border",
              )}
            >
              {isSel ? <Check className="size-3.5" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
