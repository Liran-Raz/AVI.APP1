"use client";

import { useState } from "react";
import { FileText, FolderClosed, ListChecks, Upload } from "lucide-react";

import { hasCapability, PERMISSIONS, type Capability } from "@/lib/capabilities";
import type { AttachmentCategoryValue } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";

import { AttachmentsPanel } from "./attachments-panel";
import { FolderChips } from "./folder-chips";

// The "קבצים" tab on the client page: the client's 4 fixed folders. Task-sourced
// files (קבצי משימות) are read-only here — they arrive from the task edit dialog.

const CLIENT_FOLDERS: {
  category: AttachmentCategoryValue;
  labelKey: MessageKey;
  icon: typeof FolderClosed;
  uploadable: boolean;
}[] = [
  {
    category: "certificates_reports",
    labelKey: "storage.folder.certificates_reports",
    icon: FileText,
    uploadable: true,
  },
  {
    category: "task_files",
    labelKey: "storage.folder.task_files",
    icon: ListChecks,
    uploadable: false,
  },
  {
    category: "client_uploaded",
    labelKey: "storage.folder.client_uploaded",
    icon: Upload,
    uploadable: true,
  },
  {
    category: "additional",
    labelKey: "storage.folder.additional",
    icon: FolderClosed,
    uploadable: true,
  },
];

export function ClientFilesTab({
  clientId,
  capabilities,
  nameFor,
}: {
  clientId: string;
  capabilities: Capability[];
  nameFor?: (userId: string | null) => string | null;
}) {
  const t = useT();
  const [active, setActive] = useState<AttachmentCategoryValue>(
    "certificates_reports",
  );
  const folder = CLIENT_FOLDERS.find((f) => f.category === active)!;
  const canUpload = hasCapability(capabilities, PERMISSIONS.ATTACHMENTS_UPLOAD);
  const canArchive = hasCapability(capabilities, PERMISSIONS.ATTACHMENTS_DELETE);

  return (
    <div className="space-y-4">
      <FolderChips
        folders={CLIENT_FOLDERS.map((f) => ({
          key: f.category,
          label: t(f.labelKey),
          icon: f.icon,
        }))}
        active={active}
        onSelect={(k) => setActive(k as AttachmentCategoryValue)}
      />
      <AttachmentsPanel
        key={active}
        title={t(folder.labelKey)}
        listScope={{ scope: "client", clientId, category: active }}
        uploadTarget={
          folder.uploadable
            ? { context: "client", contextId: clientId, category: active }
            : null
        }
        canUpload={canUpload}
        canArchive={canArchive}
        perClient
        nameFor={nameFor}
      />
    </div>
  );
}
