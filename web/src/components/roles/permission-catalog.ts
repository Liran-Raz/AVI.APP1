// Client-safe permission catalog for the role editor. Derived entirely from the
// shared, framework-free `permissions.ts` (no server-only, no Supabase) so the
// browser can render the grant picker. Display only — the server is always
// authoritative.

import {
  CUSTOM_ROLE_GRANTABLE_PERMISSIONS,
  PERMISSION_META,
  SUPPORTED_RECORD_SCOPES,
  type Permission,
  type RecordScope,
} from "@/server/auth/permissions";

export type CatalogEntry = {
  key: Permission;
  label: string;
  scoped: boolean;
};
export type CatalogGroup = {
  category: string;
  label: string;
  entries: CatalogEntry[];
};

const CATEGORY_LABELS: Record<string, string> = {
  organization: "ארגון",
  settings: "הגדרות",
  team: "צוות",
  invitations: "הזמנות",
  roles: "תפקידים",
  clients: "לקוחות",
  contacts: "אנשי קשר",
  tasks: "משימות",
  notifications: "התראות",
  billing: "חיוב",
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

const VERB_LABELS: Record<string, string> = {
  view: "צפייה",
  create: "יצירה",
  edit: "עריכה",
  delete: "מחיקה",
  archive: "העברה לארכיון",
  restore: "שחזור",
  export: "ייצוא",
  manage: "ניהול",
  settings: "הגדרות",
  invite: "הזמנה",
  deactivate: "השבתה",
  reactivate: "הפעלה מחדש",
  remove: "הסרה",
  change_role: "שינוי תפקיד",
  revoke: "ביטול",
  resend: "שליחה חוזרת",
  change_status: "שינוי סטטוס",
  assign_self: "שיוך לעצמי",
  assign_others: "שיוך לאחרים",
};

export const SUPPORTED_SCOPES: readonly RecordScope[] = SUPPORTED_RECORD_SCOPES;

export const SCOPE_LABELS: Record<RecordScope, string> = {
  all: "כל הרשומות",
  own: "רשומות שיצרתי",
  assigned: "משויך אליי",
  team: "צוות",
};

function entryLabel(key: Permission): string {
  const dot = key.indexOf(".");
  const category = key.slice(0, dot);
  const verb = key.slice(dot + 1);
  const cat = CATEGORY_LABELS[category] ?? category;
  const action = VERB_LABELS[verb] ?? verb;
  return `${cat} — ${action}`;
}

// Build the grouped catalog (stable category order; permissions in catalog order).
export function buildCatalog(): CatalogGroup[] {
  const byCategory = new Map<string, CatalogEntry[]>();
  // Only CUSTOM-ROLE-GRANTABLE permissions are offered in the editor — the UI
  // must never show a permission the validator/DB will reject.
  for (const key of CUSTOM_ROLE_GRANTABLE_PERMISSIONS) {
    const category = key.slice(0, key.indexOf("."));
    const entry: CatalogEntry = {
      key,
      label: entryLabel(key),
      scoped: PERMISSION_META[key].scoped,
    };
    const list = byCategory.get(category) ?? [];
    list.push(entry);
    byCategory.set(category, list);
  }
  return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    label: CATEGORY_LABELS[category] ?? category,
    entries: byCategory.get(category) ?? [],
  }));
}
