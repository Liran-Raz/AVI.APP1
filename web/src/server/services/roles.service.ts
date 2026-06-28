import "server-only";

import type { FullSession } from "@/server/auth/session";
import { requireCapability } from "@/server/auth/authorization";
import { PERMISSIONS, type RecordScope } from "@/server/auth/permissions";
import { isRoleManagementWriteEnabled } from "@/server/auth/role-management.flags";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors/app-error";
import * as rolesRepo from "@/server/repositories/roles.repository";
import type { ListOrgRoleRow } from "@/server/repositories/roles.repository";
import type {
  CreateRolePayload,
  DuplicateRolePayload,
  RoleGrantInput,
  UpdateRolePayload,
} from "@/server/validators/roles.schema";

// ---- DTOs (camelCase; no org_id / internal columns) ----
export type RoleGrantDTO = {
  permissionKey: string;
  recordScope: RecordScope | null;
};

export type RoleDTO = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  permissions: RoleGrantDTO[];
};

// Map the SECURITY DEFINER RPC SQLSTATE to a client-safe AppError. The RPCs are
// the authoritative gate; this only translates the structured failures.
function mapRoleRpcError(err: unknown): AppError {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  switch (code) {
    case "42501": // insufficient_privilege (DB owner gate)
      return new ForbiddenError();
    case "P0002": // no_data_found (missing / system / cross-org role)
      return new NotFoundError("Role not found");
    case "23505": // unique_violation (duplicate role name)
      return new ConflictError("A role with this name already exists");
    case "55006": // object_in_use (role assigned to a member)
      return new ConflictError("This role is in use and cannot be deleted");
    case "40001": // serialization_failure (optimistic-concurrency mismatch)
      return new ConflictError(
        "This role was changed by someone else. Reload and try again.",
      );
    case "22000": // data_exception (invalid name)
      return new ValidationError("Invalid role name");
    case "22023": // invalid_parameter_value (DB-side payload validation)
    case "23514": // check_violation (bad scope / ownership.transfer)
    case "23502": // not_null_violation (missing permission key)
      return new ValidationError("Invalid permission grant");
    default:
      return new AppError("INTERNAL_ERROR", "Role operation failed", 500);
  }
}

async function withRoleErrorMapping<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw mapRoleRpcError(err);
  }
}

// Group the flattened (role × permission) rows from list_org_roles into DTOs.
// The RPC already orders system-first then by name; Map preserves that order.
function groupRoles(rows: ListOrgRoleRow[]): RoleDTO[] {
  const byId = new Map<string, RoleDTO>();
  for (const r of rows) {
    let dto = byId.get(r.role_id);
    if (!dto) {
      dto = {
        id: r.role_id,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.is_system,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        permissions: [],
      };
      byId.set(r.role_id, dto);
    }
    if (r.permission_key !== null) {
      dto.permissions.push({
        permissionKey: r.permission_key,
        recordScope: (r.record_scope as RecordScope | null) ?? null,
      });
    }
  }
  return Array.from(byId.values());
}

function toRpcPermissions(
  perms: RoleGrantInput[],
): rolesRepo.RolePermissionInput[] {
  return perms.map((g) => ({
    permission_key: g.permissionKey,
    record_scope: g.recordScope ?? null,
  }));
}

// Writes require BOTH the (default-off) write flag AND roles.manage (owner-only
// per the code grants). The DB RPC re-checks owner independently.
function assertCanWrite(session: FullSession): void {
  if (!isRoleManagementWriteEnabled()) throw new ForbiddenError();
  requireCapability(session, PERMISSIONS.ROLES_MANAGE);
}

// Raw fetch (repo + grouping), NO authorization/flag gate — for internal reuse
// after an already-authorized write. Public reads go through listRoles.
async function fetchRolesGrouped(session: FullSession): Promise<RoleDTO[]> {
  const rows = await withRoleErrorMapping(() =>
    rolesRepo.listOrgRoles(session.activeOrg.id),
  );
  return groupRoles(rows);
}

export async function listRoles(
  session: FullSession,
): Promise<{ items: RoleDTO[] }> {
  // Owner OR Manager (roles.view). The DB RPC re-checks owner/manager. The UI
  // feature flag is gated at the route + page (the read surface), not here, so
  // an authorized post-write fetch never depends on the read/UI flag.
  requireCapability(session, PERMISSIONS.ROLES_VIEW);
  return { items: await fetchRolesGrouped(session) };
}

// Internal: re-read a single role after a write (already authorized via
// assertCanWrite). Does NOT re-gate, so a write never depends on the read flag.
async function getRoleById(
  session: FullSession,
  id: string,
): Promise<RoleDTO> {
  const found = (await fetchRolesGrouped(session)).find((r) => r.id === id);
  if (!found) throw new NotFoundError("Role not found");
  return found;
}

export async function createRole(
  session: FullSession,
  input: CreateRolePayload,
): Promise<RoleDTO> {
  assertCanWrite(session);
  const id = await withRoleErrorMapping(() =>
    rolesRepo.createOrgRole(
      session.activeOrg.id,
      input.name,
      input.description,
      toRpcPermissions(input.permissions),
    ),
  );
  return getRoleById(session, id);
}

export async function updateRole(
  session: FullSession,
  roleId: string,
  input: UpdateRolePayload,
): Promise<RoleDTO> {
  assertCanWrite(session);
  await withRoleErrorMapping(() =>
    rolesRepo.updateOrgRole(
      session.activeOrg.id,
      roleId,
      input.name,
      input.description,
      toRpcPermissions(input.permissions),
      input.expectedUpdatedAt,
    ),
  );
  return getRoleById(session, roleId);
}

export async function deleteRole(
  session: FullSession,
  roleId: string,
): Promise<void> {
  assertCanWrite(session);
  await withRoleErrorMapping(() =>
    rolesRepo.deleteOrgRole(session.activeOrg.id, roleId),
  );
}

export async function duplicateRole(
  session: FullSession,
  sourceRoleId: string,
  input: DuplicateRolePayload,
): Promise<RoleDTO> {
  assertCanWrite(session);
  const id = await withRoleErrorMapping(() =>
    rolesRepo.duplicateOrgRole(session.activeOrg.id, sourceRoleId, input.name),
  );
  return getRoleById(session, id);
}
