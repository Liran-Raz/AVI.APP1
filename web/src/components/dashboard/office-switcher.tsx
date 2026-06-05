"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type SwitcherOffice = {
  orgId: string;
  name: string;
  role: "owner" | "admin" | "employee";
};

const ROLE_LABEL: Record<SwitcherOffice["role"], string> = {
  owner: "בעלים",
  admin: "מנהל",
  employee: "עובד",
};

// Office switcher shown in the app shell ONLY when the user belongs to
// more than one office. With a single office the shell renders a plain
// label (unchanged from before multi-office), so single-office UX is
// untouched.
export function OfficeSwitcher({
  offices,
  activeOrgId,
}: {
  offices: SwitcherOffice[];
  activeOrgId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const active =
    offices.find((o) => o.orgId === activeOrgId) ?? offices[0];

  function switchTo(orgId: string) {
    if (orgId === activeOrgId || isPending) return;
    startTransition(async () => {
      try {
        const { apiClient } = await import("@/lib/api-client");
        await apiClient.me.setActiveOrg(orgId);
      } catch {
        // Best-effort: on failure we stay on the current office. The
        // server is the source of truth; a failed switch changes nothing.
        return;
      }
      // Re-render every server component in the new active-office scope.
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          className={cn(
            "flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors max-w-[10rem]",
            isPending && "opacity-60",
          )}
        >
          <span className="truncate">{active.name}</span>
          <ChevronsUpDown className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>המשרדים שלי</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {offices.map((o) => (
          <DropdownMenuItem
            key={o.orgId}
            onClick={() => switchTo(o.orgId)}
            className="gap-2"
          >
            <Building2 className="size-4 text-muted-foreground" />
            <div className="flex flex-col flex-1 min-w-0">
              <span className="truncate">{o.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {ROLE_LABEL[o.role]}
              </span>
            </div>
            {o.orgId === activeOrgId && (
              <Check className="size-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
