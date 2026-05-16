import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { OnboardingClient } from "./onboarding-client";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Already has a profile? Skip onboarding.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (profile) redirect("/tasks");

  // Read metadata we set during signup, if any
  const metadata = (user.user_metadata ?? {}) as {
    org_name?: string;
    org_code?: string;
    full_name?: string;
  };

  return (
    <OnboardingClient
      email={user.email ?? ""}
      initialOrgName={metadata.org_name ?? ""}
      initialOrgCode={metadata.org_code ?? ""}
      initialFullName={metadata.full_name ?? ""}
    />
  );
}
