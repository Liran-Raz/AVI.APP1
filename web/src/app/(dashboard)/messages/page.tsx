import { redirect } from "next/navigation";

import { getCurrentSession, type FullSession } from "@/server/auth/session";
import * as teamService from "@/server/services/team.service";
import { MessagesPage } from "@/components/messages/messages-page";

// Office chat (Stage 13 R5). Loads the team roster (conversation list = office
// group + each active member for DMs) and the current user id. Messages
// themselves are fetched client-side (polling). (dashboard)/layout already
// enforced auth + onboarding; the guards below narrow types.
export default async function MessagesRoute() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.organization) redirect("/onboarding");
  const full = session as FullSession;

  const { items } = await teamService.listMembers(full);

  return <MessagesPage currentUserId={full.user.id} members={items} />;
}
