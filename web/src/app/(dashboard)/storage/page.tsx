import { notFound } from "next/navigation";

import { OfficeLibrary } from "@/components/storage/office-library";
import { can, resolveCapabilities } from "@/server/auth/authorization";
import { PERMISSIONS } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { isStorageUiEnabled } from "@/server/auth/storage.flags";
import * as teamService from "@/server/services/team.service";

// ספריית המשרד (DEV-032) — the office file library. Gate: STORAGE_UI flag (404
// when off) + attachments.view. Services re-check every permission; capabilities
// are passed down as display hints only. Members drive uploader-name display.
export default async function StoragePage() {
  if (!isStorageUiEnabled()) notFound();

  const session = await requireSession();
  if (!can(session, PERMISSIONS.ATTACHMENTS_VIEW)) notFound();

  const members = await teamService.listMembers(session);

  return (
    <OfficeLibrary
      capabilities={resolveCapabilities(session)}
      members={members.items.map((m) => ({ id: m.id, name: m.fullName }))}
    />
  );
}
