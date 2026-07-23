"use client";

import { useMemo, useState } from "react";
import { Archive, FolderClosed, ListChecks, Users } from "lucide-react";

import { hasCapability, PERMISSIONS, type Capability } from "@/lib/capabilities";
import type { OfficeFolder } from "@/lib/api-client";
import { useT } from "@/i18n/locale-provider";
import type { MessageKey } from "@/i18n/messages-types";

import { AttachmentsPanel, type UploadTarget } from "./attachments-panel";
import { FolderChips } from "./folder-chips";

// The office library (/storage) — the office's 5 folders. Two are STORED
// (files/additional; uploadable here); three are AGGREGATE VIEWS (clients =
// all client-owned files, tasks = all task-sourced files, archive = everything
// archived) — read-only here (uploads happen on the client/task surfaces).

type OfficeMember = { id: string; name: string };

const OFFICE_FOLDERS: {
  folder: OfficeFolder;
  labelKey: MessageKey;
  icon: typeof FolderClosed;
  upload: UploadTarget | null;
  perClient: boolean;
  dashed?: boolean;
  archived?: boolean;
}[] = [
  {
    folder: "files",
    labelKey: "storage.folder.office_files",
    icon: FolderClosed,
    upload: { context: "office", category: "office_files" },
    perClient: false,
  },
  {
    folder: "clients",
    labelKey: "storage.folder.clients",
    icon: Users,
    upload: null,
    perClient: true,
  },
  {
    folder: "tasks",
    labelKey: "storage.folder.task_files",
    icon: ListChecks,
    upload: null,
    perClient: false,
  },
  {
    folder: "additional",
    labelKey: "storage.folder.additional",
    icon: FolderClosed,
    upload: { context: "office", category: "additional" },
    perClient: false,
  },
  {
    folder: "archive",
    labelKey: "storage.folder.archive",
    icon: Archive,
    upload: null,
    perClient: false,
    dashed: true,
    archived: true,
  },
];

export function OfficeLibrary({
  capabilities,
  members,
}: {
  capabilities: Capability[];
  members: OfficeMember[];
}) {
  const t = useT();
  const [active, setActive] = useState<OfficeFolder>("files");
  const folder = OFFICE_FOLDERS.find((f) => f.folder === active)!;
  const canUpload = hasCapability(capabilities, PERMISSIONS.ATTACHMENTS_UPLOAD);
  const canArchive = hasCapability(capabilities, PERMISSIONS.ATTACHMENTS_DELETE);

  const nameFor = useMemo(() => {
    const map = new Map(members.map((m) => [m.id, m.name]));
    return (id: string | null) => (id ? (map.get(id) ?? null) : null);
  }, [members]);

  return (
    <div className="container mx-auto px-4 md:px-6 py-6 md:py-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          {t("storage.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("storage.subtitle")}
        </p>
      </div>

      <div className="border border-border rounded-lg glass-card shadow-card p-4 md:p-6 space-y-4">
        <FolderChips
          folders={OFFICE_FOLDERS.map((f) => ({
            key: f.folder,
            label: t(f.labelKey),
            icon: f.icon,
            dashed: f.dashed,
          }))}
          active={active}
          onSelect={(k) => setActive(k as OfficeFolder)}
        />
        <AttachmentsPanel
          key={active}
          title={t(folder.labelKey)}
          listScope={{ scope: "office", folder: active }}
          uploadTarget={folder.upload}
          canUpload={canUpload}
          canArchive={canArchive}
          perClient={folder.perClient}
          nameFor={nameFor}
          archivedView={folder.archived}
        />
      </div>
    </div>
  );
}
