import { redirect } from "next/navigation";

import { CalendarPage } from "@/components/calendar/calendar-page";
import { startOfWeek, endOfWeek } from "@/components/calendar/calendar-utils";
import { getCurrentSession, type FullSession } from "@/server/auth/session";
import * as clientsService from "@/server/services/clients.service";
import * as tasksService from "@/server/services/tasks.service";
import * as teamService from "@/server/services/team.service";

export default async function CalendarRoute() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.organization) redirect("/onboarding");
  const fullSession = session as FullSession;

  // Initial week is the one containing today (Sunday-start, Israeli).
  const ws = startOfWeek(new Date());
  const we = endOfWeek(new Date());

  const [tasksResult, clientsResult, membersResult] = await Promise.all([
    tasksService.listTasks(fullSession, {
      lifecycle: "active",
      dueAfter: ws.toISOString(),
      dueBefore: we.toISOString(),
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
    <CalendarPage
      initialItems={tasksResult.items}
      initialClients={clientsResult.items}
      initialMembers={membersResult.items}
      currentUserId={fullSession.profile.id}
      initialWeekStartIso={ws.toISOString()}
    />
  );
}
