"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Crown,
  LayoutDashboard,
  Loader2,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  User,
  UserMinus,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  apiClient,
  type AssignableRole,
  type MemberDTO,
} from "@/lib/api-client";
import { hasCapability, PERMISSIONS, type Capability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";

import { InviteDialog } from "./invite-dialog";

type Role = "owner" | "admin" | "employee";

function roleIcon(role: Role) {
  switch (role) {
    case "owner":
      return <Crown className="size-3" />;
    case "admin":
      return <ShieldCheck className="size-3" />;
    default:
      return <User className="size-3" />;
  }
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

// Per-row action permissions. These are relational invariants (owner
// protection, only-owner-promotes-to-admin) that a flat capability can't
// express; the server enforces them regardless. Computed once per member so
// the desktop table row and the mobile card behave identically.
type RowPerms = {
  isSelf: boolean;
  canChangeRole: boolean;
  canDeactivate: boolean;
  canManageDashboard: boolean;
  showMenu: boolean;
};

function rowPerms(
  m: MemberDTO,
  currentUserId: string,
  currentUserRole: Role,
  canManage: boolean,
): RowPerms {
  const isSelf = m.id === currentUserId;
  const isOwner = m.role === "owner";
  // owner can act on any row except self; admin can act on employees, not
  // owners; nobody can change their own role / deactivate self.
  const canChangeRole =
    canManage &&
    !isSelf &&
    (currentUserRole === "owner" ||
      (currentUserRole === "admin" && !isOwner));
  const canDeactivate =
    canManage &&
    !isSelf &&
    m.isActive &&
    (currentUserRole === "owner" ||
      (currentUserRole === "admin" && !isOwner));
  // Dashboard access (Stage 13 R4): OWNER-ONLY, on any non-owner row (owners
  // always have access, so no toggle on an owner). Server re-enforces.
  const canManageDashboard = currentUserRole === "owner" && !isOwner;
  return {
    isSelf,
    canChangeRole,
    canDeactivate,
    canManageDashboard,
    showMenu: canChangeRole || canDeactivate || canManageDashboard,
  };
}

export function TeamPage({
  initialItems,
  currentUserId,
  currentUserRole,
  capabilities,
}: {
  initialItems: MemberDTO[];
  currentUserId: string;
  currentUserRole: Role;
  capabilities: Capability[];
}) {
  const t = useT();
  const [members, setMembers] = useState<MemberDTO[]>(initialItems);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  // Flat capability hint (display only; server is authoritative).
  const canManage = hasCapability(capabilities, PERMISSIONS.TEAM_INVITE);

  // Sort: self first, then owners, admins, employees, by createdAt within group.
  const sortedMembers = useMemo(() => {
    const roleOrder: Record<Role, number> = { owner: 0, admin: 1, employee: 2 };
    return members.slice().sort((a, b) => {
      if (a.id === currentUserId) return -1;
      if (b.id === currentUserId) return 1;
      const r = roleOrder[a.role] - roleOrder[b.role];
      if (r !== 0) return r;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [members, currentUserId]);

  async function handleChangeRole(member: MemberDTO, role: AssignableRole) {
    if (busyMemberId) return;
    setBusyMemberId(member.id);
    try {
      const updated = await apiClient.team.changeRole(member.id, { role });
      setMembers((prev) =>
        prev.map((m) => (m.id === updated.id ? updated : m)),
      );
      toast.success(t("team.roleChange.updated"));
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handleToggleDashboardAccess(member: MemberDTO) {
    if (busyMemberId) return;
    setBusyMemberId(member.id);
    try {
      const updated = await apiClient.team.setDashboardAccess(
        member.id,
        !member.dashboardAccess,
      );
      setMembers((prev) =>
        prev.map((m) => (m.id === updated.id ? updated : m)),
      );
      toast.success(
        updated.dashboardAccess
          ? t("team.dashboardAccess.granted")
          : t("team.dashboardAccess.blocked"),
      );
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handleDeactivate(member: MemberDTO) {
    if (busyMemberId) return;
    if (!window.confirm(t("team.deactivate.confirm", { name: member.fullName }))) {
      return;
    }
    setBusyMemberId(member.id);
    try {
      const updated = await apiClient.team.deactivate(member.id);
      setMembers((prev) =>
        prev.map((m) => (m.id === updated.id ? updated : m)),
      );
      toast.success(t("team.deactivate.done"));
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t("common.unexpectedError"));
        console.error(err);
      }
    } finally {
      setBusyMemberId(null);
    }
  }

  function handleInvited() {
    // No-op for now: pending invitations don't appear in the member
    // list (only after accept). A future iteration could optimistically
    // surface a "pending invitations" pill.
  }

  const activeCount = members.filter((m) => m.isActive).length;
  const inactiveCount = members.length - activeCount;

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{t("team.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("team.subtitle")}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="size-4" />
            {t("team.invite")}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 mb-4 text-xs text-muted-foreground">
        <span>{t("team.activeCount", { count: activeCount })}</span>
        {inactiveCount > 0 && (
          <>
            <span>·</span>
            <span>{t("team.inactiveCount", { count: inactiveCount })}</span>
          </>
        )}
      </div>

      {members.length === 0 ? (
        <div className="border border-border rounded-lg glass-card shadow-card overflow-hidden">
          <EmptyState canManage={canManage} onInvite={() => setInviteOpen(true)} />
        </div>
      ) : (
        <>
          {/* Desktop: table (md and up). */}
          <div className="hidden md:block border border-border rounded-lg glass-card shadow-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("team.table.name")}</TableHead>
                  <TableHead>{t("common.email")}</TableHead>
                  <TableHead>{t("team.table.role")}</TableHead>
                  <TableHead>{t("team.table.status")}</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMembers.map((m) => {
                  const perms = rowPerms(m, currentUserId, currentUserRole, canManage);
                  return (
                    <TableRow key={m.id} className={!m.isActive ? "opacity-60" : ""}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                              {initials(m.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <span>
                            {m.fullName}
                            {perms.isSelf && (
                              <span className="text-muted-foreground text-xs">{t("team.selfSuffix")}</span>
                            )}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {m.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1">
                          {roleIcon(m.role)}
                          {t(`role.${m.role}` as MessageKey)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 flex-wrap">
                          {m.isActive ? (
                            <Badge variant="secondary">{t("team.status.active")}</Badge>
                          ) : (
                            <Badge variant="outline">{t("team.status.inactive")}</Badge>
                          )}
                          {m.dashboardAccess && m.role !== "owner" && (
                            <Badge variant="outline" className="gap-1">
                              <LayoutDashboard className="size-3" />
                              {t("team.dashboardBadge")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <MemberActionsMenu
                          member={m}
                          perms={perms}
                          busy={busyMemberId === m.id}
                          onChangeRole={handleChangeRole}
                          onDeactivate={handleDeactivate}
                          onToggleDashboard={handleToggleDashboardAccess}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards (below md). Everything the table shows —
              incl. the actions menu — stays reachable in portrait. */}
          <div className="md:hidden space-y-3">
            {sortedMembers.map((m) => {
              const perms = rowPerms(m, currentUserId, currentUserRole, canManage);
              return (
                <MemberCard
                  key={m.id}
                  member={m}
                  perms={perms}
                  busy={busyMemberId === m.id}
                  onChangeRole={handleChangeRole}
                  onDeactivate={handleDeactivate}
                  onToggleDashboard={handleToggleDashboardAccess}
                />
              );
            })}
          </div>
        </>
      )}

      {canManage && (
        <InviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onInvited={handleInvited}
          canInviteAsAdmin={currentUserRole === "owner"}
        />
      )}
    </div>
  );
}

// Shared actions dropdown — used by both the desktop table row and the
// mobile card so role-change / deactivate behave identically. Renders
// nothing when the viewer has no permitted action on this member.
function MemberActionsMenu({
  member,
  perms,
  busy,
  onChangeRole,
  onDeactivate,
  onToggleDashboard,
}: {
  member: MemberDTO;
  perms: RowPerms;
  busy: boolean;
  onChangeRole: (m: MemberDTO, role: AssignableRole) => void;
  onDeactivate: (m: MemberDTO) => void;
  onToggleDashboard: (m: MemberDTO) => void;
}) {
  const t = useT();
  if (!perms.showMenu) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("team.actions.for", { name: member.fullName })}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MoreHorizontal className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("team.actions.roleChangeLabel")}
        </DropdownMenuLabel>
        {perms.canChangeRole && member.role !== "admin" && (
          <DropdownMenuItem onClick={() => onChangeRole(member, "admin")}>
            <ShieldCheck className="size-4" />
            {t("team.actions.makeAdmin")}
          </DropdownMenuItem>
        )}
        {perms.canChangeRole && member.role !== "employee" && (
          <DropdownMenuItem onClick={() => onChangeRole(member, "employee")}>
            <User className="size-4" />
            {t("team.actions.makeEmployee")}
          </DropdownMenuItem>
        )}
        {perms.canManageDashboard && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onToggleDashboard(member)}>
              <LayoutDashboard className="size-4" />
              {member.dashboardAccess
                ? t("team.actions.blockDashboard")
                : t("team.actions.openDashboard")}
            </DropdownMenuItem>
          </>
        )}
        {perms.canDeactivate && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDeactivate(member)}
              className="text-destructive focus:text-destructive"
            >
              <UserMinus className="size-4" />
              {t("team.actions.remove")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Mobile row rendered as a self-contained card (portrait-friendly).
function MemberCard({
  member: m,
  perms,
  busy,
  onChangeRole,
  onDeactivate,
  onToggleDashboard,
}: {
  member: MemberDTO;
  perms: RowPerms;
  busy: boolean;
  onChangeRole: (m: MemberDTO, role: AssignableRole) => void;
  onDeactivate: (m: MemberDTO) => void;
  onToggleDashboard: (m: MemberDTO) => void;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "rounded-lg border border-border glass-card shadow-card p-4",
        !m.isActive && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="size-9">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
              {initials(m.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-medium truncate">
              {m.fullName}
              {perms.isSelf && (
                <span className="text-muted-foreground text-xs">{t("team.selfSuffix")}</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground truncate" dir="ltr">
              {m.email}
            </p>
          </div>
        </div>
        <MemberActionsMenu
          member={m}
          perms={perms}
          busy={busy}
          onChangeRole={onChangeRole}
          onDeactivate={onDeactivate}
          onToggleDashboard={onToggleDashboard}
        />
      </div>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <Badge variant="outline" className="gap-1">
          {roleIcon(m.role)}
          {t(`role.${m.role}` as MessageKey)}
        </Badge>
        {m.isActive ? (
          <Badge variant="secondary">{t("team.status.active")}</Badge>
        ) : (
          <Badge variant="outline">{t("team.status.inactive")}</Badge>
        )}
        {m.dashboardAccess && m.role !== "owner" && (
          <Badge variant="outline" className="gap-1">
            <LayoutDashboard className="size-3" />
            {t("team.dashboardBadge")}
          </Badge>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  canManage,
  onInvite,
}: {
  canManage: boolean;
  onInvite: () => void;
}) {
  const t = useT();
  return (
    <div className="p-12 text-center">
      <div className="size-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
        <Users className="size-6" />
      </div>
      <h2 className="font-semibold text-lg mb-2">{t("team.empty.title")}</h2>
      <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
        {t("team.empty.hint")}
      </p>
      {canManage && (
        <Button onClick={onInvite}>
          <Plus className="size-4" />
          {t("team.empty.invite")}
        </Button>
      )}
    </div>
  );
}
