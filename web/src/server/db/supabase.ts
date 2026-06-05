import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

// Cookie-less, stateless anon client for PUBLIC reads that have NO user
// session — e.g. the invitation preview rendered on /invite/accept and
// /invite/signup, which run in an anonymous Server Component.
//
// Why this exists: createSupabaseServerClient() binds to the request
// cookies and the @supabase/ssr session machinery. In an anonymous public
// Server Component, its `.rpc()` fails at runtime (this was the cause of the
// /invite/accept 500). This client carries ONLY the anon key and performs a
// plain PostgREST request — exactly replicating the anonymous REST call that
// works. It never reads or writes cookies, never persists or refreshes a
// session, and never uses the service role key.
//
// Stateless → safe to share as a lazily-created module singleton.
let publicClient: SupabaseClient<Database> | null = null;

export function createSupabasePublicClient(): SupabaseClient<Database> {
  if (!publicClient) {
    publicClient = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  }
  return publicClient;
}
