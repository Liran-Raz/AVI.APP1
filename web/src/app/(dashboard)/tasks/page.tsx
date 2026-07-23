import { redirect } from "next/navigation";

import { TasksPage } from "@/components/tasks/tasks-page";
import { getCurrentSession, type FullSession } from "@/server/auth/session";
import { resolveCapabilities } from "@/server/auth/authorization";
import { isStorageUiEnabled } from "@/server/auth/storage.flags";
import * as clientsService from "@/server/services/clients.service";
import * as tasksService from "@/server/services/tasks.service";
import * as teamService from "@/server/services/team.service";

export default async function TasksRoute() {
  // (dashboard)/layout already enforces auth + completed onboarding —
  // these guards repeat the contract for type narrowing.
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.organization) redirect("/onboarding");
  const fullSession = session as FullSession;

  // Fetch initial active tasks + the org's clients (for the picker + name
  // lookup on each card). Both reads happen in parallel.
  const [tasksResult, clientsResult, membersResult] = await Promise.all([
    tasksService.listTasks(fullSession, {
      lifecycle: "active",
      // Personal board (Stage 12 Round C): initial view is the viewer's own.
      boardFor: fullSession.profile.id,
      limit: 200,
      offset: 0,
    }),
    clientsService.listClients(fullSession, {
      status: "active",
      limit: 200,
      offset: 0,
    }),
    teamService.listMembers(fullSession),
  ]);

  return (
    <TasksPage
      initialItems={tasksResult.items}
      initialClients={clientsResult.items}
      initialMembers={membersResult.items}
      currentUserId={fullSession.profile.id}
      currentUserRole={fullSession.activeRole}
      storageEnabled={isStorageUiEnabled()}
      capabilities={resolveCapabilities(fullSession)}
    />
  );
}
