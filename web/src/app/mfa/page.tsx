import { redirect } from "next/navigation";

import "../marketing.css";
import { getCurrentSession } from "@/server/auth/session";
import { sanitizeNextPath } from "@/server/auth/redirect";
import { MfaGlass } from "./mfa-glass";

// /mfa — the two-factor challenge step (DEV-013).
//
// Reached from three places, all sharing this one page:
//   • password login when the account has 2FA (login-form pushes here)
//   • Google OAuth login (the dashboard layout bounces pending sessions)
//   • password recovery for an enrolled user (reset-password redirects
//     here first — the provider refuses password updates at aal1)
//
// The page itself is reachable at aal1 by design; everything the user
// actually wants (data routes) stays locked until the code verifies.
export default async function MfaPage(props: {
  searchParams: Promise<{ next?: string }>;
}) {
  const searchParams = await props.searchParams;
  // Open-redirect defense: same-origin path or the default.
  const next = sanitizeNextPath(searchParams.next, "/tasks");

  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.mfaPending) redirect(next);

  return <MfaGlass next={next} />;
}
