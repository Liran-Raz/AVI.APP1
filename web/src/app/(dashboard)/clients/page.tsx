import { redirect } from "next/navigation";

import { ClientsPage } from "@/components/clients/clients-page";
import { getCurrentSession, type FullSession } from "@/server/auth/session";
import { resolveCapabilities } from "@/server/auth/authorization";
import * as clientsService from "@/server/services/clients.service";
import * as teamService from "@/server/services/team.service";

export default async function ClientsRoute() {
  // (dashboard)/layout already enforces auth + completed onboarding —
  // these guards repeat the contract for type narrowing.
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.organization) redirect("/onboarding");

  // Cast is safe: the two guards above narrow profile/organization to
  // non-null but TS doesn't lift that into the parent Session type.
  const fullSession = session as FullSession;

  const [initial, membersResult] = await Promise.all([
    clientsService.listClients(fullSession, {
      status: "active",
      limit: 100,
      offset: 0,
    }),
    teamService.listMembers(fullSession),
  ]);

  return (
    <ClientsPage
      initialItems={initial.items}
      initialMembers={membersResult.items}
      capabilities={resolveCapabilities(fullSession)}
    />
  );
}
