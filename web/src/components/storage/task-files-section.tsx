"use client";

import { FolderCheck } from "lucide-react";

import { hasCapability, PERMISSIONS, type Capability } from "@/lib/capabilities";
import { useT } from "@/i18n/locale-provider";

import { AttachmentsPanel } from "./attachments-panel";

// The "קבצים" section inside the task EDIT dialog (Option A). Files uploaded here
// route by the task's client: a task WITH a client lands in that client's Task
// Files folder (per-client key); a task WITHOUT one is office-owned. The route
// note tells the user where the files will live.

export function TaskFilesSection({
  taskId,
  clientName,
  capabilities,
  nameFor,
}: {
  taskId: string;
  clientName: string | null;
  capabilities: Capability[];
  nameFor?: (userId: string | null) => string | null;
}) {
  const t = useT();
  const canUpload = hasCapability(capabilities, PERMISSIONS.ATTACHMENTS_UPLOAD);
  const canArchive = hasCapability(capabilities, PERMISSIONS.ATTACHMENTS_DELETE);

  const routeNote = (
    <div className="flex items-center gap-2 text-xs font-medium text-primary bg-primary/[0.07] border border-primary/20 rounded-lg px-3 py-2 mb-3">
      <FolderCheck className="size-4 flex-none" />
      <span>
        {clientName
          ? t("storage.taskRoute", { client: clientName })
          : t("storage.taskRouteOffice")}
      </span>
    </div>
  );

  return (
    <AttachmentsPanel
      title={t("storage.taskFilesTitle")}
      listScope={{ scope: "task", taskId }}
      uploadTarget={{ context: "task", contextId: taskId, category: "task_files" }}
      canUpload={canUpload}
      canArchive={canArchive}
      perClient={clientName !== null}
      routeNote={routeNote}
      nameFor={nameFor}
    />
  );
}
