"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquare,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  UserSquare2,
  X,
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
  { href: "/messages", label: "הודעות", icon: MessageSquare },
  { href: "/settings", label: "הגדרות", icon: Settings },
];

// Mobile bottom bar shows ONLY these 3 everyday screens (in this order — Liran's
// pick) + a "תפריט" button that opens the full navigation drawer. Everything
// else (לוח שבועי, צוות, דשבורד, תפקידים, הגדרות) lives in the drawer.
const MOBILE_BAR_HREFS = ["/tasks", "/clients", "/messages"];

const ROLE_LABELS: Record<"owner" | "admin" | "employee", string> = {
  owner: "בעלים",
  admin: "מנהל",
  employee: "עובד",
};

export function AppShell({
  profile,
  organization,
  memberships = [],
  activeOrgId,
  showRolesNav = false,
  showDashboardNav = false,
  showInvoicingNav = false,
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
  // Reveal the "הנהלת חשבונות" (invoicing, DEV-026) nav entry. Gated server-side
  // by the INVOICING_UI flag AND invoices.view. Default false => unchanged.
  showInvoicingNav?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Mobile navigation drawer (slides in from the right, RTL). Closed by the
  // scrim, the X, Escape, or tapping any nav link. Desktop is untouched.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Unread chat messages → a badge on the "הודעות" nav entry (Stage 14 / R3).
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // Lock background scroll while the drawer is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  // Poll the unread-messages total for the nav badge; paused when the tab is hidden.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const u = await apiClient.messages.unread();
        if (!cancelled) setUnreadMessages(u.total);
      } catch {
        // non-critical
      }
    };
    void load();
    const t = setInterval(load, 5000);
    const onVis = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Compose the nav from the base items. Insertions are index-safe (found by
  // href) so they compose regardless of which flags are on.
  let navItems = [...NAV_ITEMS];
  // Invoicing (DEV-026): right after "לקוחות" (clients) — billing follows clients.
  if (showInvoicingNav) {
    const clientsIdx = navItems.findIndex((i) => i.href === "/clients");
    const at = clientsIdx >= 0 ? clientsIdx + 1 : navItems.length;
    navItems = [
      ...navItems.slice(0, at),
      { href: "/invoicing", label: "הנהלת חשבונות", icon: Receipt },
      ...navItems.slice(at),
    ];
  }
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

  // The 4 fixed bottom-bar tabs (none is role-gated, so NAV_ITEMS always has
  // them). The drawer shows the FULL navItems list incl. gated entries.
  const mobileBarItems = MOBILE_BAR_HREFS.map((href) =>
    NAV_ITEMS.find((i) => i.href === href),
  ).filter((i): i is (typeof NAV_ITEMS)[number] => Boolean(i));

  // Drawer layout: everything except הגדרות, a separator, then הגדרות.
  const drawerMainItems = navItems.filter((i) => i.href !== "/settings");
  const drawerSettingsItem = navItems.find((i) => i.href === "/settings");

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
                <span className="flex-1">{item.label}</span>
                {item.href === "/messages" && unreadMessages > 0 ? (
                  <span className="min-w-[20px] rounded-full bg-[#16a34a] px-1.5 text-center text-[11px] font-bold text-white">
                    {unreadMessages > 99 ? "99+" : unreadMessages}
                  </span>
                ) : null}
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

      {/* Main. min-w-0 is CRITICAL: as a flex item this column defaults to
          min-width:auto, so the scrollable mobile nav's min-content width
          (6+ fixed-size tabs) would otherwise force the whole column wider
          than the viewport — panning the entire page sideways on mobile.
          With min-w-0 the column stays at viewport width and the nav
          scrolls INTERNALLY as intended. */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="topbar-safe border-b border-border glass-topbar flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
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

        {/* Mobile bottom bar — the 4 everyday screens + a "תפריט" button that
            opens the full navigation drawer. Fixed set, so no scrolling needed;
            overflow-x-auto stays as a safety net for very narrow screens. */}
        <nav className="md:hidden order-last border-t border-border glass-mobilenav flex overflow-x-auto no-scrollbar sticky bottom-0 z-30 pb-safe">
          {mobileBarItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2 px-1 grow shrink-0 min-w-[4rem]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="relative">
                  <item.icon className="size-5" />
                  {item.href === "/messages" && unreadMessages > 0 ? (
                    <span className="absolute -end-2 -top-1.5 flex min-w-[16px] items-center justify-center rounded-full bg-[#16a34a] px-1 text-[10px] font-bold leading-tight text-white">
                      {unreadMessages > 99 ? "99+" : unreadMessages}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="פתיחת תפריט הניווט"
            className="flex flex-col items-center justify-center gap-1 py-2 px-1 grow shrink-0 min-w-[4rem] text-muted-foreground"
          >
            <Menu className="size-5" />
            <span className="text-xs whitespace-nowrap">תפריט</span>
          </button>
        </nav>

        {/* Mobile navigation drawer (approved mockup: navy glass, like the
            desktop sidebar). position:fixed → zero layout impact on the page
            (no min-content propagation — see the min-w-0 lesson above). */}
        <div
          className={cn(
            "md:hidden fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] transition-opacity duration-200",
            drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="תפריט ניווט"
          className={cn(
            "md:hidden fixed inset-y-0 right-0 z-50 w-[300px] max-w-[85vw] flex flex-col",
            "glass-sidebar text-sidebar-foreground border-l border-white/10 shadow-2xl",
            "transition-transform duration-300 ease-out",
            drawerOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          {/* Header: logo + office (or switcher) + close */}
          <div className="flex items-center gap-2.5 px-4 pt-drawer-safe pb-3">
            <div className="size-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold shadow-[0_8px_18px_-6px_rgba(2,106,255,0.6)]">
              א
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-sm text-white leading-tight">AVI.APP</span>
              {memberships.length > 1 && activeOrgId ? (
                <OfficeSwitcher offices={memberships} activeOrgId={activeOrgId} />
              ) : (
                <span className="text-xs text-sidebar-foreground/80 truncate">
                  {organization.name}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="סגירת התפריט"
              className="ms-auto p-2 rounded-md text-sidebar-foreground hover:bg-white/5 hover:text-white"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Account card */}
          <div className="mx-3 mb-2 rounded-xl bg-white/5 px-3 py-2.5 flex items-center gap-3">
            <Avatar className="size-9">
              <AvatarFallback className="bg-primary/15 text-[#8db8ff] text-xs font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{profile.full_name}</p>
              <p className="text-[11px] text-sidebar-foreground/75 truncate" dir="ltr">
                {profile.email}
              </p>
            </div>
            <span className="ms-auto shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-white">
              {ROLE_LABELS[profile.role]}
            </span>
          </div>

          {/* Full navigation */}
          <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {drawerMainItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium nav-active-glow"
                      : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
                  )}
                >
                  <item.icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  {item.href === "/messages" && unreadMessages > 0 ? (
                    <span className="min-w-[20px] rounded-full bg-[#16a34a] px-1.5 text-center text-[11px] font-bold text-white">
                      {unreadMessages > 99 ? "99+" : unreadMessages}
                    </span>
                  ) : null}
                </Link>
              );
            })}
            {drawerSettingsItem ? (
              <>
                <div className="border-t border-white/10 my-2" />
                <Link
                  href={drawerSettingsItem.href}
                  onClick={() => setDrawerOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
                    pathname === drawerSettingsItem.href ||
                      pathname.startsWith(`${drawerSettingsItem.href}/`)
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium nav-active-glow"
                      : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
                  )}
                >
                  <drawerSettingsItem.icon className="size-4" />
                  {drawerSettingsItem.label}
                </Link>
              </>
            ) : null}
          </nav>

          {/* Footer: office code + logout */}
          <div className="border-t border-white/10 px-3 pb-drawer-safe pt-2">
            <div className="text-xs text-sidebar-foreground/70 px-3 pb-2">
              קוד משרד: <span className="font-mono text-white/90">{organization.org_code}</span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 px-3 py-2.5 rounded-md text-sm text-red-300 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="size-4" />
              התנתקות
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
