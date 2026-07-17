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
import { useT } from "@/i18n/locale-provider";

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
  const t = useT();
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
      if (result.emailDelivered) {
        toast.success(t("team.inviteDialog.createdSent"));
      } else {
        // Honest: the invitation was created but the email did NOT go out.
        toast.warning(t("team.inviteDialog.createdNotSent"));
      }
      onInvited?.(result);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t("common.unexpectedError"));
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
      toast.success(t("team.inviteDialog.linkCopied"));
    } catch {
      toast.error(t("team.inviteDialog.copyFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? resetAndClose() : onOpenChange(o))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("team.inviteDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("team.inviteDialog.desc")}
          </DialogDescription>
        </DialogHeader>

        {lastInvite ? (
          // Success state — show the invite URL so the admin can copy it.
          // The status banner reflects whether the email actually went out:
          // the email is best-effort and the invitation is usable via the
          // link regardless, but we never claim it was sent when it wasn't.
          <div className="space-y-4">
            {lastInvite.emailDelivered ? (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                {t("team.inviteDialog.sentBannerPrefix")}
                <span dir="ltr" className="font-mono">
                  {lastInvite.email}
                </span>
                .
              </div>
            ) : (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                {t("team.inviteDialog.failBannerPrefix")}
                <span dir="ltr" className="font-mono">
                  {lastInvite.email}
                </span>{" "}
                <strong>{t("team.inviteDialog.failBannerBold")}</strong>
                {t("team.inviteDialog.failBannerSuffix")}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="inviteUrl">{t("team.inviteDialog.linkLabel")}</Label>
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
                  aria-label={t("team.inviteDialog.copyLinkAria")}
                >
                  <Copy className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  asChild
                  aria-label={t("team.inviteDialog.openLinkAria")}
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
                {t("team.inviteDialog.linkHint")}
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
                {t("team.inviteDialog.inviteAnother")}
              </Button>
              <Button type="button" onClick={resetAndClose}>
                {t("team.inviteDialog.done")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t("common.email")}</Label>
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
              <Label htmlFor="invite-role">{t("team.inviteDialog.roleLabel")}</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as AssignableRole)}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">{t("role.employee")}</SelectItem>
                  {canInviteAsAdmin && (
                    <SelectItem value="admin">{t("role.admin")}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {!canInviteAsAdmin && (
                <p className="text-xs text-muted-foreground">
                  {t("team.inviteDialog.ownerOnlyHint")}
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
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? t("team.inviteDialog.sending") : t("team.inviteDialog.submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
