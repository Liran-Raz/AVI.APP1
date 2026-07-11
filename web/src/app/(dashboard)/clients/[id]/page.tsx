import { notFound, redirect } from "next/navigation";

import { ClientDetail } from "@/components/clients/client-detail";
import { getCurrentSession, type FullSession } from "@/server/auth/session";
import { resolveCapabilities } from "@/server/auth/authorization";
import { AppError } from "@/server/errors/app-error";
import * as clientsService from "@/server/services/clients.service";
import * as contactsService from "@/server/services/client-contacts.service";
import * as teamService from "@/server/services/team.service";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ClientDetailRoute({ params }: Props) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.organization) redirect("/onboarding");
  const fullSession = session as FullSession;

  const { id } = await params;

  let client;
  let contactsResult;
  let membersResult;
  try {
    [client, contactsResult, membersResult] = await Promise.all([
      clientsService.getClient(fullSession, id),
      contactsService.listContacts(fullSession, id),
      teamService.listMembers(fullSession),
    ]);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") {
      notFound();
    }
    throw err;
  }

  const handlerName = client.handlingUserId
    ? membersResult.items.find((m) => m.id === client.handlingUserId)
        ?.fullName ?? null
    : null;

  return (
    <ClientDetail
      client={client}
      initialContacts={contactsResult.items}
      handlerName={handlerName}
      capabilities={resolveCapabilities(fullSession)}
    />
  );
}
