"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { MessageCircleWarning } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiClient } from "@/lib/api-client";
import {
  getClientLogsSnapshot,
  initBugReportTracker,
  recordAction,
} from "@/lib/bug-report-tracker";
import { useT } from "@/i18n/locale-provider";

// "מצאת תקלה?" (DEV-002). Mounted ONCE in the dashboard shell so it's
// visible on every authenticated screen. Submits the user's description
// together with a bounded client-side snapshot (recent console errors,
// failed requests, and the last few actions/navigations) — no server-side
// logging component, per the approved DEV-002 scope in docs/DEV_TRACKING.md.
export function ReportBugButton() {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [attemptedAction, setAttemptedAction] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Start the tracker once. Idempotent (module-level guarded), so this is
  // safe even if the component ever remounts.
  useEffect(() => {
    initBugReportTracker();
  }, []);

  // Record navigations into the action trail (skip the very first render —
  // that's just "app loaded here", not a user-initiated action). A ref (not
  // state) so this never triggers its own re-render.
  const hasMountedOnce = useRef(false);
  useEffect(() => {
    if (hasMountedOnce.current) {
      recordAction(`ניווט: ${pathname}`);
    } else {
      hasMountedOnce.current = true;
    }
  }, [pathname]);

  function resetAndClose() {
    setDescription("");
    setAttemptedAction("");
    setOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      await apiClient.bugReports.submit({
        description,
        attemptedAction: attemptedAction.trim() || null,
        pageUrl: window.location.pathname,
        userAgent: navigator.userAgent,
        clientLogs: getClientLogsSnapshot(),
      });
      toast.success(t("bugReport.successToast"));
      resetAndClose();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(t("bugReport.errorToast"));
        console.error(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => setOpen(true)}
      >
        <MessageCircleWarning className="size-4" />
        <span className="hidden sm:inline">{t("bugReport.button")}</span>
      </Button>

      <Dialog open={open} onOpenChange={(o) => (!o ? resetAndClose() : setOpen(o))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("bugReport.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("bugReport.dialogDesc")}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bug-description">{t("bugReport.whatHappened")}</Label>
              <Textarea
                id="bug-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("bugReport.descPlaceholder")}
                rows={4}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bug-attempted-action">
                {t("bugReport.attemptedAction")}
              </Label>
              <Textarea
                id="bug-attempted-action"
                value={attemptedAction}
                onChange={(e) => setAttemptedAction(e.target.value)}
                placeholder={t("bugReport.attemptedPlaceholder")}
                rows={2}
              />
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={submitting || !description.trim()}>
                {submitting ? t("bugReport.submitting") : t("bugReport.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
