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

  // Flat capability hint (display only; server is authoritative). The
  // per-row relational rules below (owner-protection, only-owner-promotes-
  // to-admin) still use currentUserRole — they are relational invariants that
  // a flat capability cannot express; the server enforces them regardless.
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

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        {members.length === 0 ? (
          <EmptyState
            canManage={canManage}
            onInvite={() => setInviteOpen(true)}
          />
        ) : (
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
                const isSelf = m.id === currentUserId;
                const isOwner = m.role === "owner";
                // Permissions for actions on this row:
                //  - owner can act on any row except self for role change
                //  - admin can act on employees, cannot touch owners
                //  - nobody can change their own role / deactivate self
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
                const showMenu = canChangeRole || canDeactivate;

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
                          {isSelf && (
                            <span className="text-muted-foreground text-xs"> (אני)</span>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {m.email}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="gap-1"
                      >
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
                      {showMenu && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`פעולות עבור ${m.fullName}`}
                              disabled={busyMemberId === m.id}
                            >
                              {busyMemberId === m.id ? (
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
                            {canChangeRole && m.role !== "admin" && (
                              <DropdownMenuItem
                                onClick={() => handleChangeRole(m, "admin")}
                              >
                                <ShieldCheck className="size-4" />
                                הפוך למנהל
                              </DropdownMenuItem>
                            )}
                            {canChangeRole && m.role !== "employee" && (
                              <DropdownMenuItem
                                onClick={() => handleChangeRole(m, "employee")}
                              >
                                <User className="size-4" />
                                הפוך לעובד
                              </DropdownMenuItem>
                            )}
                            {canDeactivate && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDeactivate(m)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <UserMinus className="size-4" />
                                  הסר מהמשרד
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

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
