import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Database } from "@/server/db/database.types";

// Repository for bug_reports. INSERT-only, matching the table's RLS (no
// SELECT/UPDATE/DELETE policy for `authenticated`) — there is deliberately
// no read function here; reports are read manually in the Supabase
// Dashboard, never through the app.

export type BugReportInsert =
  Database["public"]["Tables"]["bug_reports"]["Insert"];

export async function createBugReport(
  input: BugReportInsert,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  // No .select() — the table has no SELECT policy for `authenticated`, so a
  // RETURNING/select would come back empty (Postgres RLS filters RETURNING
  // through the SELECT policy, which doesn't exist here). We only need to
  // know the insert succeeded.
  const { error } = await supabase.from("bug_reports").insert(input);
  if (error) throw error;
}
