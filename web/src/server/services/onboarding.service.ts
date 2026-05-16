import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import { AppError, ConflictError, ValidationError } from "@/server/errors/app-error";

// Onboarding business logic. Currently a thin wrapper around the
// SECURITY DEFINER `public.bootstrap_org` RPC, which is the atomic
// "create org + owner profile for the authenticated user" transaction.
//
// Round 4 will wire this up behind POST /api/onboarding/bootstrap so the
// client no longer calls supabase.rpc directly.

export type BootstrapOrgInput = {
  orgName: string;
  orgCode: string;
  fullName: string;
};

export type BootstrapOrgOutput = {
  orgId: string;
  created: boolean;
};

const ORG_CODE_RE = /^[A-Z0-9-]{3,20}$/;

export async function bootstrapOrg(
  input: BootstrapOrgInput,
): Promise<BootstrapOrgOutput> {
  // Light input checks here. Authoritative shape validation will happen
  // at the API boundary with zod (Round 4); the RPC also re-validates.
  const orgName = input.orgName?.trim();
  const orgCode = input.orgCode?.toUpperCase();
  const fullName = input.fullName?.trim();

  if (!orgName) throw new ValidationError("orgName is required");
  if (!orgCode || !ORG_CODE_RE.test(orgCode)) {
    throw new ValidationError(
      "orgCode must be 3-20 chars: uppercase letters, digits, or hyphens",
    );
  }
  if (!fullName) throw new ValidationError("fullName is required");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bootstrap_org", {
    p_org_name: orgName,
    p_org_code: orgCode,
    p_full_name: fullName,
  });

  if (error) {
    // unique_violation on the unique org_code constraint
    if (error.code === "23505") {
      throw new ConflictError("Organization code is already in use");
    }
    // Authentication / RLS — the RPC uses auth.uid()
    if (error.message?.toLowerCase().includes("unauthenticated")) {
      throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
    }
    // Anything else is unexpected; surface as 500 without leaking details.
    console.error("[onboarding.service.bootstrapOrg] RPC failed", error);
    throw new AppError("INTERNAL_ERROR", "Failed to create organization");
  }

  if (!data || typeof data !== "object" || !("org_id" in data)) {
    throw new AppError("INTERNAL_ERROR", "bootstrap_org returned malformed data");
  }

  return {
    orgId: String(data.org_id),
    created: Boolean(data.created),
  };
}
