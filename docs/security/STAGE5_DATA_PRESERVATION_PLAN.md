# Stage 5 / F10 — Data Preservation & Deletion Safety Plan

> Status: **PLANNING / PREPARATION ONLY.** This document describes current
> behavior, risks, and *proposed* future controls. It changes no data, no
> schema, no policies, and no Supabase configuration. Nothing here is
> implemented by merging this document.
>
> Baseline commit: `107b530ba1d265352c0b9d6bac023ef0298faace` (`main`).
> Audit method: **read-only** review of code, migrations, and docs. **No
> Production database was queried.**

---

## 1. Executive summary

AVI.APP stores financial-adjacent business data for an Israeli accounting
office (clients, contacts, tasks, team identities). The governing product
decision for this stage is **preserve-by-default**: business data is kept
indefinitely and is deleted only by an explicit, deliberate action — never
automatically, never on a timer, never by a pattern match.

The good news from the audit:

- **The application has almost no destructive surface.** Every user-facing
  "delete" except one is a **soft / reversible** operation (tasks → `deleted_at`,
  clients → `is_active`, members → `is_active`). The single exception is
  hard-deleting one *client contact*.
- **There is no cron, no scheduled deletion, no background worker, and no
  service-role key.** Nothing can silently purge data.
- **Cross-org deletion through the app is structurally blocked** by org-scoped
  queries plus membership-based RLS (the Stage 1 / F1 defense-in-depth).

The real risk is **not** the application — it is **out-of-band manual
operations** against the database (Supabase Dashboard / SQL Editor) combined
with **PostgreSQL `ON DELETE CASCADE`** relationships and an **unverified
backup/recovery posture**. A single manual `DELETE` on an `organizations`
row is designed by the schema to cascade into all of that tenant's clients,
contacts, tasks, notifications, invitations, and memberships. Today there is
no documented, tested restore path to undo such a mistake.

This plan therefore focuses on: (a) mapping every deletion path and cascade,
(b) a preserve-by-default policy, (c) backup/recovery requirements, (d) an
accidental-deletion threat model, and (e) prioritized safety controls — with
a hard line that **nothing destructive is implemented in this stage.**

Verdict: **PRESERVATION PLAN READY WITH OPEN DECISIONS** (see §16).

---

## 2. Product preservation decision (binding for this stage)

> Customer business data is retained indefinitely, as long as the customer
> has not explicitly requested its deletion or performed a clear deletion
> action in the system.

Consequences adopted by this plan:

- **No automatic deletion** of organizations, memberships, profiles, clients,
  contacts, tasks, notifications, invitations, auth users, activity history,
  or any other business data.
- **No short retention window** for customer business data.
- Deletion happens **only** after an explicit action; **organization-level**
  deletion requires a strong confirmation and **owner** authority.
- Future deletion mechanisms must prefer **archive / soft-delete** over hard
  delete, and must be **recoverable** wherever feasible.
- Stage 5 is **not** a cleanup stage. No QA/seed/test data is deleted here.
  (Identifying test data safely is itself a risk — see Finding **DP-9**.)

---

## 3. Data inventory

All entities below were confirmed to exist in `supabase/migrations/` and/or
the repositories. No entity is assumed that is not present in code/migrations.
Supabase-managed `auth.users` is included because app tables reference it.

| Entity | Purpose | Organization key | Contains PII | Business critical | Deletion path (today) | Recovery available |
|---|---|---|---|---|---|---|
| `organizations` | Tenant root — one per accounting office | `id` (self) | Low (office name/phone/email/address) | **Critical** | **None in app.** Manual DB `DELETE` only (cascades — see §5) | Only via DB backup/PITR (unverified) |
| `profiles` | Global user identity; legacy `org_id/role/is_active` frozen snapshot (0009) | `org_id` (legacy, non-authoritative) | **Yes** (full_name, email, phone, avatar) | **Critical** (identity) | **None in app.** Cascaded if its `auth.users` row is deleted | Only via backup/PITR (unverified) |
| `organization_memberships` | Source of truth for role + active per (user, org) (0009) | `org_id` | Low (FK ids + role) | **Critical** (authorization) | **Soft** via deactivate (`is_active=false`); hard-cascaded if user/org deleted | Reactivate (soft); else backup |
| `clients` | Accounting-office customers | `org_id` | **Yes** (name, tax_id, email, phone, address, notes) | **Critical** | **Soft only** (`is_active=false`); cascaded if org deleted | Restore (un-archive); else backup |
| `client_contacts` | Contacts per client | via `client_id → clients.org_id` | **Yes** (name, role, phone, email) | High | **HARD delete** (single contact) + cascaded if client/org deleted | **None in app** (irreversible) |
| `tasks` | Core work items | `org_id` | Medium (title/description may contain client detail) | High | **Soft** (`deleted_at`) + **archive** (`archived_at`); cascaded if org deleted | Restore / un-archive; else backup |
| `notifications` | In-app bell items (derived) | via `user_id`/`task_id` | Low–Medium (title/body text) | Low (regenerable) | Mark-read only; cascaded if user/task deleted | Not needed (derived) |
| `invitations` | Pending/used team invites; token stored as `sha256` hash only | `org_id` | **Yes** (invitee email) | Medium | **None wired** (status-only; revoke defined but unwired — DP-10); cascaded if org deleted | Status is reversible-ish; rows persist |
| `auth.users` (Supabase) | Authentication identities | n/a | **Yes** (email, auth metadata) | **Critical** | **Out-of-band** (Supabase Auth API / Dashboard) — not writable from SQL Editor | Supabase Auth backup (unverified) |
| Rate-limit keys (Upstash Redis) | F2 sliding-window counters | n/a (IP / `sha256(email)`) | Minimal (hashed) | None | Auto-expire (TTL) | Not needed (ephemeral) |

Notes:
- `profiles.org_id`, `role`, `is_active` are a **frozen backfill snapshot**
  since 0009; authorization reads `organization_memberships`. They are kept
  for rollback safety (do not treat them as live).
- There is **no uploaded-files / storage** entity in the schema today (no
  Supabase Storage buckets referenced in code). If added later, it must be
  added to this inventory.

---

## 4. Deletion surface (application)

Enumerated from `web/src/app/api/**/route.ts`, services, and repositories.

| Entity | Entry point (route) | Service | Repo / DB action | Required role | Hard/soft | Cascade impact (app) |
|---|---|---|---|---|---|---|
| Task | `POST /api/tasks/[id]/delete` | `tasks.service.deleteTask` | `tasksRepo.setDeleted(true)` (`deleted_at`) | any active member | **Soft** | none (flag only) |
| Task | `POST /api/tasks/[id]/restore` | `tasks.service.restoreTask` | `tasksRepo.setDeleted(false)` | any active member | Soft (undo) | none |
| Task | `POST /api/tasks/[id]/archive` / `unarchive` | `archiveTask` / `unarchiveTask` | `tasksRepo.setArchived(...)` (`archived_at`) | any active member | **Soft** | none |
| Client | `POST /api/clients/[id]/archive` / `restore` | `clients.service.archiveClient` / `restoreClient` | `clientsRepo.setActiveStatus(...)` (`is_active`) | **owner/admin** (`assertCanArchive`) | **Soft** | none |
| Client contact | `DELETE /api/clients/[id]/contacts/[contactId]` | `client-contacts.service` (delete) | `contactsRepo.deleteByIdAndClientId` → SQL `DELETE` | (service-gated) | **HARD** | removes one row, irreversible |
| Team member | `POST /api/team/members/[id]/deactivate` | `team.service.deactivateMember` | `membershipsRepo.setActive(false)` | **owner/admin** + last-owner guard | **Soft** | none (membership flag) |
| Notification | `POST /api/notifications/[id]/read`, `/read-all` | notifications service | mark `read_at` | self | Not a delete | none |

Per the audit, the destructive paths have these properties:

- **All are org-scoped on the server** via `session.organization.id` (active
  org) and/or membership RLS — so a caller cannot delete another office's
  data through the app (cross-org deletion blocked; Stage 1 / F1).
- **Confirmation** exists only in the **UI** today (client side). The server
  enforces **role + org scope**, not a typed confirmation (see DP-7).
- **Only `client_contacts` is irreversible.** Everything else is a reversible
  flag.
- **No audit trail** is written for any of these actions (DP-6).

Explicitly **absent** application deletion paths (verified — no route/service):

- Delete **organization** — none.
- Delete **profile** — none.
- Delete **membership** (hard) — none (only deactivate).
- Delete / revoke **invitation** — none wired (`invitationsRepo.setStatus`
  exists but has **no caller**; see DP-10).
- Delete **auth user** — none (out-of-band only).
- No `truncate`, `drop`, `purge`, or bulk-delete utility anywhere.

---

## 5. Foreign-key & cascade map

From `0001_initial_schema.sql`, `0008_invitations.sql`, `0009_multi_office_memberships.sql`.

| Parent | Child | Foreign key | `ON DELETE` | Classification |
|---|---|---|---|---|
| `organizations` | `clients` | `clients.org_id` | **CASCADE** | **High risk** |
| `organizations` | `tasks` | `tasks.org_id` | **CASCADE** | **High risk** |
| `organizations` | `invitations` | `invitations.org_id` | **CASCADE** | **High risk** |
| `organizations` | `organization_memberships` | `memberships.org_id` | **CASCADE** | **High risk** |
| `organizations` | `profiles` | `profiles.org_id` | **RESTRICT** | Requires review (blocks org delete) |
| `clients` | `client_contacts` | `client_contacts.client_id` | **CASCADE** | **High risk** |
| `clients` | `tasks` | `tasks.client_id` | **SET NULL** | Safe |
| `profiles` | `clients` | `clients.created_by` | **SET NULL** | Safe |
| `profiles` | `tasks` (creator) | `tasks.creator_id` | **RESTRICT** | Requires review (blocks profile delete) |
| `profiles` | `tasks` (assignee) | `tasks.assigned_to` | **SET NULL** | Safe |
| `profiles` | `invitations` (inviter) | `invitations.invited_by` | **RESTRICT** | Requires review (blocks profile delete) |
| `profiles` | `invitations` (acceptor) | `invitations.accepted_by` | **SET NULL** | Safe |
| `tasks` | `notifications` | `notifications.task_id` | **CASCADE** | Acceptable (derived data) |
| `profiles` | `notifications` | `notifications.user_id` | **CASCADE** | Acceptable (derived data) |
| `auth.users` | `profiles` | `profiles.id` | **CASCADE** | **High risk** (deleting an auth user removes the app identity) |
| `auth.users` | `organization_memberships` | `memberships.user_id` | **CASCADE** | **High risk** |

**Cascade interpretation (the core of the risk):**

- A manual `DELETE` of one `organizations` row is *designed* to erase that
  tenant's clients → (contacts) → tasks → (notifications) → invitations →
  memberships. It is **blocked** in practice by `profiles.org_id` RESTRICT
  (every profile carries a legacy `org_id`), which can push an operator to
  "work around" the block in an unsafe order (DP-4).
- A manual delete of an `auth.users` row cascades to `profiles`, then to
  `memberships` and `notifications` — but is **blocked** if that profile is a
  `tasks.creator_id` or `invitations.invited_by` (RESTRICT). Result: partial,
  order-dependent, surprising outcomes (DP-3).
- These cascades are **only reachable by a human/operator/script acting
  directly on the DB** (Dashboard, SQL Editor, or a mispointed admin script).
  The application never deletes parents.

---

## 6. Current protections (credit where due)

- **Soft-by-default app design** — tasks/clients/memberships are reversible
  flags; only one contact-level hard delete exists.
- **Org isolation** — destructive ops are scoped to `session.organization.id`
  and enforced again by membership RLS (`user_is_active_member_of`). Cross-org
  deletion via the app is not possible (Stage 1 / F1).
- **Role gating in the service layer** — e.g., `assertCanArchive` (owner/admin)
  for clients; last-owner protections for memberships.
- **No service-role key** — the app cannot bypass RLS; intentional and
  verified absent.
- **No scheduler / cron / background worker** — nothing deletes on a timer.
- **No bulk/`truncate`/`drop`/`purge`** code anywhere.
- **Invitation tokens** stored only as `sha256` hash; never the raw token.
- **Rate-limit data** is external (Upstash), hashed, and TTL-expiring — no
  business data at risk there.

---

## 7. Findings and risks

Each finding cites concrete evidence. No theoretical finding is listed.

### DP-1 — Org-level `ON DELETE CASCADE` enables one-statement tenant wipe
- **Severity:** High
- **Evidence:** `0001_initial_schema.sql` (`clients.org_id … on delete cascade`,
  `tasks.org_id … on delete cascade`, `client_contacts.client_id … cascade`,
  `notifications … cascade`), `0008` (`invitations.org_id … cascade`), `0009`
  (`organization_memberships … cascade`).
- **Current behavior:** Deleting an `organizations` row (manually) cascades to
  all child business data.
- **Risk:** A single mistaken manual `DELETE` irreversibly destroys an entire
  tenant's data; no app guard applies to direct DB access.
- **Recommended mitigation:** Operational guardrail (no manual prod deletes;
  see §11/§15); verify/enable PITR (DP-2); *future* org-level soft-delete
  (`deleted_at`) so even an intended org removal is reversible (§13).

### DP-2 — No documented/verified backup, PITR, or restore runbook
- **Severity:** High
- **Evidence:** `docs/ARCHITECTURE.md:754` and `:766` list "documented backup /
  restore procedure" as **still required** for production readiness; no PITR /
  RPO / RTO defined anywhere in the repo.
- **Current behavior:** Preserve-by-default is the policy, but recoverability
  after a loss event is **unverified**.
- **Risk:** If data is lost (DP-1/DP-3 cascade, operator error, corruption),
  there may be no tested way to recover it — directly contradicting the
  preservation policy.
- **Recommended mitigation:** Confirm Supabase backup tier + PITR; write and
  **test** a restore runbook; define RPO/RTO and restore ownership (§9, §15).

### DP-3 — `auth.users` deletion is out-of-band and cascades unpredictably
- **Severity:** Medium
- **Evidence:** `0001` `profiles.id references auth.users(id) on delete cascade`;
  `tasks.creator_id … on delete restrict`; `0008` `invitations.invited_by …
  restrict`; `supabase/README.md:27-29` (auth schema not writable from SQL
  Editor — deletion must go through Supabase Auth Admin/Dashboard).
- **Current behavior:** Deleting an auth user cascades profile → memberships →
  notifications, but is blocked if the profile created tasks/invitations.
- **Risk:** Partial/blocked deletions, order confusion, and accidental loss of
  the app identity for a real, multi-office user.
- **Recommended mitigation:** Documented, owner-approved procedure; never
  delete auth users for active members; prefer membership deactivation.

### DP-4 — `profiles.org_id` RESTRICT can drive unsafe deletion workarounds
- **Severity:** Medium
- **Evidence:** `0001` `profiles.org_id … on delete restrict`.
- **Current behavior:** Org deletion is silently blocked by any profile whose
  legacy `org_id` points at it.
- **Risk:** An operator hitting the block may delete/repoint profiles in the
  wrong order, causing identity damage.
- **Recommended mitigation:** Documented ordering + "never manual" rule (§11);
  if org deletion is ever built, do it in code as a reviewed, transactional,
  soft-delete-first flow.

### DP-5 — `client_contacts` hard delete is irreversible with no audit
- **Severity:** Medium
- **Evidence:** `web/src/server/repositories/client-contacts.repository.ts:74-86`
  (`.delete()`), called by `web/src/server/services/client-contacts.service.ts:134`.
- **Current behavior:** A contact (PII: name/phone/email) is permanently
  removed; no tombstone, no audit, no restore.
- **Risk:** Permanent, unrecoverable loss of customer PII via a routine action;
  inconsistent with preserve-by-default.
- **Recommended mitigation:** *Future* soft-delete or audit for contacts (§13);
  add server-side confirmation (DP-7); add test coverage (§14); verify the UI
  confirmation exists (§15).

### DP-6 — No audit trail for destructive / state-changing actions
- **Severity:** Medium
- **Evidence:** No audit table in any migration; no audit writes in services
  (`tasks.service`, `clients.service`, `team.service`, `client-contacts.service`).
- **Current behavior:** Deletes/deactivations/archives leave no who/when/what
  record.
- **Risk:** Accidental or malicious deletion cannot be investigated or
  attributed; weak incident response.
- **Recommended mitigation:** *Future* append-only audit table + safe logging
  (no PII/secret) for destructive actions (§13).

### DP-7 — Destructive confirmation is UI-only (not enforced server-side)
- **Severity:** Low–Medium
- **Evidence:** Services perform delete/deactivate with role + org checks only;
  confirmation dialogs live in client components.
- **Current behavior:** A direct API call (bypassing the UI) can perform an
  irreversible delete (e.g., contact) with no confirmation step.
- **Risk:** Loss of the "are you sure" guarantee outside the browser.
- **Recommended mitigation:** *Immediate-ish* server-side requirement for
  irreversible ops (e.g., a typed confirmation field / explicit flag) (§11).

### DP-8 — No secure "export before delete" capability or PII export policy
- **Severity:** Low
- **Evidence:** No export route/service in `web/src/app/api/**` or services.
- **Current behavior:** There is no way to export a tenant's data before a
  (future) deletion, and no policy for handling exported PII.
- **Risk:** A future deletion feature could be built without a safety export,
  or an export could leak PII if stored insecurely.
- **Recommended mitigation:** Define a secure export policy **before** building
  any export/delete (§13, §15).

### DP-9 — "Test" data cannot be identified by name pattern (false-positive risk)
- **Severity:** Low (but blocks any future cleanup)
- **Evidence:** `docs/HANDOFF.md:542` — the **real** production owner org is
  named `לירן בדיקה 1` (code `LIRAN`); "בדיקה" literally means "test".
- **Current behavior:** No `is_test` / metadata flag exists on any table; QA
  and real data are visually similar.
- **Risk:** Any future cleanup keyed on a name pattern (e.g., contains "בדיקה")
  would match **real production data** and delete it.
- **Recommended mitigation:** Never delete by name/pattern. Any future cleanup
  must use an explicit, per-ID **allowlist** confirmed by Liran, with
  preserve-by-default. (Cleanup itself is out of scope for this stage.)

### DP-10 — Invitation revoke is unwired; expired/old invitations retain email PII
- **Severity:** Low
- **Evidence:** `web/src/server/repositories/invitations.repository.ts:67`
  (`setStatus`) has **no caller** in services; `accept_invitation` marks
  `expired` only lazily on an accept attempt (`0008`/`0009`).
- **Current behavior:** Invitations are never deleted and rarely transition;
  expired invitations (with the invitee email) persist indefinitely.
- **Risk:** Low — this is preservation-positive for auditability, but it is an
  **unbounded retention of invitee email PII**; also a latent "revoke" feature
  gap.
- **Recommended mitigation:** Product decision on expired-invitation handling
  (status update, **not** delete); if revoke is wanted, wire `setStatus` as a
  status change (preserve the row).

---

## 8. Preservation policy (proposed)

Default = **Preserve**. Deletion = **explicit action only**.

| Data type | Current behavior | Preservation policy | Deletion allowed? | Required approval | Recovery requirement |
|---|---|---|---|---|---|
| Organizations | No app delete; manual cascade possible | Preserve indefinitely | Only via explicit, reviewed, soft-delete-first flow (not built) | **Owner** + strong confirmation | Must be recoverable (soft-delete + PITR) |
| Memberships | Soft (deactivate) | Preserve; deactivate not delete | Hard delete not allowed | Owner/admin (deactivate) | Reactivate |
| Profiles | No app delete | Preserve (identity) | Not via app | Owner + out-of-band | Backup/PITR |
| Clients | Soft (`is_active`) | Preserve indefinitely | Soft only | Owner/admin | Restore |
| Contacts | **Hard delete** | Preserve; move toward soft-delete | Hard delete discouraged; keep until soft-delete exists | (service-gated) → tighten | **Add** recovery (DP-5) |
| Tasks | Soft (`deleted_at`/`archived_at`) | Preserve indefinitely | Soft only | any active member | Restore / un-archive |
| Notifications | Mark-read | Derived; may prune far future | Allowed (derived), not now | n/a | Regenerable |
| Invitations | Status only | Preserve rows; status transitions only | No delete | Owner/admin (future revoke = status) | Row persists |
| Auth users | Out-of-band | Preserve for active members | Out-of-band only, owner-approved | Owner + manual | Supabase Auth backup |
| Email logs | None in DB (provider-side) | n/a (no PII stored app-side) | n/a | n/a | n/a |
| Security logs | App `console` only (safe metadata) | Preserve via host log retention | n/a | n/a | Host (Vercel) logs |
| Rate-limit data | Upstash TTL | Ephemeral; auto-expire | Auto (TTL) | n/a | Not needed |
| QA/test data | Mixed with real | **No automatic deletion** (DP-9) | Only per-ID allowlist, separate stage | **Owner** | Backup |
| Uploaded files | None today | If added: preserve | n/a | n/a | Define when added |

Policy rules:
1. Business data retained **indefinitely** until an explicit deletion action.
2. Deletion only after explicit action; **org deletion → strong confirmation +
   owner**.
3. Critical deletion → **owner** authority (server-enforced).
4. Future deletions must be **recoverable** wherever feasible.
5. Prefer **archive / soft-delete** over hard delete.
6. **No automatic deletion** without a separate, explicit business decision.
7. **No short retention** for customer business data.

---

## 9. Backup & recovery requirements

Audited from code/docs only — **Supabase was not accessed.**

| Item | Status from repo evidence |
|---|---|
| Documented backup policy | **Not found** (ARCHITECTURE.md:754/766 list it as still-required) |
| Supabase automated backups | **Operational verification required** (depends on plan tier) |
| Point-in-Time Recovery (PITR) | **Operational verification required** |
| Exports | **None** in code |
| Restore procedure / runbook | **Not found** |
| Documented restore test | **Not found** |
| Restore owner | **Undefined** |
| RPO / RTO | **Undefined** |
| Backups contain PII? | Assume **yes** (clients/contacts/profiles) → must be access-controlled |
| Who can access backups | **Operational verification required** (Supabase project access) |

Proposed initial targets (for Liran/ChatGPT to ratify):
- **RPO ≤ 24h** as a floor; **≤ 1h via PITR** if the Supabase tier supports it.
- **RTO ≤ 24h** for full-project restore; **≤ 4h** for a single-tenant restore
  once a runbook exists.
- **Restore test** at least quarterly (and after any schema change).
- **Restore authority:** Liran (owner) only; document the exact steps.
- **Restore verification:** row-count + spot-check of a known org's clients/
  tasks after restore (read-only).

Items marked **Operational verification required** must be checked by Liran in
the Supabase Dashboard (Project → Database → Backups / PITR) — they cannot be
verified from this repository.

---

## 10. Accidental-deletion threat model

| # | Scenario | Severity | Likelihood | Impact | Existing protection | Required mitigation |
|---|---|---|---|---|---|---|
| 1 | Owner deletes an organization by mistake | High | Low (no app path) | Whole tenant cascades | No app delete path; RESTRICT partially blocks | PITR (DP-2); future soft-delete org; strong confirm |
| 2 | Admin deletes a real user | High | Low | Identity + cascade | Out-of-band only; RESTRICT guards | Documented procedure; deactivate instead (DP-3) |
| 3 | User deletes a client linked to tasks | Medium | Low | Client gone; tasks `SET NULL` for `client_id` | Client delete is **soft** (`is_active`) | Keep soft; test (§14) |
| 4 | Deletion runs against the wrong office | High | Low | Cross-tenant loss | Server org-scoping + RLS (F1) | Keep; add tests (§14) |
| 5 | Route receives another org's ID | Medium | Low | Would-be cross-org delete | Org-scoped query returns nothing → 404 | Keep; regression test |
| 6 | Double action causes a second delete | Low | Medium | Redundant (idempotent for soft flags) | Soft flags are idempotent | Idempotency test |
| 7 | Cascade deletes more than intended | High | Low (manual only) | Tenant/identity loss | RESTRICT guards; no app path | PITR; never manual; documented order |
| 8 | Deletion without confirmation | Medium | Medium (API direct) | Irreversible contact loss | UI confirm only | Server-side confirm for irreversible ops (DP-7) |
| 9 | Low-role user performs destructive action | Medium | Low | Unauthorized change | Service role gating + RLS | Role tests (§14) |
| 10 | Partial deletion → orphans | Medium | Low | Inconsistent state | FK constraints (RESTRICT/SET NULL/CASCADE) | Transactional flow if org delete is ever built |
| 11 | Deleting auth user removes business data | High | Low | Profile/memberships/notifications cascade | RESTRICT on task creator/inviter | Procedure; deactivate not delete (DP-3) |
| 12 | Future deploy/migration deletes data | High | Low | Schema/data loss | Manual migration apply; review gate | Backup-before-migrate rule (§15); review |
| 13 | User regrets a deletion | Medium | Medium | Wants undo | Soft delete (most paths) | Recycle-bin/undo window (DP-5/§13) |
| 14 | Attacker takes over an owner account, deletes data | High | Low | Tenant loss | Rate limiting (F2); soft deletes; no org delete path | PITR; audit log (DP-6); future delete delay |
| 15 | Internal script run against Production by mistake | High | Low | Arbitrary loss | No service-role key; no scripts in repo | "No manual prod writes" rule (§15); least-privilege access |
| 16 | Backup exists but cannot be restored | High | Unknown | Unrecoverable | Unverified | Test restore (DP-2/§9) |
| 17 | Export contains PII, stored insecurely | Medium | Low (no export today) | PII leak | No export exists | Secure-export policy before building (DP-8) |

---

## 11. Immediate safety controls (no schema change)

These can be added later **without** a migration. **None are implemented in
this document** — they are the recommended next implementation step.

1. **Server-side strong confirmation for irreversible ops** — require an
   explicit typed value (e.g., the org name, or `confirm: true` + a phrase)
   in the request body for the contact hard-delete and any future org/user
   deletion. Closes DP-7.
2. **Owner-only gating** (server) for organization/identity-level destructive
   actions, re-checked in the service layer.
3. **Active-organization validation** on every destructive route (already true
   for current paths — lock it in with tests).
4. **Typed destructive actions** — never infer "delete" from a generic update;
   keep dedicated, explicit endpoints.
5. **Safe logging** of destructive actions using the existing `toSafeErrorMeta`
   pattern philosophy (no PII/secret) — a precursor to a real audit log.
6. **Feature flag / kill-switch** to disable destructive endpoints quickly if
   abuse is detected.
7. **Test coverage** for cross-org, role, soft-vs-hard, and idempotency (§14).
8. **Operational "no manual Production writes" rule** documented and agreed
   (the single highest-leverage control — most real risk is manual DB access).

---

## 12. Future code changes (require code, no schema)

- Archive/recycle-bin UX surfacing for already-soft-deleted tasks/clients
  (data already supports it).
- Server-side confirmation tokens for irreversible operations.
- "Export my office data" (read-only) — gated, owner-only, with a secure
  delivery channel (precondition for any future deletion feature; DP-8).
- Delete-delay / cancellation window for any future hard deletion.
- Admin-visible action log screen (reads the future audit table).

## 13. Future schema changes (require migration — NOT in this stage)

> Listed as requirements only. **No migration, no `deleted_at`, no audit
> table, no FK change is created here.**

- `client_contacts.deleted_at` (+ `deleted_by`) → make contact deletion soft
  (closes DP-5).
- `organizations.deleted_at` / `deletion_requested_at` → reversible,
  delay-able org deletion (closes part of DP-1).
- Append-only **audit table** (actor, action, entity, entity_id, org_id,
  timestamp; **no PII payload**) → closes DP-6.
- Optional **tombstone / restore metadata** for hard-deletable entities.
- Review whether any `ON DELETE CASCADE` should become `RESTRICT` (defense
  against accidental cascades) — **design decision, not done here.**

## 14. Test coverage gaps

Existing tests (post-Stage-4): `web/src/server/email/*.test.ts`,
`web/src/server/services/team.service.test.ts`,
`web/src/server/services/tasks.service.test.ts` (email/best-effort focus).
There are **no deletion-safety tests** today.

Missing (recommended, mock-only, no DB, no real deletion):
- Cross-org deletion is rejected (task/client/contact/member with a foreign
  org id → not found / forbidden).
- Owner/admin gating for client archive and member deactivate; low-role
  rejection.
- Last-owner protection (cannot deactivate/demote the last active owner).
- Soft-vs-hard guarantee: `deleteTask` sets `deleted_at` (never hard-deletes);
  `archiveClient` toggles `is_active` (never hard-deletes).
- Child preservation: deleting/soft-deleting a parent does not silently destroy
  unrelated children in app flows.
- Unknown entity id → safe 404 (no 500, no leak).
- Duplicate delete request is idempotent for soft flags.
- Destructive error responses contain no PII/secret (reuse the Stage-4 safe-log
  assertions).

> This stage adds **no tests** (documentation-only PR) to keep the planning
> change clean; the above is the backlog for the implementation stage.

## 15. Operational verification checklist (manual, Supabase/Vercel)

To be performed by Liran — **read-only**, no changes:

- [ ] Confirm Supabase backup tier (daily backups? retention length?).
- [ ] Confirm PITR availability + window on the current plan.
- [ ] Record who has Supabase project + DB access (least privilege).
- [ ] Confirm there is **no** `pg_cron` / scheduled job in the database.
- [ ] Confirm there is **no** service-role key configured in Vercel (it must
      remain absent).
- [ ] Names-only env check (carried from Stage 4): `RESEND_API_KEY`,
      `MAIL_FROM` presence in Production/Preview (values not needed).
- [ ] Verify the UI shows a confirmation before the contact hard-delete.
- [ ] Adopt and document the **"no manual Production writes / deletes"** rule.
- [ ] Schedule a **restore test** once PITR/backup is confirmed.

## 16. Open decisions

1. **Backup/PITR tier** — is PITR enabled? What RPO/RTO do we commit to? (DP-2)
2. **Contact deletion** — accept current hard delete short-term, or prioritize
   soft-delete (DP-5)?
3. **Org deletion** — do we ever want an in-app org-deletion flow, and if so,
   soft-delete-first + owner + strong confirm? (DP-1)
4. **Audit log** — build the append-only audit table now or later? (DP-6)
5. **Expired invitations** — leave indefinitely, or transition status / prune
   email after N days (status change, not row delete)? (DP-10)
6. **Export-before-delete** — required before any future deletion feature? (DP-8)
7. **Cascade hardening** — convert selected `CASCADE` to `RESTRICT`? (risk vs.
   operational friction).

## 17. Explicit no-delete confirmation

This stage and this document:

- Delete **no** data of any kind.
- Execute **no** SQL and **no** Production database query.
- Create **no** migration, schema change, FK change, or cascade change.
- Add **no** `deleted_at` / audit columns, **no** cleanup script, **no** cron,
  **no** purge process, **no** delete utility.
- Change **no** Supabase configuration, RLS, policies, or auth users.
- Change **no** Production environment variables and perform **no** deployment.

Everything above is a **plan**. Implementation of any control requires its own
reviewed stage and explicit approval.
