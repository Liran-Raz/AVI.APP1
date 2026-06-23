# Production Migration Apply Record — `0014_resolve_my_role_permissions_rpc`

> **COMPLETED APPLY RECORD — UNCOMMITTED. AWAITING FINAL APPROVAL TO COMMIT.**
> Completed from the operator's verified Production evidence plus operator-
> confirmed apply metadata (operator and execution timestamp). Committing this
> record is a separate post-apply gate. Migration `0014` itself was applied and
> verified; this file changes no database, code, or configuration.

---

## A. Reference identity (verified at preview — repository facts, NOT Production results)

| Field | Value |
|---|---|
| Migration repository path | `supabase/migrations/0014_resolve_my_role_permissions_rpc.sql` |
| Migration Git blob (SHA-1) | `7bdae0ecbdcbb200d72fb907bf349d11a2041e72` |
| Migration SHA-256 (committed LF) | `2bbb64f994d74c40311eb9c925167ec4d5fe88a72ae6ba438d49a9e43c479426` |
| Bytes / lines | `7554 / 156` |
| Main Git SHA at preview | `1eaaefc7b151afc1d8199798230edaadda788065` |

## B. Apply identity (re-confirmed against A)

| Field | Value |
|---|---|
| Production environment identifier | `Supabase Production / AVI.APP1` |
| Main Git SHA at apply | `1eaaefc7b151afc1d8199798230edaadda788065` (repo HEAD; the applied file's blob matches this tree) |
| Migration repository path (re-confirm == A) | `supabase/migrations/0014_resolve_my_role_permissions_rpc.sql` — **confirmed == A** |
| Migration Git blob (re-confirm == A) | `7bdae0ecbdcbb200d72fb907bf349d11a2041e72` — **confirmed == A** |
| Migration SHA-256 (re-confirm == A) | `2bbb64f994d74c40311eb9c925167ec4d5fe88a72ae6ba438d49a9e43c479426` — **confirmed == A** |
| Operator | LIRAN |
| Execution date & time (include timezone) | 2026-06-23 22:39 Asia/Jerusalem (UTC+03:00) |

## C. Stage 1 — Migration-history preflight results

| Field | Value |
|---|---|
| `schema_migrations` exists? | **no** (`history_table_exists = false`) |
| Row count | n/a (relation absent) |
| Full version list (if any rows) | n/a (relation absent) |
| Interpretation & decision | Relation **absent** → consistent with the repository's documented **manual-apply model** (no migration-tracking table). **Proceeded.** |

## D. Stage 2 — Security / data-integrity preflight results

All **14** checks returned `pass=true` (gating `sec_*` / `data_*`; `warn_*` recorded).

| Check | pass | detail |
|---|---|---|
| sec_rpc_absent | true | 0 |
| sec_both_tables_exist | true | 2 |
| sec_rls_enabled_both | true | 2/2 |
| sec_zero_policies | true | 0 |
| sec_no_unexpected_table_acl | true | 0 (catalog ACL via `pg_class.relacl`) |
| sec_eff_sel_authn_roles_false | true | — |
| sec_eff_sel_authn_perms_false | true | — |
| sec_eff_sel_anon_roles_false | true | — |
| sec_eff_sel_anon_perms_false | true | — |
| sec_current_user_postgres | true | postgres |
| data_active_unmapped_zero | true | 0 |
| data_active_mapping_ok | true | 0 |
| warn_inactive_null_role_id | true | 0 |
| warn_inactive_mapping | true | 0 |
| Informational snapshot (I1/I2 counts, role distribution) | n/a | not separately captured in the provided evidence (non-gating) |
| **Decision** | **proceed** | all gating checks passed |

## E. Stage 4 — Apply result

| Field | Value |
|---|---|
| Artifact executed | `supabase/migrations/0014_resolve_my_role_permissions_rpc.sql` (exact committed file; blob `7bdae0ec…`, SHA-256 `2bbb64f9…`) |
| Executed at (timezone) | 2026-06-23 22:39 Asia/Jerusalem (UTC+03:00) |
| Supabase result | `Success. No rows returned` |
| Run-once confirmed | **yes** (executed exactly once) |
| Initial catalog verification | exactly **one** function; identity `resolve_my_role_permissions(uuid)`; owner `postgres`; `prosecdef=true`; `provolatile=s`; result = expected four-column `TABLE(role_key text, is_system boolean, permission_key text, record_scope text)` |

## F. Stage 5 — Postflight results

| Field | Value |
|---|---|
| `ALL_CHECKS_PASSED` | **true** (16/16) |
| Failing checks | **none** |
| Observed exact-function OID | `19030` |
| No-DML by construction confirmed | **yes** — statement inventory: `begin · do · do · create function · comment · revoke · revoke · grant · notify · commit`; no INSERT/UPDATE/DELETE/MERGE/TRUNCATE/COPY; every `revoke`/`grant` targets the function |
| Counts (informational only) | not separately captured; concurrent application writes acceptable (counts are not a proof) |

All 16 postflight checks `pass=true`:
`anon_execute_false`, `args_exact_p_org_id_uuid`, `authenticated_execute_true`,
`both_tables_exist`, `effective_table_select_false`, `exact_uuid_signature_present`,
`named_count_is_1`, `no_unexpected_table_acl`, `owner_is_postgres`,
`policy_count_zero`, `public_execute_absent`, `return_type_exact`,
`rls_enabled_both`, `search_path_pinned_empty`, `security_definer`,
`volatility_stable`.

## G. Stage 6 — Migration-history confirmation

| Field | Value |
|---|---|
| `schema_migrations` state | **remains absent** (Stage 1a = false at preflight; `0014` performs no migration-metadata write per the statement inventory, so it cannot have created or populated it) |
| Written to `schema_migrations`? | **NO** — manual-apply model (consistent with `0011`–`0013`) |

## H. Rollback status

| Field | Value |
|---|---|
| Rollback performed? | **no** |
| `fn_count` after rollback | n/a |
| Reason | apply fully verified; rollback **not required**. Remains available (idempotent function drop) while `0014` stays non-authoritative. |

## I. Anomalies

**None.** 14/14 preflight and 16/16 postflight checks returned `pass=true`;
exactly one function (OID `19030`); owner `postgres`; underlying tables remained
closed with RLS on and zero policies.

## J. Final decision

**ACCEPTED & RETAINED** — Migration `0014` applied once and fully verified in
Supabase Production / AVI.APP1 on 2026-06-23 22:39 Asia/Jerusalem (UTC+03:00)
by operator LIRAN. Approval recorded by operator LIRAN after independent ChatGPT
review. This apply-record file is **uncommitted and AWAITING FINAL APPROVAL TO
COMMIT**.

## K. Post-apply posture & scope (boundary)

- **Additive & non-authoritative.** `0014` adds one `SECURITY DEFINER` read RPC
  (`resolve_my_role_permissions(uuid)`, OID `19030`) and nothing else — no DML,
  no table-privilege/RLS change.
- **Authority unchanged.** Legacy `organization_memberships.role` (`user_role`
  enum) and the static in-code `ROLE_GRANTS` map **remain authoritative**. The
  `roles` / `role_permissions` tables and the new RPC are **non-authoritative**
  input only.
- **Shadow Mode remains OFF** (`DB_ROLE_RESOLVER_SHADOW` absent/disabled) —
  unchanged by this gate.
- **Not done (no change this gate; separately gated future work):** resolver
  wiring to the RPC, `database.types` regeneration, authoritative cutover (8J),
  management API, UI, `audit_events`, RLS policies.
- **Migration history** remains absent; the project stays on the documented
  manual-apply model.
- **Authorization behavior unchanged**; no application code, env var, grant, or
  policy was modified.
