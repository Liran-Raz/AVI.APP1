"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Crown,
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

import { InviteDialog } from "./invite-dialog";

type Role = "owner" | "admin" | "employee";

const ROLE_LABEL: Record<Role, string> = {
  owner: "בעלים",
  admin: "מנהל",
  employee: "עובד",
};

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
  return { isSelf, canChangeRole, canDeactivate, showMenu: canChangeRole || canDeactivate };
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
      toast.success("התפקיד עודכן");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handleDeactivate(member: MemberDTO) {
    if (busyMemberId) return;
    if (
      !window.confirm(
        `להסיר את "${member.fullName}" מהמשרד? המשתמש לא יוכל להיכנס יותר עד שעדכון אקטיבי יקרה ידנית.`,
      )
    ) {
      return;
    }
    setBusyMemberId(member.id);
    try {
      const updated = await apiClient.team.deactivate(member.id);
      setMembers((prev) =>
        prev.map((m) => (m.id === updated.id ? updated : m)),
      );
      toast.success("המשתמש הוסר מהמשרד");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error("שגיאה לא צפויה");
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
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">צוות</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ניהול עובדי המשרד והרשאותיהם
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="size-4" />
            הזמן חבר/ה
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 mb-4 text-xs text-muted-foreground">
        <span>{activeCount} חברים פעילים</span>
        {inactiveCount > 0 && (
          <>
            <span>·</span>
            <span>{inactiveCount} לא פעילים</span>
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
                  <TableHead>שם</TableHead>
                  <TableHead>אימייל</TableHead>
                  <TableHead>תפקיד</TableHead>
                  <TableHead>סטטוס</TableHead>
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
                              <span className="text-muted-foreground text-xs"> (אני)</span>
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
                          {ROLE_LABEL[m.role]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {m.isActive ? (
                          <Badge variant="secondary">פעיל</Badge>
                        ) : (
                          <Badge variant="outline">לא פעיל</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <MemberActionsMenu
                          member={m}
                          perms={perms}
                          busy={busyMemberId === m.id}
                          onChangeRole={handleChangeRole}
                          onDeactivate={handleDeactivate}
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
}: {
  member: MemberDTO;
  perms: RowPerms;
  busy: boolean;
  onChangeRole: (m: MemberDTO, role: AssignableRole) => void;
  onDeactivate: (m: MemberDTO) => void;
}) {
  if (!perms.showMenu) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`פעולות עבור ${member.fullName}`}
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
          שינוי תפקיד
        </DropdownMenuLabel>
        {perms.canChangeRole && member.role !== "admin" && (
          <DropdownMenuItem onClick={() => onChangeRole(member, "admin")}>
            <ShieldCheck className="size-4" />
            הפוך למנהל
          </DropdownMenuItem>
        )}
        {perms.canChangeRole && member.role !== "employee" && (
          <DropdownMenuItem onClick={() => onChangeRole(member, "employee")}>
            <User className="size-4" />
            הפוך לעובד
          </DropdownMenuItem>
        )}
        {perms.canDeactivate && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDeactivate(member)}
              className="text-destructive focus:text-destructive"
            >
              <UserMinus className="size-4" />
              הסר מהמשרד
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
}: {
  member: MemberDTO;
  perms: RowPerms;
  busy: boolean;
  onChangeRole: (m: MemberDTO, role: AssignableRole) => void;
  onDeactivate: (m: MemberDTO) => void;
}) {
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
                <span className="text-muted-foreground text-xs"> (אני)</span>
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
        />
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Badge variant="outline" className="gap-1">
          {roleIcon(m.role)}
          {ROLE_LABEL[m.role]}
        </Badge>
        {m.isActive ? (
          <Badge variant="secondary">פעיל</Badge>
        ) : (
          <Badge variant="outline">לא פעיל</Badge>
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
  return (
    <div className="p-12 text-center">
      <div className="size-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
        <Users className="size-6" />
      </div>
      <h2 className="font-semibold text-lg mb-2">המשרד שלך הוא בן אדם אחד כרגע</h2>
      <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
        כאשר תזמין עובדים, הם יופיעו כאן עם התפקיד והסטטוס שלהם.
      </p>
      {canManage && (
        <Button onClick={onInvite}>
          <Plus className="size-4" />
          הזמן עובד/ת
        </Button>
      )}
    </div>
  );
}
