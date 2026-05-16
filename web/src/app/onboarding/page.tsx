import { redirect } from "next/navigation";

import { getCurrentSession } from "@/server/auth/session";
import { OnboardingClient } from "./onboarding-client";

type SignupMetadata = {
  org_name?: string;
  org_code?: string;
  full_name?: string;
};

export default async function OnboardingPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  // Already onboarded? Skip.
  if (session.profile) redirect("/tasks");

  // Metadata is opaque on AuthUser; narrow it locally to what signup wrote.
  const metadata = session.user.metadata as SignupMetadata;

  return (
    <OnboardingClient
      email={session.user.email ?? ""}
      initialOrgName={metadata.org_name ?? ""}
      initialOrgCode={metadata.org_code ?? ""}
      initialFullName={metadata.full_name ?? ""}
    />
  );
}
