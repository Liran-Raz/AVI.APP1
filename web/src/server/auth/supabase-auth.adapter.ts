import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { AuthAdapter, AuthUser } from "./auth.adapter";

// Supabase implementation of AuthAdapter.
// Only this file imports @supabase/* for auth purposes. Replace this
// module to swap providers (e.g. Firebase Auth).

class SupabaseAuthAdapter implements AuthAdapter {
  async getCurrentUser(): Promise<AuthUser | null> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    return {
      id: data.user.id,
      email: data.user.email ?? null,
      emailConfirmedAt: data.user.email_confirmed_at ?? null,
      metadata: data.user.user_metadata ?? {},
    };
  }
}

// Module-level singleton. Adapter is stateless; the per-request state
// (cookies) is created inside getCurrentUser via createSupabaseServerClient.
export const authAdapter: AuthAdapter = new SupabaseAuthAdapter();
