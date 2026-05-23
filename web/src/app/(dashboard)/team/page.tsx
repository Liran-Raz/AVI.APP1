import { redirect } from "next/navigation";

import { TeamPage } from "@/components/team/team-page";
import { getCurrentSession, type FullSession } from "@/server/auth/session";
import * as teamService from "@/server/services/team.service";

export default async function TeamRoute() {
  // (dashboard)/layout already enforces auth + completed onboarding;
  // the guards below are for type narrowing only.
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.organization) redirect("/onboarding");
  const fullSession = session as FullSession;

  const { items } = await teamService.listMembers(fullSession);

  return (
    <TeamPage
      initialItems={items}
      currentUserId={fullSession.profile.id}
      currentUserRole={fullSession.profile.role}
    />
  );
}
