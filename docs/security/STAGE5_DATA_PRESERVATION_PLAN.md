# Stage 5 / F10 — Data Preservation & Deletion Safety Plan

> Status: **PLANNING / PREPARATION ONLY.** This document describes current
> behavior, risks, and *proposed* future controls. It changes no data, no
> schema, no policies, and no Supabase configuration. Nothing here is
> implemented by merging this document.
>
> Baseline commit: `107b530ba1d265352c0b9d6bac023ef0298faace` (`main`).
>
> **Scope of evidence.** This audit is a **read-only review of the
> repository** (code, migrations, docs). It does **not** observe the live
> Production configuration. Statements about the *application* are repository
> facts; statements about the *deployed database/project* (Supabase Cron,
> Database Functions, Webhooks, triggers, Dashboard-created jobs, deployed
> environment variables, backups, PITR) are **operationally unverified** and
> are explicitly flagged as requiring a read-only Dashboard check (§15). A
> repository scan does not prove the complete Production configuration.

---

## 1. Executive summary

AVI.APP stores financial-adjacent business data for an Israeli accounting
office (clients, contacts, tasks, team identities). The governing product
decision for this stage is **preserve-by-default**: business data is kept
without an automatic expiry and is deleted only by an explicit, authorized
action (or where required by contract/law) — never automatically, never on a
timer, never by a name/pattern match.

What the repository audit shows:

- **The application's destructive surface is small and mostly reversible.**
  Every user-facing "delete" except one is a **soft / reversible** operation
  (tasks → `deleted_at`/`archived_at`, clients → `is_active`, members →
  `is_active`). The single exception is **hard-deleting one client contact**,
  which — per code inspection — is available to **any active member of the
  org, including a low-role employee** (Finding DP-5).
- **No cron, scheduled worker, cleanup job, or service-role usage was found
  in the audited repository.** This is a repository finding, **not** a proof
  about Production: Supabase-side Cron, Database Functions, Webhooks,
  triggers, Dashboard-created jobs, and deployed environment variables were
  **not operationally verified** and require a read-only Dashboard check (§15).
- **Cross-org deletion through the app is structurally blocked** by org-scoped
  queries plus membership-based RLS (the Stage 1 / F1 defense-in-depth).

The principal risk is **not** the application — it is **out-of-band manual
operations** against the database (Supabase Dashboard / SQL Editor /
privileged DB access) combined with PostgreSQL `ON DELETE` relationships and
an **unverified backup/recovery posture**. The schema's `ON DELETE RESTRICT`
references mean a *direct* `DELETE` of an `organizations` row is **expected to
fail** while referencing `profiles` rows remain — but if those RESTRICT
references are removed, repointed, absent, or bypassed through an unsafe
manual sequence, the remaining `ON DELETE CASCADE` relationships can erase
large portions of a tenant. The danger is a **dangerous manual deletion
sequence and a latent cascade blast radius**, not an unconditional one-
statement wipe of the current populated schema. Today there is no documented,
tested restore path to undo such a mistake (the backup/PITR posture is
operationally unverified).

This plan therefore focuses on: (a) mapping every deletion path and cascade,
(b) a preserve-by-default policy, (c) backup/recovery requirements, (d) an
accidental-deletion threat model, and (e) prioritized safety controls — with
a hard line that **nothing destructive is implemented in this stage.**

Verdict: **PRESERVATION PLAN READY WITH OPEN DECISIONS** (see §16).

---

## 2. Product preservation decision (binding for this stage)

> Customer business data is **preserved by default and retained without an
> automatic expiry**, unless the customer explicitly requests deletion,
> performs an authorized deletion action, or deletion is required by an
> applicable contractual or legal obligation.

Important qualifications:

- **This document does not define legal retention periods.** A **legal /
  privacy review is required before any permanent-retention promise is
  published to customers** (Israeli Privacy Law / data-protection
  obligations).
- **Operational records and third-party PII** — for example, the invitee
  email retained on expired/used invitations — may require a **separate
  future retention policy** distinct from core customer business data.

Consequences adopted by this plan:

- **No automatic deletion** of organizations, memberships, profiles, clients,
  contacts, tasks, notifications, invitations, auth users, activity history,
  or any other business data.
- **No short retention window** for customer business data.
- Deletion happens **only** after an explicit authorized action (or where
  required by contract/law); **organization-level** deletion requires a
  strong confirmation and **owner** authority.
- Future deletion mechanisms must prefer **archive / soft-delete** over hard
  delete, and must be **recoverable** wherever feasible.
- Stage 5 is **not** a cleanup stage. No QA/seed/test data is deleted here.
  (Identifying test data safely is itself a risk — see Finding **DP-9**.)

---

## 3. Data inventory

All entities below were confirmed to exist in `supabase/migrations/` and/or
the repositories. No entity is assumed that is not present in code/migrations.
Supabase-managed `auth.users` is included because app tables reference it.

| Entity | Purpose | Organization key | Contains PII | Business critical | Deletion path (today) | Recovery |
|---|---|---|---|---|---|---|
| `organizations` | Tenant root — one per accounting office | `id` (self) | Low (office name/phone/email/address) | **Critical** | **None in app.** Manual/privileged DB `DELETE` only (RESTRICT-guarded; cascade blast radius — see §5) | Project/database recovery path operationally unverified |
| `profiles` | Global user identity; legacy `org_id/role/is_active` frozen snapshot (0009) | `org_id` (legacy, non-authoritative) | **Yes** (full_name, email, phone, avatar) | **Critical** (identity) | **None in app.** Cascaded if its `auth.users` row is deleted out-of-band | Project/database recovery path operationally unverified; application-level identity recovery not guaranteed |
| `organization_memberships` | Source of truth for role + active per (user, org) (0009) | `org_id` | Low (FK ids + role) | **Critical** (authorization) | **Soft** via deactivate (`is_active=false`); hard-cascaded if user/org deleted out-of-band | Reactivate (soft); else project recovery (unverified) |
| `clients` | Accounting-office customers | `org_id` | **Yes** (name, tax_id, email, phone, address, notes) | **Critical** | **Soft only** (`is_active=false`); cascaded if org deleted out-of-band | Restore (un-archive); else project recovery (unverified) |
| `client_contacts` | Contacts per client | via `client_id → clients.org_id` | **Yes** (name, role, phone, email) | High | **HARD delete** by **any active org member** (DP-5); also cascaded if client/org deleted out-of-band | **None in app** (irreversible) |
| `tasks` | Core work items | `org_id` | Medium (title/description may contain client detail) | High | **Soft** (`deleted_at`) + **archive** (`archived_at`); cascaded if org deleted out-of-band | Restore / un-archive; else project recovery (unverified) |
| `notifications` | In-app bell items (derived) | via `user_id`/`task_id` | Low–Medium (title/body text) | Low (regenerable) | Mark-read only; cascaded if user/task deleted | Not needed (derived) |
| `invitations` | Pending/used team invites; token stored as `sha256` hash only | `org_id` | **Yes** (invitee email) | Medium | **None wired** (status-only; revoke defined but unwired — DP-10); cascaded if org deleted out-of-band | Status reversible-ish; rows persist |
| `auth.users` (Supabase) | Authentication identities | n/a | **Yes** (email, auth metadata) | **Critical** | **Out-of-band relative to the app** — via Supabase administrative interfaces or privileged database access; **AVI.APP has no auth-user deletion route** | Project/database recovery path operationally unverified; application-level identity recovery not guaranteed |
| Rate-limit keys (Upstash Redis) | F2 sliding-window counters | n/a (IP / `sha256(email)`) | Minimal (hashed) | None | Auto-expire (TTL) | Not needed (ephemeral) |

Notes:
- `profiles.org_id`, `role`, `is_active` are a **frozen backfill snapshot**
  since 0009; authorization reads `organization_memberships`. They are kept
  for rollback safety (do not treat them as live).
- There is **no uploaded-files / storage** entity in the schema today (no
  Supabase Storage buckets referenced in the audited code). If added later, it
  must be added to this inventory.

---

## 4. Deletion surface (application)

Enumerated from `web/src/app/api/**/route.ts`, services, and repositories.

| Entity | Entry point (route) | Service | Repo / DB action | Authorization (verified in code) | Hard/soft | Cascade impact (app) |
|---|---|---|---|---|---|---|
| Task | `POST /api/tasks/[id]/delete` | `tasks.service.deleteTask` | `tasksRepo.setDeleted(true)` (`deleted_at`) | any active member (org-scoped) | **Soft** | none (flag only) |
| Task | `POST /api/tasks/[id]/restore` | `tasks.service.restoreTask` | `tasksRepo.setDeleted(false)` | any active member | Soft (undo) | none |
| Task | `POST /api/tasks/[id]/archive` / `unarchive` | `archiveTask` / `unarchiveTask` | `tasksRepo.setArchived(...)` (`archived_at`) | any active member | **Soft** | none |
| Client | `POST /api/clients/[id]/archive` / `restore` | `clients.service.archiveClient` / `restoreClient` | `clientsRepo.setActiveStatus(...)` (`is_active`) | **owner/admin** (`assertCanArchive`) | **Soft** | none |
| Client contact | `DELETE /api/clients/[id]/contacts/[contactId]` | `client-contacts.service.deleteContact` | `contactsRepo.deleteByIdAndClientId` → SQL `DELETE` | **any active org member (incl. employee)** — `requireSession()` + `assertClientInOrg`, **no role gate** (DP-5) | **HARD** | removes one row, irreversible |
| Team member | `POST /api/team/members/[id]/deactivate` | `team.service.deactivateMember` | `membershipsRepo.setActive(false)` | **owner/admin** + last-owner guard | **Soft** | none (membership flag) |
| Notification | `POST /api/notifications/[id]/read`, `/read-all` | notifications service | mark `read_at` | self | Not a delete | none |

Per the audit, the destructive paths have these properties:

- **All are org-scoped on the server** via `session.organization.id` (active
  org) and/or membership RLS — so a caller cannot delete another office's
  data through the app (cross-org deletion blocked; Stage 1 / F1).
- **Confirmation** exists only in the **UI** today (client side). The server
  enforces **role + org scope** (where a role gate exists), not a typed
  confirmation (see DP-7).
- **Only `client_contacts` is irreversible**, and it has **no role gate**
  (DP-5).
- **No audit trail** is written for any of these actions (DP-6).

Explicitly **absent** application deletion paths (verified — no route/service):

- Delete **organization** — none.
- Delete **profile** — none.
- Delete **membership** (hard) — none (only deactivate).
- Delete / revoke **invitation** — none wired (`invitationsRepo.setStatus`
  exists but has **no caller**; see DP-10).
- Delete **auth user** — none in the app (out-of-band only).
- No `truncate`, `drop`, `purge`, or bulk-delete utility found in the audited
  repository.

---

## 5. Foreign-key & cascade map

From `0001_initial_schema.sql`, `0008_invitations.sql`, `0009_multi_office_memberships.sql`.

| Parent | Child | Foreign key | `ON DELETE` | Classification |
|---|---|---|---|---|
| `organizations` | `clients` | `clients.org_id` | **CASCADE** | **High risk** |
| `organizations` | `tasks` | `tasks.org_id` | **CASCADE** | **High risk** |
| `organizations` | `invitations` | `invitations.org_id` | **CASCADE** | **High risk** |
| `organizations` | `organization_memberships` | `memberships.org_id` | **CASCADE** | **High risk** |
| `organizations` | `profiles` | `profiles.org_id` | **RESTRICT** | Guard (blocks direct org delete) |
| `clients` | `client_contacts` | `client_contacts.client_id` | **CASCADE** | **High risk** |
| `clients` | `tasks` | `tasks.client_id` | **SET NULL** | Safe |
| `profiles` | `clients` | `clients.created_by` | **SET NULL** | Safe |
| `profiles` | `tasks` (creator) | `tasks.creator_id` | **RESTRICT** | Guard (blocks direct profile delete) |
| `profiles` | `tasks` (assignee) | `tasks.assigned_to` | **SET NULL** | Safe |
| `profiles` | `invitations` (inviter) | `invitations.invited_by` | **RESTRICT** | Guard (blocks direct profile delete) |
| `profiles` | `invitations` (acceptor) | `invitations.accepted_by` | **SET NULL** | Safe |
| `tasks` | `notifications` | `notifications.task_id` | **CASCADE** | Acceptable (derived data) |
| `profiles` | `notifications` | `notifications.user_id` | **CASCADE** | Acceptable (derived data) |
| `auth.users` | `profiles` | `profiles.id` | **CASCADE** | **High risk** (out-of-band deletion removes the app identity) |
| `auth.users` | `organization_memberships` | `memberships.user_id` | **CASCADE** | **High risk** |

**Cascade interpretation (the core of the risk):**

- A *direct* manual `DELETE` of one `organizations` row is **expected to
  fail** while any `profiles` row still references it (`profiles.org_id ON
  DELETE RESTRICT`). It is **not** an unconditional one-statement tenant wipe
  on the current populated schema.
- **However**, the `ON DELETE CASCADE` edges from `organizations` to clients →
  (contacts) → tasks → (notifications), plus invitations and memberships, are
  a **latent blast radius**. If the RESTRICT references are **removed,
  repointed, absent, or bypassed through an unsafe manual sequence** (e.g., an
  operator deletes/repoints profiles first to "get past" the block), a
  subsequent org delete can erase large portions of the tenant. The danger is
  a **dangerous manual deletion sequence**, not a single statement.
- A manual delete of an `auth.users` row cascades to `profiles`, then to
  `memberships` and `notifications` — but is **blocked** if that profile is a
  `tasks.creator_id` or `invitations.invited_by` (RESTRICT). Result: partial,
  order-dependent, surprising outcomes (DP-3).
- These cascades are reachable only by a human/operator/script acting
  **directly on the database** (Dashboard, SQL Editor, or privileged/mispointed
  access). The application never deletes parents.

---

## 6. Current protections (credit where due)

- **Soft-by-default app design** — tasks/clients/memberships are reversible
  flags; only one contact-level hard delete exists.
- **Org isolation** — destructive ops are scoped to `session.organization.id`
  and enforced again by membership RLS (`user_is_active_member_of`). Cross-org
  deletion via the app is not possible (Stage 1 / F1).
- **Role gating in the service layer** — e.g., `assertCanArchive` (owner/admin)
  for clients; last-owner protections for memberships. **Exception:** the
  contact hard delete has **no** role gate (DP-5).
- **No service-role usage found in the audited repository** — the app code
  does not configure or use a Supabase service-role key. *(Repository
  finding; whether a service-role key exists in the deployed environment is
  operationally unverified — §15.)*
- **No scheduler / cron / background worker found in the audited repository.**
  *(Repository finding; Supabase-side Cron / Functions / Webhooks / triggers
  and Dashboard-created jobs are operationally unverified — §15.)*
- **No bulk/`truncate`/`drop`/`purge`** code found in the audited repository.
- **Invitation tokens** stored only as `sha256` hash; never the raw token.
- **Rate-limit data** is external (Upstash), hashed, and TTL-expiring — no
  business data at risk there.

---

## 7. Findings and risks

Each finding cites concrete evidence. No theoretical finding is listed.

### DP-1 — Latent organization cascade blast radius (unsafe manual deletion sequence)
- **Severity:** High
- **Evidence:** `0001_initial_schema.sql` (`clients.org_id … on delete cascade`,
  `tasks.org_id … cascade`, `client_contacts.client_id … cascade`,
  `notifications … cascade`, **`profiles.org_id … on delete restrict`**),
  `0008` (`invitations.org_id … cascade`), `0009`
  (`organization_memberships … cascade`).
- **Current behavior:** A direct `DELETE` of an `organizations` row is
  **expected to fail** while referencing `profiles` rows remain (RESTRICT). The
  CASCADE edges to all child business data are latent.
- **Risk:** If the RESTRICT references are removed/repointed/absent or bypassed
  through an unsafe manual sequence, the remaining CASCADE relationships can
  erase large portions of the tenant. The risk is a **dangerous manual
  deletion sequence and latent cascade blast radius**, not an unconditional
  one-statement wipe of the current populated schema; no app guard applies to
  direct DB access.
- **Recommended mitigation:** Operational guardrail (no manual prod deletes;
  §11/§15); verify/enable PITR (DP-2); *future* org-level soft-delete
  (`deleted_at`) so even an intended org removal is reversible (§13); consider
  reviewing whether some CASCADE edges should be RESTRICT.

### DP-2 — Backup, PITR, and restore posture is operationally unverified
- **Severity:** High
- **Evidence:** `docs/ARCHITECTURE.md:754` and `:766` list "documented backup /
  restore procedure" as **still required** for production readiness; no PITR /
  RPO / RTO defined anywhere in the repo.
- **Current behavior:** Preserve-by-default is the policy, but recoverability
  after a loss event is **unverified** (cannot be confirmed from the repo).
- **Risk:** If data is lost (DP-1/DP-3 cascade, operator error, corruption),
  there may be no tested way to recover it — directly contradicting the
  preservation policy.
- **Recommended mitigation:** Operationally verify Supabase backup tier + PITR
  + retention (§15); write and **test** a restore runbook; ratify RPO/RTO and
  restore ownership (§9). No restore guarantee exists until a restore test
  passes.

### DP-3 — Auth-user deletion is out-of-band and cascades unpredictably
- **Severity:** Medium
- **Evidence:** `0001` `profiles.id references auth.users(id) on delete cascade`;
  `tasks.creator_id … on delete restrict`; `0008` `invitations.invited_by …
  restrict`; no auth-user deletion route exists in `web/src/app/api/**`.
- **Current behavior:** Auth-user deletion is **out-of-band relative to the
  AVI.APP application** — it may be performed through Supabase administrative
  interfaces or privileged database access. **AVI.APP itself has no auth-user
  deletion route.** Such a deletion cascades profile → memberships →
  notifications, but is blocked if the profile created tasks/invitations
  (RESTRICT).
- **Risk:** Partial/blocked deletions, order confusion, and accidental loss of
  the app identity for a real, multi-office user. Because it can trigger FK
  cascades/restrictions, it requires a documented procedure.
- **Recommended mitigation:** Documented, owner-approved out-of-band procedure;
  never delete auth users for active members; prefer membership deactivation.

### DP-4 — `profiles.org_id` RESTRICT can drive unsafe deletion workarounds
- **Severity:** Medium
- **Evidence:** `0001` `profiles.org_id … on delete restrict`.
- **Current behavior:** Org deletion is silently blocked by any profile whose
  legacy `org_id` points at it.
- **Risk:** An operator hitting the block may delete/repoint profiles in the
  wrong order, causing identity damage and enabling the DP-1 cascade.
- **Recommended mitigation:** Documented ordering + "never manual" rule (§11);
  if org deletion is ever built, do it in code as a reviewed, transactional,
  soft-delete-first flow.

### DP-5 — `client_contacts` hard delete is irreversible, has no role gate, and is reachable by any employee
- **Severity:** **Medium-High** (raised after authorization inspection)
- **Evidence:** Route `web/src/app/api/clients/[id]/contacts/[contactId]/route.ts`
  `DELETE` uses **`requireSession()`** (no `requireRole`); service
  `web/src/server/services/client-contacts.service.ts:128-136` `deleteContact`
  calls `assertClientInOrg(session, clientId)` then
  `contactsRepo.deleteByIdAndClientId` (`client-contacts.repository.ts:74-86`,
  SQL `DELETE`). There is **no role check** anywhere in the path.
- **Exact authorization:** **Any active member of the client's organization —
  including a low-role `employee` — may permanently hard-delete a contact.**
  Active-organization scoping **is** validated (`assertClientInOrg` against
  `session.organization.id`, reinforced by RLS via a `clients` EXISTS
  subquery), and **cross-org deletion is blocked**. What is missing is a
  **role restriction**: a low-privilege employee can permanently delete
  contact PII (name/phone/email).
- **Current behavior:** Irreversible deletion of a contact row; no tombstone,
  no audit, no restore.
- **Risk:** Permanent, unrecoverable loss of customer PII by the
  lowest-privilege role, with no audit trail — inconsistent with
  preserve-by-default.
- **Recommended mitigation (priority):** (a) add server-side **role gating**
  (owner/admin) for contact deletion; (b) add a server-side **confirmation**
  for this irreversible op (DP-7); (c) *future* **soft-delete or audit** for
  contacts (§13); (d) add **test coverage** (§14); (e) verify the UI
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
- **Evidence:** Services perform delete/deactivate with role + org checks only
  (and the contact delete with no role check); confirmation dialogs live in
  client components.
- **Current behavior:** A direct API call (bypassing the UI) can perform an
  irreversible delete (e.g., contact) with no confirmation step.
- **Risk:** Loss of the "are you sure" guarantee outside the browser.
- **Recommended mitigation:** Server-side requirement for irreversible ops
  (e.g., a typed confirmation field / explicit flag) (§11).

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

### DP-10 — Invitation revoke is unwired; expired invitations retain email PII
- **Severity:** Low
- **Evidence:** `web/src/server/repositories/invitations.repository.ts:67`
  (`setStatus`) has **no caller** in services; `accept_invitation` marks
  `expired` only lazily on an accept attempt (`0008`/`0009`).
- **Current behavior:** Invitations are never deleted and rarely transition;
  expired/used invitations (with the invitee email) persist indefinitely.
- **Risk:** Low — preservation-positive for auditability, but an **unbounded
  retention of invitee email PII**; also a latent "revoke" feature gap. This is
  exactly the kind of operational/third-party PII the §2 qualification flags
  for a separate future policy.
- **Recommended mitigation:** Product decision on expired-invitation handling
  (status update, **not** delete; or a separate retention policy for the email
  field); if revoke is wanted, wire `setStatus` as a status change (preserve
  the row).

---

## 8. Preservation policy (proposed)

Default = **Preserve** (no automatic expiry). Deletion = **explicit authorized
action, or where required by contract/law** — see §2 for the exact wording and
the legal-review qualification.

| Data type | Current behavior | Preservation policy | Deletion allowed? | Required approval | Recovery requirement |
|---|---|---|---|---|---|
| Organizations | No app delete; manual cascade blast radius | Preserve indefinitely | Only via explicit, reviewed, soft-delete-first flow (not built) | **Owner** + strong confirmation | Must be recoverable (soft-delete + verified PITR) |
| Memberships | Soft (deactivate) | Preserve; deactivate not delete | Hard delete not allowed | Owner/admin (deactivate) | Reactivate |
| Profiles | No app delete | Preserve (identity) | Not via app | Owner + out-of-band | Project recovery (unverified) |
| Clients | Soft (`is_active`) | Preserve indefinitely | Soft only | Owner/admin | Restore |
| Contacts | **Hard delete, no role gate** | Preserve; add role gate + move toward soft-delete | Hard delete discouraged; restrict to owner/admin until soft-delete exists | tighten to **owner/admin** (DP-5) | **Add** recovery (DP-5) |
| Tasks | Soft (`deleted_at`/`archived_at`) | Preserve indefinitely | Soft only | any active member | Restore / un-archive |
| Notifications | Mark-read | Derived; may prune far future | Allowed (derived), not now | n/a | Regenerable |
| Invitations | Status only (revoke unwired) | Preserve rows; status transitions only; separate PII policy for the email field | No delete | Owner/admin (future revoke = status) | Row persists |
| Auth users | Out-of-band only | Preserve for active members | Out-of-band only, owner-approved | Owner + manual | Project recovery (unverified) |
| Email logs | None in DB (provider-side) | n/a (no PII stored app-side) | n/a | n/a | n/a |
| Security logs | App `console` only (safe metadata) | Preserve via host log retention | n/a | n/a | Host (Vercel) logs |
| Rate-limit data | Upstash TTL | Ephemeral; auto-expire | Auto (TTL) | n/a | Not needed |
| QA/test data | Mixed with real | **No automatic deletion** (DP-9) | Only per-ID allowlist, separate stage | **Owner** | Project recovery |
| Uploaded files | None today | If added: preserve | n/a | n/a | Define when added |

Policy rules:
1. Business data retained **without automatic expiry** until an explicit
   authorized deletion action, or where required by contract/law.
2. Deletion only after an explicit authorized action; **org deletion → strong
   confirmation + owner**.
3. Critical deletion → **owner** authority (server-enforced).
4. Future deletions must be **recoverable** wherever feasible.
5. Prefer **archive / soft-delete** over hard delete.
6. **No automatic deletion** without a separate, explicit business decision.
7. **No short retention** for customer business data.
8. **Legal/privacy review** is required before publishing a permanent-retention
   promise; operational/third-party PII (e.g., expired-invitation email) may
   get a separate policy.

---

## 9. Backup & recovery requirements

Audited from code/docs only — **Supabase was not accessed.**

| Item | Status from repo evidence |
|---|---|
| Documented backup policy | **Not found** (ARCHITECTURE.md:754/766 list it as still-required) |
| Supabase automated backups | **Operationally unverified** (depends on plan tier) |
| Point-in-Time Recovery (PITR) | **Operationally unverified** |
| Backup retention length | **Operationally unverified** |
| Exports | **None** in code |
| Restore procedure / runbook | **Not found** |
| Documented restore test | **Not found** |
| Restore owner | **Undefined** |
| RPO / RTO | **Undefined** |
| Backups contain PII? | Assume **yes** (clients/contacts/profiles) → must be access-controlled |
| Who can access backups | **Operationally unverified** (Supabase project access) |

**Recovery reality (important):**
- **Supabase project/database backup availability is operationally
  unverified.**
- **A project backup does not by itself prove application-level or
  single-tenant recovery.**
- **Single-tenant recovery may require** restoring to an **isolated project**,
  **extracting** the relevant tenant's rows, **validating dependencies**
  (FKs, identities, memberships), and **importing** them through a
  **separately reviewed procedure**.
- **No restore guarantee exists until a restore test passes.**

**Illustrative targets requiring ratification (NOT commitments).** The numbers
below are placeholders to anchor discussion; they must not be treated as
verified guarantees until the Supabase tier, PITR availability, backup
retention, database size, restore mechanism, and a **tested** runbook are
confirmed:
- *Illustrative* RPO: to be ratified (e.g., daily, or near-real-time only if
  PITR is confirmed).
- *Illustrative* RTO: to be ratified (full-project vs. single-tenant restore
  will differ substantially).
- *Illustrative* restore-test cadence: at least quarterly and after any schema
  change.
- *Illustrative* restore authority: owner (Liran) only.
- *Illustrative* restore verification: row-count + spot-check of a known org's
  clients/tasks after restore (read-only).

Items marked **Operationally unverified** must be checked by Liran in the
Supabase Dashboard (Project → Database → Backups / PITR) — they cannot be
verified from this repository.

---

## 10. Accidental-deletion threat model

| # | Scenario | Severity | Likelihood | Impact | Existing protection | Required mitigation |
|---|---|---|---|---|---|---|
| 1 | Operator deletes an organization out-of-band | High | Low (RESTRICT-guarded; no app path) | Latent cascade blast radius if guards bypassed | RESTRICT on `profiles.org_id`; no app delete path | Verified PITR (DP-2); future soft-delete org; "never manual" rule |
| 2 | Admin/operator deletes a real user out-of-band | High | Low | Identity + cascade | Out-of-band only; RESTRICT guards | Documented procedure; deactivate instead (DP-3) |
| 3 | User deletes a client linked to tasks | Medium | Low | Client gone; tasks `SET NULL` for `client_id` | Client delete is **soft** (`is_active`) | Keep soft; test (§14) |
| 4 | Deletion runs against the wrong office | High | Low | Cross-tenant loss | Server org-scoping + RLS (F1) | Keep; add tests (§14) |
| 5 | Route receives another org's ID | Medium | Low | Would-be cross-org delete | Org-scoped query returns nothing → 404 | Keep; regression test |
| 6 | Double action causes a second delete | Low | Medium | Redundant (idempotent for soft flags) | Soft flags are idempotent | Idempotency test |
| 7 | Unsafe manual sequence triggers org cascade | High | Low | Tenant data erased via cascade | RESTRICT guards; no app path | Verified PITR; "never manual"; documented order |
| 8 | Contact deletion without confirmation | Medium-High | Medium (API direct; any employee) | Irreversible contact PII loss | UI confirm only; **no role gate** | Server-side confirm + **role gate** (DP-5/DP-7) |
| 9 | Low-role user performs destructive action | Medium-High | Medium | Permanent contact PII deletion by employee | Org scope only; **no role gate on contact delete** | Add role gating (DP-5); role tests (§14) |
| 10 | Partial deletion → orphans | Medium | Low | Inconsistent state | FK constraints (RESTRICT/SET NULL/CASCADE) | Transactional flow if org delete is ever built |
| 11 | Out-of-band auth-user deletion removes business data | High | Low | Profile/memberships/notifications cascade | RESTRICT on task creator/inviter | Procedure; deactivate not delete (DP-3) |
| 12 | Future deploy/migration deletes data | High | Low | Schema/data loss | Manual migration apply; review gate | Backup-before-migrate rule (§15); review |
| 13 | User regrets a deletion | Medium | Medium | Wants undo | Soft delete (most paths); **not** contacts | Recycle-bin/undo window (DP-5/§13) |
| 14 | Attacker takes over an owner account, deletes data | High | Low | Tenant loss | Rate limiting (F2); soft deletes; no org delete path | Verified PITR; audit log (DP-6); future delete delay |
| 15 | Internal/privileged script run against Production by mistake | High | Low | Arbitrary loss | No service-role usage found in repo (Production unverified) | "No manual prod writes" rule (§15); least-privilege access; verify env (§15) |
| 16 | Backup exists but cannot be restored | High | Unknown | Unrecoverable | Unverified | Test restore (DP-2/§9) |
| 17 | Export contains PII, stored insecurely | Medium | Low (no export today) | PII leak | No export exists | Secure-export policy before building (DP-8) |

---

## 11. Immediate safety controls (no schema change)

These can be added later **without** a migration. **None are implemented in
this document** — they are the recommended next implementation step.

1. **Role-gate the contact hard delete** (server, owner/admin) — closes the
   most concrete current gap (DP-5: today any employee can permanently delete
   contact PII).
2. **Server-side strong confirmation for irreversible ops** — require an
   explicit typed value (e.g., the org name, or `confirm: true` + a phrase)
   in the request body for the contact hard-delete and any future org/user
   deletion. Closes DP-7.
3. **Owner-only gating** (server) for organization/identity-level destructive
   actions, re-checked in the service layer.
4. **Active-organization validation** on every destructive route (already true
   for current paths — lock it in with tests).
5. **Typed destructive actions** — never infer "delete" from a generic update;
   keep dedicated, explicit endpoints.
6. **Safe logging** of destructive actions using the existing `toSafeErrorMeta`
   philosophy (no PII/secret) — a precursor to a real audit log.
7. **Feature flag / kill-switch** to disable destructive endpoints quickly if
   abuse is detected.
8. **Test coverage** for cross-org, role, soft-vs-hard, and idempotency (§14).
9. **Operational "no manual Production writes" rule** documented and agreed
   (the single highest-leverage control — most real risk is manual/privileged
   DB access).

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
- **Role gating for contact deletion** (once added) — employee rejected,
  owner/admin allowed (DP-5).
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

To be performed by Liran — **read-only**, no changes. These items **cannot** be
verified from the repository and must not be assumed from a code scan:

- [ ] Confirm Supabase backup tier (daily backups? retention length?).
- [ ] Confirm PITR availability + window on the current plan.
- [ ] Confirm **database size** and the realistic restore mechanism/time.
- [ ] Record who has Supabase project + DB access (least privilege).
- [ ] Verify whether any **Supabase Cron job** exists (e.g., `cron.job`).
- [ ] Verify whether any **Database Function / Edge Function / Webhook** exists
      that could modify or delete data.
- [ ] Verify whether any **database trigger** beyond the documented ones
      (`set_updated_at`, task-assignment notify) exists.
- [ ] Verify whether any **Dashboard-created job / scheduled task** exists.
- [ ] Confirm there is **no service-role key** configured in the deployed
      environment (Vercel) — it must remain absent (repo does not use one, but
      deployment is unverified).
- [ ] Names-only env check (carried from Stage 4): `RESEND_API_KEY`,
      `MAIL_FROM` presence in Production/Preview (values not needed).
- [ ] Verify the UI shows a confirmation before the contact hard-delete.
- [ ] Adopt and document the **"no manual Production writes / deletes"** rule.
- [ ] Schedule a **restore test** once PITR/backup is confirmed (no restore
      guarantee until it passes).

## 16. Open decisions

1. **Contact deletion authorization** — add owner/admin role gating now
   (recommended), and/or soft-delete? (DP-5)
2. **Backup/PITR tier** — is PITR enabled? What RPO/RTO can we *ratify* once
   verified? (DP-2/§9)
3. **Org deletion** — do we ever want an in-app org-deletion flow, and if so,
   soft-delete-first + owner + strong confirm? (DP-1)
4. **Audit log** — build the append-only audit table now or later? (DP-6)
5. **Expired invitations** — leave indefinitely, or define a separate retention
   policy for the email field (status change, not row delete)? (DP-10)
6. **Export-before-delete** — required before any future deletion feature? (DP-8)
7. **Cascade hardening** — convert selected `CASCADE` to `RESTRICT`? (risk vs.
   operational friction).
8. **Legal/privacy retention** — obtain legal/privacy review before publishing
   any permanent-retention promise to customers (§2).

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
