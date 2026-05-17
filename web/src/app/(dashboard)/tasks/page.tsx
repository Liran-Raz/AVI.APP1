import { redirect } from "next/navigation";

import { TasksPage } from "@/components/tasks/tasks-page";
import { getCurrentSession, type FullSession } from "@/server/auth/session";
import * as clientsService from "@/server/services/clients.service";
import * as tasksService from "@/server/services/tasks.service";

export default async function TasksRoute() {
  // (dashboard)/layout already enforces auth + completed onboarding —
  // these guards repeat the contract for type narrowing.
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.organization) redirect("/onboarding");
  const fullSession = session as FullSession;

  // Fetch initial active tasks + the org's clients (for the picker + name
  // lookup on each card). Both reads happen in parallel.
  const [tasksResult, clientsResult] = await Promise.all([
    tasksService.listTasks(fullSession, {
      lifecycle: "active",
      limit: 200,
      offset: 0,
    }),
    clientsService.listClients(fullSession, {
      status: "active",
      limit: 200,
      offset: 0,
    }),
  ]);

  return (
    <TasksPage
      initialItems={tasksResult.items}
      initialClients={clientsResult.items}
    />
  );
}
