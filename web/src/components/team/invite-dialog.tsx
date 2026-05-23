"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ApiError,
  apiClient,
  type AssignableRole,
  type InvitationDTO,
} from "@/lib/api-client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited?: (invitation: InvitationDTO) => void;
  // True for owners (they can invite as admin). Admins themselves can
  // only invite as employee (enforced server-side regardless).
  canInviteAsAdmin: boolean;
};

export function InviteDialog({
  open,
  onOpenChange,
  onInvited,
  canInviteAsAdmin,
}: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("employee");
  const [loading, setLoading] = useState(false);
  const [lastInvite, setLastInvite] = useState<InvitationDTO | null>(null);

  function resetAndClose() {
    setEmail("");
    setRole("employee");
    setLastInvite(null);
    onOpenChange(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const result = await apiClient.team.invite({ email, role });
      setLastInvite(result);
      toast.success("ההזמנה נוצרה");
      onInvited?.(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error("שגיאה לא צפויה");
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyUrl() {
    if (!lastInvite?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(lastInvite.inviteUrl);
      toast.success("הקישור הועתק");
    } catch {
      toast.error("לא ניתן להעתיק אוטומטית — בחר את הקישור והעתק ידנית");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? resetAndClose() : onOpenChange(o))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>הזמנת חבר/ה לצוות</DialogTitle>
          <DialogDescription>
            המוזמן/ת יקבלו מייל עם קישור לאישור. הקישור תקף ל-7 ימים.
          </DialogDescription>
        </DialogHeader>

        {lastInvite ? (
          // Success state — show the invite URL so the admin can copy it
          // when the email adapter is in console fallback. Always show
          // it (the email is best-effort and may have silently failed).
          <div className="space-y-4">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              ✓ ההזמנה נוצרה ונשלחה ל-
              <span dir="ltr" className="font-mono">
                {lastInvite.email}
              </span>
              .
            </div>

            <div className="space-y-2">
              <Label htmlFor="inviteUrl">קישור ההזמנה</Label>
              <div className="flex gap-2">
                <Input
                  id="inviteUrl"
                  readOnly
                  value={lastInvite.inviteUrl ?? ""}
                  dir="ltr"
                  className="text-start text-xs font-mono"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyUrl}
                  aria-label="העתק קישור"
                >
                  <Copy className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  asChild
                  aria-label="פתח קישור"
                >
                  <a
                    href={lastInvite.inviteUrl ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                אם שליחת המייל לא הוגדרה (Resend), העתק את הקישור ושלח אותו ישירות.
                מי שיקליק יוכל להירשם או להיכנס ולהצטרף למשרד.
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  // Open invite form again for another invitation.
                  setEmail("");
                  setRole("employee");
                  setLastInvite(null);
                }}
              >
                הזמן עוד אחד
              </Button>
              <Button type="button" onClick={resetAndClose}>
                סיום
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">אימייל</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="employee@example.com"
                dir="ltr"
                className="text-start"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-role">תפקיד</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as AssignableRole)}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">עובד</SelectItem>
                  {canInviteAsAdmin && (
                    <SelectItem value="admin">מנהל</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {!canInviteAsAdmin && (
                <p className="text-xs text-muted-foreground">
                  רק בעלי המשרד יכולים להזמין מנהלים נוספים.
                </p>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                ביטול
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "שולח..." : "שלח הזמנה"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
