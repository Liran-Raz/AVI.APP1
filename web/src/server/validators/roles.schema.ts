import { z } from "zod";

import {
  PERMISSION_META,
  PROTECTED_ACTIONS,
  SUPPORTED_RECORD_SCOPES,
  isCustomRoleGrantable,
  type Permission,
} from "@/server/auth/permissions";

// Server-side validation for custom-role management. Mirrors the DB CHECKs and
// the custom-role GRANTABLE catalog (CUSTOM_ROLE_GRANTABLE_PERMISSIONS) so an
// invalid payload is rejected BEFORE the RPC. Only grantable permissions may
// appear in a custom role.

const SUPPORTED_SCOPE_SET = new Set<string>(SUPPORTED_RECORD_SCOPES);

const nameField = z
  .string()
  .trim()
  .min(1, "Role name is required")
  .max(100, "Role name must be at most 100 characters");

// Optional human description. Empty/whitespace coerces to null.
const descriptionField = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v ?? null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  },
  z
    .string()
    .max(500, "Description must be at most 500 characters")
    .nullable(),
);

// A single grant inside a custom role. Validated against the catalog:
//   * permissionKey must be a known, grantable permission (ownership.transfer is
//     a protected action and is NOT in PERMISSIONS — rejected here and by the DB).
//   * a SCOPED permission requires a SUPPORTED record scope (all | own).
//   * a contextless permission must NOT carry a scope.
const grantSchema = z
  .object({
    permissionKey: z.string(),
    recordScope: z.string().nullish(),
  })
  .superRefine((g, ctx) => {
    if (g.permissionKey === PROTECTED_ACTIONS.OWNERSHIP_TRANSFER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ownership.transfer is a protected action and cannot be granted",
        path: ["permissionKey"],
      });
      return;
    }
    if (!isCustomRoleGrantable(g.permissionKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Permission is not grantable to a custom role: ${g.permissionKey}`,
        path: ["permissionKey"],
      });
      return;
    }
    const meta = PERMISSION_META[g.permissionKey as Permission];
    if (meta.scoped) {
      if (g.recordScope == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `A record scope is required for ${g.permissionKey}`,
          path: ["recordScope"],
        });
      } else if (!SUPPORTED_SCOPE_SET.has(g.recordScope)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unsupported record scope for ${g.permissionKey}: ${g.recordScope}`,
          path: ["recordScope"],
        });
      }
    } else if (g.recordScope != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${g.permissionKey} does not take a record scope`,
        path: ["recordScope"],
      });
    }
  });

const permissionsField = z
  .array(grantSchema)
  .max(200, "Too many permissions")
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    arr.forEach((g, i) => {
      if (seen.has(g.permissionKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate permission: ${g.permissionKey}`,
          path: [i, "permissionKey"],
        });
      }
      seen.add(g.permissionKey);
    });
  });

export const createRoleSchema = z.object({
  name: nameField,
  description: descriptionField,
  permissions: permissionsField,
});

export const updateRoleSchema = z.object({
  name: nameField,
  description: descriptionField,
  permissions: permissionsField,
  // Optimistic-concurrency token — the `updatedAt` the client last loaded.
  expectedUpdatedAt: z.string().min(1, "expectedUpdatedAt is required"),
});

export const duplicateRoleSchema = z.object({
  name: nameField,
});

export const roleIdParamSchema = z.object({ id: z.string().uuid() });

export type RoleGrantInput = z.infer<typeof grantSchema>;
export type CreateRolePayload = z.infer<typeof createRoleSchema>;
export type UpdateRolePayload = z.infer<typeof updateRoleSchema>;
export type DuplicateRolePayload = z.infer<typeof duplicateRoleSchema>;
