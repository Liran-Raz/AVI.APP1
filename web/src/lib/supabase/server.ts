// DEPRECATED — use `@/server/db/supabase` directly.
// Kept temporarily so existing imports don't break mid-refactor.
//
// New server-side code should import:
//   import { createSupabaseServerClient } from "@/server/db/supabase";

import { createSupabaseServerClient } from "@/server/db/supabase";

// Old API exposed `createClient`. Preserve the name for now.
export const createClient = createSupabaseServerClient;
