"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  Eye,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { apiClient, ApiError, type RoleDTO } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RoleFormDialog, type RoleDialogMode } from "./role-form-dialog";

type DialogState = {
  open: boolean;
  mode: RoleDialogMode;
  target: RoleDTO | null;
};

export function RolesPage({
  initialRoles,
  canWrite,
}: {
  initialRoles: RoleDTO[];
  canWrite: boolean;
}) {
  const [roles, setRoles] = useState<RoleDTO[]>(initialRoles);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({
    open: false,
    mode: "create",
    target: null,
  });

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.roles.list();
      setRoles(res.items);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? `שגיאה בטעינת תפקידים: ${err.message}`
          : "שגיאה לא צפויה",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  function open(mode: RoleDialogMode, target: RoleDTO | null) {
    setDialog({ open: true, mode, target });
  }

  async function handleDelete(role: RoleDTO) {
    if (
      !window.confirm(
        `למחוק את התפקיד "${role.name}"? פעולה זו אינה הפיכה.`,
      )
    ) {
      return;
    }
    try {
      await apiClient.roles.delete(role.id);
      toast.success("התפקיד נמחק");
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
    } catch (err) {
      toast.error(
        err instanceof ApiError ? `שגיאה: ${err.message}` : "שגיאה לא צפויה",
      );
    }
  }

  function handleSaved() {
    setDialog((d) => ({ ...d, open: false }));
    void refetch();
  }

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="size-6 text-primary" />
            תפקידים והרשאות
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ניהול תפקידי המשרד וההרשאות שלהם. תפקידי המערכת מוגנים לקריאה בלבד.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              טוען...
            </span>
          )}
          {canWrite && (
            <Button onClick={() => open("create", null)}>
              <Plus className="size-4" />
              תפקיד חדש
            </Button>
          )}
        </div>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        {roles.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            אין תפקידים להצגה.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>שם</TableHead>
                <TableHead>תיאור</TableHead>
                <TableHead>סוג</TableHead>
                <TableHead className="text-center">הרשאות</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">{role.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {role.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    {role.isSystem ? (
                      <Badge variant="secondary">מערכת</Badge>
                    ) : (
                      <Badge variant="outline">מותאם</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {role.permissions.length}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* View is always available to a viewer. */}
                        {(!canWrite || role.isSystem) && (
                          <DropdownMenuItem onClick={() => open("view", role)}>
                            <Eye className="size-4" />
                            צפייה
                          </DropdownMenuItem>
                        )}
                        {canWrite && !role.isSystem && (
                          <DropdownMenuItem onClick={() => open("edit", role)}>
                            <Pencil className="size-4" />
                            עריכה
                          </DropdownMenuItem>
                        )}
                        {canWrite && (
                          <DropdownMenuItem
                            onClick={() => open("duplicate", role)}
                          >
                            <Copy className="size-4" />
                            שכפול
                          </DropdownMenuItem>
                        )}
                        {canWrite && !role.isSystem && (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDelete(role)}
                          >
                            <Trash2 className="size-4" />
                            מחיקה
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <RoleFormDialog
        open={dialog.open}
        mode={dialog.mode}
        target={dialog.target}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSaved={handleSaved}
      />
    </div>
  );
}
