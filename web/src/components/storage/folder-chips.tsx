"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// The fixed-taxonomy folder chip row (client 4 / office 5). Purely a selector —
// the active chip drives which AttachmentsPanel scope renders.

export type FolderChip = {
  key: string;
  label: string;
  icon: LucideIcon;
  dashed?: boolean;
};

export function FolderChips({
  folders,
  active,
  onSelect,
}: {
  folders: FolderChip[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {folders.map((f) => {
        const on = f.key === active;
        const Icon = f.icon;
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onSelect(f.key)}
            aria-pressed={on}
            className={cn(
              "inline-flex items-center gap-2 text-sm font-semibold rounded-lg px-3 py-2 border transition-colors",
              f.dashed && "border-dashed",
              on
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-border hover:text-foreground",
            )}
          >
            <Icon className="size-4 opacity-80" />
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
