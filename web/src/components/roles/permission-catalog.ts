// Client-safe permission catalog for the role editor. Derived entirely from the
// shared, framework-free `permissions.ts` (no server-only, no Supabase) so the
// browser can render the grant picker. Display only — the server is always
// authoritative.
//
// Labels are NOT baked in here. This module stays framework-free (no React
// hook), so it exposes the raw category + verb + scope TOKENS and lets the
// consuming component translate them via the i18n catalog (`permCategory.*` /
// `permVerb.*` / `permScope.*`).

import {
  CUSTOM_ROLE_GRANTABLE_PERMISSIONS,
  PERMISSION_META,
  SUPPORTED_RECORD_SCOPES,
  type Permission,
  type RecordScope,
} from "@/server/auth/permissions";

export type CatalogEntry = {
  key: Permission;
  /** Verb token (the part after the dot) — translate via `permVerb.<verb>`. */
  verb: string;
  scoped: boolean;
};
export type CatalogGroup = {
  /** Category token (the part before the dot) — translate via `permCategory.<category>`. */
  category: string;
  entries: CatalogEntry[];
};

// Stable category display order (mirrors the original CATEGORY_LABELS key order).
const CATEGORY_ORDER = [
  "organization",
  "settings",
  "team",
  "invitations",
  "roles",
  "clients",
  "contacts",
  "tasks",
  "notifications",
  "billing",
] as const;

export const SUPPORTED_SCOPES: readonly RecordScope[] = SUPPORTED_RECORD_SCOPES;

// Build the grouped catalog (stable category order; permissions in catalog order).
export function buildCatalog(): CatalogGroup[] {
  const byCategory = new Map<string, CatalogEntry[]>();
  // Only CUSTOM-ROLE-GRANTABLE permissions are offered in the editor — the UI
  // must never show a permission the validator/DB will reject.
  for (const key of CUSTOM_ROLE_GRANTABLE_PERMISSIONS) {
    const dot = key.indexOf(".");
    const category = key.slice(0, dot);
    const verb = key.slice(dot + 1);
    const entry: CatalogEntry = {
      key,
      verb,
      scoped: PERMISSION_META[key].scoped,
    };
    const list = byCategory.get(category) ?? [];
    list.push(entry);
    byCategory.set(category, list);
  }
  return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    entries: byCategory.get(category) ?? [],
  }));
}
