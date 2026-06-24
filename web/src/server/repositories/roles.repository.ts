import "server-only";

import { createSupabaseServerClient } from "@/server/db/supabase";
import type { Database } from "@/server/db/database.types";

// Repository for custom-role management. The `roles`/`role_permissions` tables
// are locked down (RLS, zero policies, revoked), so EVERY operation goes through
// the SECURITY DEFINER RPCs (migrations 0015/0016) — there is no direct table
// access here. The RPCs enforce owner/org gating in the database; this layer
// only marshals arguments and surfaces the PostgREST error (the service maps
// SQLSTATE -> AppError).

export type ListOrgRoleRow =
  Database["public"]["Functions"]["list_org_roles"]["Returns"][number];

// One grant as the RPC expects it (snake_case jsonb element).
export type RolePermissionInput = {
  permission_key: string;
  record_scope: string | null;
};

export async function listOrgRoles(orgId: string): Promise<ListOrgRoleRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_org_roles", {
    p_org_id: orgId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function createOrgRole(
  orgId: string,
  name: string,
  description: string | null,
  permissions: RolePermissionInput[],
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_org_role", {
    p_org_id: orgId,
    p_name: name,
    p_description: description,
    p_permissions: permissions as never,
  });
  if (error) throw error;
  return data as string;
}

export async function updateOrgRole(
  orgId: string,
  roleId: string,
  name: string,
  description: string | null,
  permissions: RolePermissionInput[],
  expectedUpdatedAt: string,
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("update_org_role", {
    p_org_id: orgId,
    p_role_id: roleId,
    p_name: name,
    p_description: description,
    p_permissions: permissions as never,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw error;
  return data as string; // the new updated_at (next concurrency token)
}

export async function deleteOrgRole(
  orgId: string,
  roleId: string,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delete_org_role", {
    p_org_id: orgId,
    p_role_id: roleId,
  });
  if (error) throw error;
}

export async function duplicateOrgRole(
  orgId: string,
  sourceRoleId: string,
  newName: string,
): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("duplicate_org_role", {
    p_org_id: orgId,
    p_source_role_id: sourceRoleId,
    p_new_name: newName,
  });
  if (error) throw error;
  return data as string;
}
