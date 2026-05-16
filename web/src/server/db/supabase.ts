import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/server/env";
import type { Database } from "@/server/db/database.types";

// Server-side Supabase client tied to the current request's cookies.
// This is the ONLY place in the codebase that should know about
// @supabase/ssr / @supabase/supabase-js on the server. Future:
// repositories import this; services import repositories.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware refreshes sessions.
            // Safe to ignore.
          }
        },
      },
    },
  );
}
