"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  ListChecks,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
  UserSquare2,
} from "lucide-react";

import { NotificationBell } from "@/components/notifications/notification-bell";

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
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Insert the roles entry between "צוות" (team) and "הגדרות" (settings).
  const navItems = showRolesNav
    ? [
        ...NAV_ITEMS.slice(0, 4),
        { href: "/roles", label: "תפקידים", icon: ShieldCheck },
        ...NAV_ITEMS.slice(4),
      ]
    : NAV_ITEMS;

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
      <aside className="hidden md:flex flex-col w-64 border-l border-border bg-sidebar">
        <div className="h-16 flex items-center gap-2 px-4 border-b border-border">
          <div className="size-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">
            א
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-sm">AVI.APP</span>
            {memberships.length > 1 && activeOrgId ? (
              <OfficeSwitcher offices={memberships} activeOrgId={activeOrgId} />
            ) : (
              <span className="text-xs text-muted-foreground truncate">
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
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <div className="text-xs text-muted-foreground px-1">
            קוד משרד: <span className="font-mono">{organization.org_code}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="h-16 border-b border-border bg-background flex items-center justify-between px-4 md:px-6">
          <div className="md:hidden flex items-center gap-2">
            <div className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
              א
            </div>
            <span className="font-bold text-sm">{organization.name}</span>
          </div>

          <div className="flex items-center gap-2 mr-auto">
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
          className="md:hidden order-last border-t border-border bg-background grid sticky bottom-0"
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
