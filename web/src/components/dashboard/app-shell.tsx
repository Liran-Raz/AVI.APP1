"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
  UserSquare2,
} from "lucide-react";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { ReportBugButton } from "@/components/bug-report/report-bug-button";
import { TopbarClock } from "@/components/dashboard/topbar-clock";
import { TopbarConnectivity } from "@/components/dashboard/topbar-connectivity";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api-client";
import {
  OfficeSwitcher,
  type SwitcherOffice,
} from "@/components/dashboard/office-switcher";
import type { Organization, Profile } from "@/lib/types/database";

const NAV_ITEMS = [
  { href: "/tasks", label: "תור משימות", icon: ListChecks },
  { href: "/calendar", label: "לוח שבועי", icon: CalendarDays },
  { href: "/clients", label: "לקוחות", icon: UserSquare2 },
  { href: "/team", label: "צוות", icon: Users },
  { href: "/settings", label: "הגדרות", icon: Settings },
];

export function AppShell({
  profile,
  organization,
  memberships = [],
  activeOrgId,
  showRolesNav = false,
  showDashboardNav = false,
  children,
}: {
  profile: Profile;
  organization: Organization;
  // Active offices the user belongs to. When more than one, the sidebar
  // shows an office switcher instead of a static label. Optional + default
  // [] so single-office rendering is byte-for-byte unchanged.
  memberships?: SwitcherOffice[];
  activeOrgId?: string;
  // Reveal the "תפקידים" (roles management) nav entry. Gated server-side by the
  // ROLES_MANAGEMENT_UI flag AND the viewer's roles.view capability. Default
  // false => nav is byte-for-byte unchanged.
  showRolesNav?: boolean;
  // Reveal the "דשבורד" (owner analytics) nav entry — owner-only (Stage 13 R4).
  // Gated server-side by activeRole === "owner". Default false => unchanged.
  showDashboardNav?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Compose the nav from the base items. Insertions are index-safe (found by
  // href) so they compose regardless of which flags are on.
  let navItems = [...NAV_ITEMS];
  // Roles: between "צוות" (team) and "הגדרות" (settings).
  if (showRolesNav) {
    const teamIdx = navItems.findIndex((i) => i.href === "/team");
    const at = teamIdx >= 0 ? teamIdx + 1 : navItems.length;
    navItems = [
      ...navItems.slice(0, at),
      { href: "/roles", label: "תפקידים", icon: ShieldCheck },
      ...navItems.slice(at),
    ];
  }
  // Dashboard: owner-only, first entry.
  if (showDashboardNav) {
    navItems = [
      { href: "/dashboard", label: "דשבורד", icon: LayoutDashboard },
      ...navItems,
    ];
  }

  async function handleLogout() {
    try {
      await apiClient.auth.signOut();
    } catch {
      // signOut is idempotent / best-effort — even if the request fails,
      // we still want to leave the protected area.
    }
    router.push("/login");
    router.refresh();
  }

  const initials = profile.full_name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("");

  return (
    <div className="flex flex-1 min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex flex-col w-64 border-l border-white/10 glass-sidebar text-sidebar-foreground">
        <div className="h-16 flex items-center gap-2 px-4 border-b border-white/10">
          <div className="size-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold shadow-[0_8px_18px_-6px_rgba(2,106,255,0.6)]">
            א
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-sm text-white">AVI.APP</span>
            {memberships.length > 1 && activeOrgId ? (
              <OfficeSwitcher offices={memberships} activeOrgId={activeOrgId} />
            ) : (
              <span className="text-xs text-sidebar-foreground/80 truncate">
                {organization.name}
              </span>
            )}
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium nav-active-glow"
                    : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="text-xs text-sidebar-foreground/70 px-1">
            קוד משרד: <span className="font-mono text-white/90">{organization.org_code}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="h-16 border-b border-border glass-topbar flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
          <div className="md:hidden flex items-center gap-2">
            <div className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
              א
            </div>
            {/* truncate: the topbar gained clock+indicators — a long office
                name must not overflow the mobile header */}
            <span className="font-bold text-sm truncate max-w-[32vw]">
              {organization.name}
            </span>
          </div>

          <div className="flex items-center gap-2 mr-auto">
            <TopbarConnectivity />
            <TopbarClock />
            <ReportBugButton />
            <NotificationBell />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:inline text-sm">{profile.full_name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="font-medium">{profile.full_name}</span>
                    <span className="text-xs text-muted-foreground" dir="ltr">
                      {profile.email}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings className="size-4" />
                    הגדרות
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="size-4" />
                  התנתקות
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Mobile bottom nav */}
        <nav
          className="md:hidden order-last border-t border-border glass-mobilenav grid sticky bottom-0 z-30"
          style={{
            gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))`,
          }}
        >
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2 text-xs",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-5" />
                <span className="text-[10px]">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
