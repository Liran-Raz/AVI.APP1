import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  // 1) Auth state
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({
      step: "auth",
      authed: false,
      error: userError?.message ?? "no user",
    });
  }

  // 2) Profile lookup
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // 3) Try the RPC (will fail if profile exists, succeed if not)
  const metadata = (user.user_metadata ?? {}) as Record<string, string>;
  let rpcResult: unknown = "not attempted (profile already exists)";
  if (!profile) {
    const { data, error } = await supabase.rpc("bootstrap_org", {
      p_org_name: metadata.org_name ?? "",
      p_org_code: (metadata.org_code ?? "").toUpperCase(),
      p_full_name: metadata.full_name ?? "",
    });
    rpcResult = { data, error: error ? { ...error, message: error.message, code: error.code, details: error.details, hint: error.hint } : null };
  }

  return NextResponse.json({
    authed: true,
    user: {
      id: user.id,
      email: user.email,
      email_confirmed_at: user.email_confirmed_at,
      metadata,
    },
    profile: profile ?? null,
    profileError: profileError?.message ?? null,
    rpcResult,
  });
}
