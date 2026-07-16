-- 0027_invoicing_foundation.sql
-- DEV-026 R1 — invoicing foundation: ledgers (בתי-עסק), tax documents (305/320/330/400),
-- lines, payments, gap-free per-ledger counters, customer consents, VAT rate table,
-- post-issue immutability, and the issue/cancel/credit SECURITY DEFINER RPCs.
-- 2026-07-16
--
-- ADDITIVE + RE-RUNNABLE (0024 style: create if not exists / create or replace /
-- drop policy if exists / on conflict do nothing). Re-running is a safe no-op.
-- Operator-applied (role postgres, Supabase SQL Editor), single transaction.
--
-- SECURITY MODEL (hybrid — decided in the DEV-026 plan):
--   * DRAFTS have no legal weight -> clients get ordinary org-scoped RLS CRUD on
--     documents/lines/payments WHILE status='draft' (WITH CHECK pins status).
--   * ISSUE / CANCEL / CREDIT are legal state transitions -> SECURITY DEFINER RPCs
--     owned by postgres are the ONLY path (0024/0016 posture: the anon key ships to
--     the browser, so RLS+grants — not the Next.js service — are the trust boundary).
--   * POST-ISSUE IMMUTABILITY is enforced IN the DB by BEFORE UPDATE/DELETE triggers
--     that reject any non-postgres write to a non-draft document (belt), while the
--     RPCs run as postgres and pass (suspenders = they validate membership/authz).
--   * document_counters is fail-closed exactly like 0020 task_counters (RLS on, ZERO
--     policies, all client grants revoked): gap-free legal numbering, written only by
--     issue_document(). NOTE 0003's ALTER DEFAULT PRIVILEGES would otherwise grant
--     authenticated full DML on every new table — each fail-closed table below
--     explicitly revokes exactly that.
--   * org integrity: composite FKs pin denormalized org_id end-to-end
--     (documents->ledgers, lines/payments->documents, ledgers/consents->clients),
--     mirroring 0011/0024. clients gains unique(id, org_id) to enable the pinning.
--   * vat_rates is global statutory reference data: readable by all authenticated,
--     writable by nobody (operator migrations only).
--
-- WHAT THE APP DOES IN R1: only the ledgers vertical (business-profile settings) +
-- dormant permission keys + hidden nav. Documents UI arrives in R2 — the full DB
-- layer lands here so R2 is code-only (same play as 0024 for chat R2-R4).

-- ============================================================
-- PREFLIGHT (run FIRST, read-only — confirm the starting state):
-- ============================================================
-- select
--   to_regclass('public.ledgers')            as ledgers_should_be_null,
--   to_regclass('public.documents')          as documents_should_be_null,
--   to_regclass('public.document_counters')  as counters_should_be_null,
--   to_regclass('public.vat_rates')          as vat_rates_should_be_null,
--   (select count(*) from public.organizations) as orgs_expect_self_ledgers_after;

begin;

-- Guard: enforce the apply role so new objects are owned by postgres.
do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Migration 0027 must be applied as role postgres (current_user = %). Select Role: postgres in the SQL Editor.',
      current_user;
  end if;
end $$;

-- ============================================================
-- 1. Enums
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'invoice_doc_type') then
    -- Labels ARE the official Tax Authority document-type codes (מבנה אחיד נספח 1).
    create type public.invoice_doc_type as enum ('305', '320', '330', '400');
  end if;
  if not exists (select 1 from pg_type where typname = 'invoice_doc_status') then
    create type public.invoice_doc_status as enum ('draft', 'issued', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'allocation_status') then
    -- חשבוניות ישראל allocation-number lifecycle (R5 wires the API; states exist now).
    create type public.allocation_status as enum
      ('not_required', 'pending', 'obtained', 'failed', 'exempt');
  end if;
end $$;

-- ============================================================
-- 2. clients: enable composite org-pinning from child tables (id is already PK,
--    so this unique is trivially satisfiable — it exists purely to be an FK target).
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_id_org_uq') then
    alter table public.clients add constraint clients_id_org_uq unique (id, org_id);
  end if;
end $$;

-- ============================================================
-- 3. ledgers — בית-עסק (ledger-first: the office's own business is the first row;
--    Stage B adds client-owned ledgers via client_id with ZERO re-parenting).
-- ============================================================
create table if not exists public.ledgers (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  client_id            uuid,                          -- NULL = the office itself (Stage A)
  is_self              boolean not null default false,
  legal_name           text not null,                 -- שם העוסק/החברה כרשום (prints + A000/INI 1018)
  trade_name           text,
  business_id          text,                          -- עוסק מורשה / ח.פ — 9 digits; REQUIRED to issue
  business_type        public.business_type,          -- reuses the 0001 enum
  address_street       text,                          -- INI 1019 (house no. folded in)
  address_city         text,                          -- INI 1021
  address_zip          text,                          -- INI 1022
  phone                text,
  email                text,
  logo_url             text,                          -- PDF letterhead (subsumes DEV-012)
  bookkeeping_managed  boolean not null default false, -- INI 1013 (false -> 0 "לא רלוונטי")
  currency             text not null default 'ILS',   -- INI 1032 מטבע מוביל
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ledgers_id_org_uq unique (id, org_id),
  constraint ledgers_business_id_format
    check (business_id is null or business_id ~ '^[0-9]{9}$'),
  constraint ledgers_legal_name_len
    check (length(btrim(legal_name)) between 1 and 100),
  constraint ledgers_client_org_fk
    foreign key (client_id, org_id) references public.clients(id, org_id) on delete restrict,
  constraint ledgers_self_shape
    check ((is_self and client_id is null) or (not is_self and client_id is not null))
);

comment on table public.ledgers is
  'בתי-עסק (DEV-026, ledger-first). Stage A: one self-ledger per org (the office itself, client_id NULL). Stage B: per-client ledgers. Business/tax identity that prints on documents lives HERE, not on organizations.';

-- Exactly one self-ledger per org; at most one ledger per client.
create unique index if not exists ledgers_org_self_uq
  on public.ledgers(org_id) where is_self;
create unique index if not exists ledgers_org_client_uq
  on public.ledgers(org_id, client_id) where client_id is not null;
create index if not exists ledgers_org_idx on public.ledgers(org_id);

-- ============================================================
-- 4. documents — tax documents. Drafts are mutable; issue freezes EVERYTHING
--    (numbers, snapshots, totals). All money = integer agorot.
-- ============================================================
create table if not exists public.documents (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  ledger_id                uuid not null,
  doc_type                 public.invoice_doc_type not null,
  status                   public.invoice_doc_status not null default 'draft',
  number                   integer,                   -- NULL while draft; gap-free per (ledger, type)
  doc_date                 date not null default current_date,   -- C100 1230 (printed date)
  value_date               date,                       -- C100 1216
  issued_at                timestamptz,                -- C100 1205/1206 (system, immutable)
  issued_by                uuid references public.profiles(id) on delete set null,
  -- buyer (client) linkage + SNAPSHOT (frozen at issue; snapshot is authoritative):
  client_id                uuid,
  buyer_name               text,                       -- C100 1207 (required to issue)
  buyer_tax_id             text,                       -- C100 1215
  buyer_address            text,                       -- C100 1208 (single line)
  buyer_email              text,
  buyer_phone              text,                       -- C100 1214
  -- seller SNAPSHOT (frozen at issue from the ledger):
  seller_legal_name        text,
  seller_business_id       text,
  seller_address_street    text,
  seller_address_city      text,
  seller_address_zip       text,
  -- amounts (agorot; magnitudes positive — doc_type 330 carries the sign at export):
  amount_before_discount   bigint not null default 0,  -- C100 1219
  discount_amount          bigint not null default 0,  -- C100 1220 (doc-level)
  net_amount               bigint not null default 0,  -- C100 1221
  vat_rate_bp              integer,                    -- basis points (1800 = 18%); set at issue
  vat_amount               bigint not null default 0,  -- C100 1222
  total_amount             bigint not null default 0,  -- C100 1223
  withholding_amount       bigint not null default 0,  -- C100 1224 (receipts; sign + at export)
  currency                 text not null default 'ILS',
  -- חשבוניות ישראל (R5 wires the API; schema ready now):
  allocation_status        public.allocation_status not null default 'not_required',
  allocation_number        text,
  allocation_requested_at  timestamptz,
  allocation_error         text,
  -- corrective lifecycle:
  base_document_id         uuid,                       -- 330 -> the credited document
  cancelled_at             timestamptz,
  cancelled_by             uuid references public.profiles(id) on delete set null,
  cancel_reason            text,
  delivered_at             timestamptz,                -- first מקור delivery; gates cancel-vs-credit
  -- artifacts (R3):
  pdf_path                 text,
  pdf_sha256               text,
  signed_pdf_path          text,
  notes                    text,
  created_by               uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint documents_id_org_uq unique (id, org_id),
  constraint documents_ledger_org_fk
    foreign key (ledger_id, org_id) references public.ledgers(id, org_id) on delete cascade,
  constraint documents_client_org_fk
    foreign key (client_id, org_id) references public.clients(id, org_id) on delete restrict,
  constraint documents_base_org_fk
    foreign key (base_document_id, org_id) references public.documents(id, org_id) on delete restrict,
  constraint documents_number_when_final check (status = 'draft' or number is not null),
  constraint documents_amounts_nonneg check (
    amount_before_discount >= 0 and discount_amount >= 0 and net_amount >= 0
    and vat_amount >= 0 and total_amount >= 0 and withholding_amount >= 0
  ),
  constraint documents_number_positive check (number is null or number >= 1)
);

comment on table public.documents is
  'Tax documents (DEV-026). doc_type labels = official מבנה אחיד codes (305 חשבונית מס, 320 חשבונית מס-קבלה, 330 חשבונית זיכוי, 400 קבלה). Draft -> issue_document() RPC assigns the gap-free number + freezes snapshots/totals; post-issue rows are DB-immutable (trigger); cancel/credit via RPCs only.';

create unique index if not exists documents_ledger_type_number_uq
  on public.documents(ledger_id, doc_type, number) where number is not null;
create index if not exists documents_org_ledger_idx
  on public.documents(org_id, ledger_id, doc_type, doc_date desc);
create index if not exists documents_org_status_idx
  on public.documents(org_id, status);
create index if not exists documents_client_idx
  on public.documents(client_id) where client_id is not null;

-- ============================================================
-- 5. document_lines (D110) + document_payments (D120)
-- ============================================================
create table if not exists public.document_lines (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  document_id        uuid not null,
  line_no            integer not null,                -- D110 1255
  description        text not null,                   -- D110 1260
  catalog_id         text,                            -- D110 1259 (מק"ט)
  unit               text,                            -- D110 1263 ("יחידה" if blank)
  quantity           numeric(18,4) not null default 1,-- D110 1264
  unit_price         bigint not null default 0,       -- agorot, ex-VAT (D110 1265)
  line_discount      bigint not null default 0,       -- agorot (D110 1266; sign − at export)
  line_total         bigint not null default 0,       -- agorot (D110 1267; server-computed at issue)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint document_lines_doc_org_fk
    foreign key (document_id, org_id) references public.documents(id, org_id) on delete cascade,
  constraint document_lines_uq unique (document_id, line_no),
  constraint document_lines_nonneg
    check (quantity >= 0 and unit_price >= 0 and line_discount >= 0 and line_total >= 0)
);

create index if not exists document_lines_doc_idx on public.document_lines(document_id);

create table if not exists public.document_payments (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  document_id        uuid not null,
  line_no            integer not null,                -- D120 1305
  method             smallint not null,               -- D120 1306: 1 מזומן..9 אחר
  amount             bigint not null default 0,       -- agorot (D120 1312)
  due_date           date,                            -- D120 1311 (cheque/card)
  bank_no            text,                            -- D120 1307 (cheque)
  branch_no          text,                            -- D120 1308
  account_no         text,                            -- D120 1309
  cheque_no          text,                            -- D120 1310
  card_company       smallint,                        -- D120 1313
  card_tx_type       smallint,                        -- D120 1315
  reference          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint document_payments_doc_org_fk
    foreign key (document_id, org_id) references public.documents(id, org_id) on delete cascade,
  constraint document_payments_uq unique (document_id, line_no),
  constraint document_payments_method_range check (method between 1 and 9),
  constraint document_payments_amount_nonneg check (amount >= 0)
);

create index if not exists document_payments_doc_idx on public.document_payments(document_id);

-- ============================================================
-- 6. document_counters — gap-free legal numbering (EXACT 0020 posture:
--    RLS on, ZERO policies, every client grant revoked; written only by
--    issue_document(), which runs as the postgres owner and bypasses RLS).
-- ============================================================
create table if not exists public.document_counters (
  ledger_id    uuid not null references public.ledgers(id) on delete cascade,
  doc_type     public.invoice_doc_type not null,
  last_number  integer not null default 0,
  primary key (ledger_id, doc_type)
);

alter table public.document_counters enable row level security;
-- (no policies on purpose: unreachable by anon/authenticated/service_role)
revoke all on table public.document_counters from public, anon, authenticated, service_role;

comment on table public.document_counters is
  'Per (ledger, doc_type) high-water mark for legal sequential numbering (DEV-026). Written only by issue_document() / set_document_counter_start(). Fail-closed: RLS on, zero policies, all client grants revoked.';

-- ============================================================
-- 7. customer_consents — מסמכים ממוחשבים consent records (part of the books).
--    Readable by org members; WRITES fail-closed until the R6 consent RPCs.
-- ============================================================
create table if not exists public.customer_consents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  ledger_id        uuid not null,
  client_id        uuid not null,
  consent_given    boolean not null default false,
  consent_at       timestamptz,
  consent_method   text,                              -- 'i_agree' | 'email' | 'written' ...
  consent_evidence jsonb,                             -- who/when/IP/wording — audit trail
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint customer_consents_ledger_org_fk
    foreign key (ledger_id, org_id) references public.ledgers(id, org_id) on delete cascade,
  constraint customer_consents_client_org_fk
    foreign key (client_id, org_id) references public.clients(id, org_id) on delete cascade,
  constraint customer_consents_uq unique (ledger_id, client_id)
);

alter table public.customer_consents enable row level security;
revoke all on table public.customer_consents from public, anon, authenticated, service_role;
grant select on public.customer_consents to authenticated;

drop policy if exists "members read consents in own org" on public.customer_consents;
create policy "members read consents in own org"
  on public.customer_consents for select to authenticated
  using (org_id = public.user_org_id());

comment on table public.customer_consents is
  'הסכמות לקוחות לקבלת מסמכים ממוחשבים (חוזר 24/2004 — kept as part of the books). SELECT-only for clients; writes arrive with the R6 consent RPCs.';

-- ============================================================
-- 8. vat_rates — statutory VAT reference (effective-dated, global, read-only).
-- ============================================================
create table if not exists public.vat_rates (
  rate_bp        integer not null,                    -- basis points: 1700 = 17%
  effective_from date not null primary key,
  effective_to   date                                 -- NULL = open-ended
);

alter table public.vat_rates enable row level security;
revoke all on table public.vat_rates from public, anon, authenticated, service_role;
grant select on public.vat_rates to authenticated;

drop policy if exists "authenticated read vat rates" on public.vat_rates;
create policy "authenticated read vat rates"
  on public.vat_rates for select to authenticated
  using (true);

insert into public.vat_rates (rate_bp, effective_from, effective_to) values
  (1700, date '2015-10-01', date '2024-12-31'),
  (1800, date '2025-01-01', null)
on conflict (effective_from) do nothing;

comment on table public.vat_rates is
  'Statutory VAT rates, effective-dated (17% until 2024-12-31, 18% from 2025-01-01). Global read-only reference; maintained by operator migrations only.';

-- ============================================================
-- 9. updated_at bumps (0002 helper)
-- ============================================================
drop trigger if exists ledgers_set_updated_at on public.ledgers;
create trigger ledgers_set_updated_at
  before update on public.ledgers
  for each row execute function public.set_updated_at();

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

drop trigger if exists document_lines_set_updated_at on public.document_lines;
create trigger document_lines_set_updated_at
  before update on public.document_lines
  for each row execute function public.set_updated_at();

drop trigger if exists document_payments_set_updated_at on public.document_payments;
create trigger document_payments_set_updated_at
  before update on public.document_payments
  for each row execute function public.set_updated_at();

-- ============================================================
-- 10. POST-ISSUE IMMUTABILITY — DB-enforced (the belt). postgres (the RPC/definer
--     path and the operator) passes; every client-role write to a non-draft row
--     is rejected. NOT security definer: we WANT the caller's identity.
-- ============================================================
create or replace function public.enforce_document_immutability()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'postgres' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'issued/cancelled documents cannot be deleted (use cancel_document / create_credit_note)';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status <> 'draft' then
    raise exception 'issued/cancelled documents are immutable (use the document RPCs)';
  end if;
  if new.status is distinct from old.status then
    raise exception 'document status changes only via issue_document / cancel_document';
  end if;
  if new.number is distinct from old.number then
    raise exception 'document numbers are system-assigned (issue_document)';
  end if;
  return new;
end $$;

drop trigger if exists documents_enforce_immutability on public.documents;
create trigger documents_enforce_immutability
  before update or delete on public.documents
  for each row execute function public.enforce_document_immutability();

-- Children: any write requires the parent to still be a draft (unless postgres).
create or replace function public.enforce_document_child_immutability()
returns trigger
language plpgsql
as $$
declare
  v_doc uuid;
  v_status public.invoice_doc_status;
begin
  if current_user = 'postgres' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_doc := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  select status into v_status from public.documents where id = v_doc;
  if v_status is null then
    raise exception 'parent document not found';
  end if;
  if v_status <> 'draft' then
    raise exception 'lines/payments of an issued document are immutable';
  end if;
  -- moving a child to a different document is forbidden
  if tg_op = 'UPDATE' and new.document_id is distinct from old.document_id then
    raise exception 'cannot move a line/payment between documents';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists document_lines_enforce_immutability on public.document_lines;
create trigger document_lines_enforce_immutability
  before insert or update or delete on public.document_lines
  for each row execute function public.enforce_document_child_immutability();

drop trigger if exists document_payments_enforce_immutability on public.document_payments;
create trigger document_payments_enforce_immutability
  before insert or update or delete on public.document_payments
  for each row execute function public.enforce_document_child_immutability();

-- ============================================================
-- 11. RLS + grants — ledgers (SELECT all members / UPDATE admin+owner belt;
--     INSERT/DELETE revoked — self-ledger is seeded here, Stage B adds an RPC),
--     documents/lines/payments (org-scoped CRUD; WITH CHECK pins drafts).
-- ============================================================
alter table public.ledgers           enable row level security;
alter table public.documents         enable row level security;
alter table public.document_lines    enable row level security;
alter table public.document_payments enable row level security;

revoke all on public.ledgers from public, anon, authenticated, service_role;
grant select, update on public.ledgers to authenticated;

drop policy if exists "members read ledgers in own org" on public.ledgers;
create policy "members read ledgers in own org"
  on public.ledgers for select to authenticated
  using (org_id = public.user_org_id());

drop policy if exists "admins update ledgers in own org" on public.ledgers;
create policy "admins update ledgers in own org"
  on public.ledgers for update to authenticated
  using (org_id = public.user_org_id() and public.is_admin_or_owner())
  with check (org_id = public.user_org_id());

-- documents: draft-scoped client writes. (0003 default privileges already granted
-- CRUD to authenticated; we keep that and gate by policy + immutability triggers.)
drop policy if exists "members read documents in own org" on public.documents;
create policy "members read documents in own org"
  on public.documents for select to authenticated
  using (org_id = public.user_org_id());

drop policy if exists "members create drafts in own org" on public.documents;
create policy "members create drafts in own org"
  on public.documents for insert to authenticated
  with check (
    org_id = public.user_org_id()
    and status = 'draft'
    and number is null
  );

drop policy if exists "members update drafts in own org" on public.documents;
create policy "members update drafts in own org"
  on public.documents for update to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id() and status = 'draft');

drop policy if exists "members delete drafts in own org" on public.documents;
create policy "members delete drafts in own org"
  on public.documents for delete to authenticated
  using (org_id = public.user_org_id() and status = 'draft');

-- lines/payments: writes only while the parent is a draft in my org.
drop policy if exists "members read lines in own org" on public.document_lines;
create policy "members read lines in own org"
  on public.document_lines for select to authenticated
  using (org_id = public.user_org_id());

drop policy if exists "members write lines of own drafts" on public.document_lines;
create policy "members write lines of own drafts"
  on public.document_lines for all to authenticated
  using (
    org_id = public.user_org_id()
    and exists (select 1 from public.documents d
                where d.id = document_id and d.org_id = public.user_org_id()
                  and d.status = 'draft')
  )
  with check (
    org_id = public.user_org_id()
    and exists (select 1 from public.documents d
                where d.id = document_id and d.org_id = public.user_org_id()
                  and d.status = 'draft')
  );

drop policy if exists "members read payments in own org" on public.document_payments;
create policy "members read payments in own org"
  on public.document_payments for select to authenticated
  using (org_id = public.user_org_id());

drop policy if exists "members write payments of own drafts" on public.document_payments;
create policy "members write payments of own drafts"
  on public.document_payments for all to authenticated
  using (
    org_id = public.user_org_id()
    and exists (select 1 from public.documents d
                where d.id = document_id and d.org_id = public.user_org_id()
                  and d.status = 'draft')
  )
  with check (
    org_id = public.user_org_id()
    and exists (select 1 from public.documents d
                where d.id = document_id and d.org_id = public.user_org_id()
                  and d.status = 'draft')
  );

-- ============================================================
-- 12. RPCs — the ONLY legal-transition path. All SECURITY DEFINER owned by
--     postgres, all validate active org membership via user_is_active_member_of
--     (0009) + an IN-DB ROLE BELT matching the TS grants (owner/admin only for
--     legal transitions — an employee calling the RPC directly via PostgREST is
--     rejected here, not just in the service layer). search_path pinned.
-- ============================================================

-- Internal role guard (not granted to any client role; called by the RPCs).
create or replace function public._require_doc_operator_role(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.org_id = p_org_id
      and m.is_active and m.role in ('owner', 'admin')
  ) then
    raise exception 'issuing/cancelling/crediting documents requires an owner or manager role';
  end if;
end $$;

revoke all on function public._require_doc_operator_role(uuid) from public, anon, authenticated, service_role;

-- 12a. issue_document — the heart: freeze + number + totals, atomically.
create or replace function public.issue_document(p_document_id uuid)
returns table (number integer, issued_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_doc    public.documents%rowtype;
  v_ledger public.ledgers%rowtype;
  v_client public.clients%rowtype;
  v_lines_total   bigint;
  v_payments_total bigint;
  v_line_count    integer;
  v_payment_count integer;
  v_net    bigint;
  v_vat_bp integer;
  v_vat    bigint;
  v_total  bigint;
  v_number integer;
begin
  -- Lock the draft.
  select * into v_doc from public.documents where id = p_document_id for update;
  if not found then raise exception 'document not found'; end if;
  if v_doc.status <> 'draft' then raise exception 'only drafts can be issued'; end if;
  if not public.user_is_active_member_of(v_doc.org_id) then
    raise exception 'not an active member of this organization';
  end if;
  perform public._require_doc_operator_role(v_doc.org_id);

  -- Ledger must be issue-ready (legal identity present).
  select * into v_ledger from public.ledgers where id = v_doc.ledger_id;
  if v_ledger.business_id is null then
    raise exception 'ledger is missing business_id (עוסק/ח.פ) — complete the business profile first';
  end if;

  -- Buyer snapshot: from the linked client if present, else the draft's manual fields.
  if v_doc.client_id is not null then
    select * into v_client from public.clients
      where id = v_doc.client_id and org_id = v_doc.org_id;
    if not found then raise exception 'client not found in this organization'; end if;
    v_doc.buyer_name    := coalesce(nullif(btrim(v_client.name), ''), v_doc.buyer_name);
    v_doc.buyer_tax_id  := coalesce(nullif(btrim(coalesce(v_client.tax_id, '')), ''), v_doc.buyer_tax_id);
    v_doc.buyer_address := coalesce(nullif(btrim(coalesce(v_client.address, '')), ''), v_doc.buyer_address);
    v_doc.buyer_email   := coalesce(nullif(btrim(coalesce(v_client.email, '')), ''), v_doc.buyer_email);
    v_doc.buyer_phone   := coalesce(nullif(btrim(coalesce(v_client.phone, '')), ''), v_doc.buyer_phone);
  end if;
  if v_doc.buyer_name is null or length(btrim(v_doc.buyer_name)) = 0 then
    raise exception 'buyer name is required (C100 field 1207)';
  end if;

  -- Server-authoritative line math (never trust client-computed totals).
  select count(*),
         coalesce(sum(round(l.quantity * l.unit_price)::bigint - l.line_discount), 0)
    into v_line_count, v_lines_total
    from public.document_lines l
    where l.document_id = v_doc.id;

  -- Persist each line_total the same way (belt: rejected later if negative).
  update public.document_lines l
     set line_total = round(l.quantity * l.unit_price)::bigint - l.line_discount
   where l.document_id = v_doc.id;

  if exists (select 1 from public.document_lines l
             where l.document_id = v_doc.id
               and round(l.quantity * l.unit_price)::bigint - l.line_discount < 0) then
    raise exception 'line total cannot be negative';
  end if;

  select count(*), coalesce(sum(amount), 0)
    into v_payment_count, v_payments_total
    from public.document_payments
    where document_id = v_doc.id;

  -- Type-specific validation + totals.
  if v_doc.doc_type in ('305', '320', '330') then
    if v_line_count = 0 then raise exception 'at least one line is required'; end if;

    v_net := v_lines_total - v_doc.discount_amount;
    if v_net < 0 then raise exception 'document discount exceeds the lines total'; end if;

    select rate_bp into v_vat_bp from public.vat_rates
      where v_doc.doc_date >= effective_from
        and (effective_to is null or v_doc.doc_date <= effective_to)
      order by effective_from desc limit 1;
    if v_vat_bp is null then
      raise exception 'no VAT rate defined for doc_date %', v_doc.doc_date;
    end if;

    -- עוסק פטור issues documents without VAT.
    if v_ledger.business_type = 'patur' then
      v_vat_bp := 0;
    end if;

    v_vat   := round(v_net * v_vat_bp / 10000.0)::bigint;
    v_total := v_net + v_vat;
  else
    -- 400 קבלה: amounts derive from the payments; no VAT on a receipt.
    if v_payment_count = 0 then raise exception 'a receipt requires at least one payment'; end if;
    v_net    := v_payments_total;
    v_vat_bp := 0;
    v_vat    := 0;
    v_total  := v_payments_total;
  end if;

  if v_doc.doc_type = '320' then
    if v_payment_count = 0 then raise exception 'חשבונית מס-קבלה requires at least one payment'; end if;
    if v_payments_total <> v_total then
      raise exception 'payments (%) must equal the document total (%) on חשבונית מס-קבלה',
        v_payments_total, v_total;
    end if;
  end if;

  -- 330 must reference an issued 305/320 of the SAME ledger when linked.
  if v_doc.doc_type = '330' and v_doc.base_document_id is not null then
    if not exists (
      select 1 from public.documents b
      where b.id = v_doc.base_document_id
        and b.ledger_id = v_doc.ledger_id
        and b.status = 'issued'
        and b.doc_type in ('305', '320')
    ) then
      raise exception 'credit note must reference an issued 305/320 of the same ledger';
    end if;
  end if;

  -- Gap-free number (0020 idiom: row-locked upsert on the counter).
  insert into public.document_counters as dc (ledger_id, doc_type, last_number)
  values (v_doc.ledger_id, v_doc.doc_type, 1)
  on conflict (ledger_id, doc_type) do update set last_number = dc.last_number + 1
  returning dc.last_number into v_number;

  update public.documents d
     set status                 = 'issued',
         number                 = v_number,
         issued_at              = now(),
         issued_by              = v_uid,
         buyer_name             = v_doc.buyer_name,
         buyer_tax_id           = v_doc.buyer_tax_id,
         buyer_address          = v_doc.buyer_address,
         buyer_email            = v_doc.buyer_email,
         buyer_phone            = v_doc.buyer_phone,
         seller_legal_name      = v_ledger.legal_name,
         seller_business_id     = v_ledger.business_id,
         seller_address_street  = v_ledger.address_street,
         seller_address_city    = v_ledger.address_city,
         seller_address_zip     = v_ledger.address_zip,
         amount_before_discount = v_lines_total,
         net_amount             = v_net,
         vat_rate_bp            = v_vat_bp,
         vat_amount             = v_vat,
         total_amount           = v_total,
         allocation_status      = 'not_required'   -- R5 replaces with threshold logic
   where d.id = v_doc.id;

  return query select v_number, now();
end $$;

-- 12b. cancel_document — pre-delivery only; the number is retained (C100 flag 1228).
create or replace function public.cancel_document(p_document_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc public.documents%rowtype;
begin
  select * into v_doc from public.documents where id = p_document_id for update;
  if not found then raise exception 'document not found'; end if;
  if not public.user_is_active_member_of(v_doc.org_id) then
    raise exception 'not an active member of this organization';
  end if;
  perform public._require_doc_operator_role(v_doc.org_id);
  if v_doc.status <> 'issued' then raise exception 'only issued documents can be cancelled'; end if;
  if v_doc.delivered_at is not null then
    raise exception 'document was already delivered — issue a credit note (330) instead';
  end if;

  update public.documents
     set status        = 'cancelled',
         cancelled_at  = now(),
         cancelled_by  = v_uid,
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_document_id;
end $$;

-- 12c. create_credit_note — returns a NEW DRAFT 330 mirroring the base document
--      (user reviews, may adjust, then issues it like any draft).
create or replace function public.create_credit_note(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_base public.documents%rowtype;
  v_new  uuid;
begin
  select * into v_base from public.documents where id = p_document_id;
  if not found then raise exception 'document not found'; end if;
  if not public.user_is_active_member_of(v_base.org_id) then
    raise exception 'not an active member of this organization';
  end if;
  perform public._require_doc_operator_role(v_base.org_id);
  if v_base.status <> 'issued' or v_base.doc_type not in ('305', '320') then
    raise exception 'credit notes are created from issued 305/320 documents';
  end if;

  insert into public.documents
    (org_id, ledger_id, doc_type, status, doc_date, client_id,
     buyer_name, buyer_tax_id, buyer_address, buyer_email, buyer_phone,
     discount_amount, base_document_id, notes, created_by)
  values
    (v_base.org_id, v_base.ledger_id, '330', 'draft', current_date, v_base.client_id,
     v_base.buyer_name, v_base.buyer_tax_id, v_base.buyer_address, v_base.buyer_email, v_base.buyer_phone,
     v_base.discount_amount, v_base.id,
     'זיכוי עבור ' || case v_base.doc_type when '305' then 'חשבונית מס' else 'חשבונית מס-קבלה' end
       || ' מס'' ' || v_base.number,
     v_uid)
  returning id into v_new;

  insert into public.document_lines
    (org_id, document_id, line_no, description, catalog_id, unit, quantity,
     unit_price, line_discount, line_total)
  select org_id, v_new, line_no, description, catalog_id, unit, quantity,
         unit_price, line_discount, line_total
    from public.document_lines
    where document_id = v_base.id;

  return v_new;
end $$;

-- 12d. mark_document_delivered — records the first מקור delivery (print/send).
--      Post-issue write => definer RPC (the immutability trigger blocks clients).
create or replace function public.mark_document_delivered(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.documents%rowtype;
begin
  select * into v_doc from public.documents where id = p_document_id for update;
  if not found then raise exception 'document not found'; end if;
  if not public.user_is_active_member_of(v_doc.org_id) then
    raise exception 'not an active member of this organization';
  end if;
  perform public._require_doc_operator_role(v_doc.org_id);
  if v_doc.status <> 'issued' then raise exception 'only issued documents can be delivered'; end if;

  update public.documents
     set delivered_at = coalesce(delivered_at, now())   -- first delivery wins
   where id = p_document_id;
end $$;

-- 12e. set_document_counter_start — continue an existing numbering series when an
--      office migrates from another software. Owner-only; only before any issue.
create or replace function public.set_document_counter_start(
  p_ledger_id uuid, p_doc_type public.invoice_doc_type, p_next_number integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger public.ledgers%rowtype;
begin
  select * into v_ledger from public.ledgers where id = p_ledger_id;
  if not found then raise exception 'ledger not found'; end if;
  if not public.user_is_active_member_of(v_ledger.org_id) then
    raise exception 'not an active member of this organization';
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = auth.uid() and m.org_id = v_ledger.org_id
      and m.is_active and m.role = 'owner'
  ) then
    raise exception 'only the owner can set numbering ranges';
  end if;
  if p_next_number < 1 then raise exception 'next number must be >= 1'; end if;
  if exists (select 1 from public.documents d
             where d.ledger_id = p_ledger_id and d.doc_type = p_doc_type
               and d.number is not null) then
    raise exception 'numbering already started for this document type — the series cannot be changed';
  end if;

  insert into public.document_counters (ledger_id, doc_type, last_number)
  values (p_ledger_id, p_doc_type, p_next_number - 1)
  on conflict (ledger_id, doc_type) do update set last_number = excluded.last_number;
end $$;

-- Grants: EXECUTE to authenticated only (they self-validate). Nothing to anon.
revoke all on function public.issue_document(uuid)                                            from public, anon;
revoke all on function public.cancel_document(uuid, text)                                     from public, anon;
revoke all on function public.create_credit_note(uuid)                                        from public, anon;
revoke all on function public.mark_document_delivered(uuid)                                   from public, anon;
revoke all on function public.set_document_counter_start(uuid, public.invoice_doc_type, integer) from public, anon;
grant execute on function public.issue_document(uuid)                                            to authenticated;
grant execute on function public.cancel_document(uuid, text)                                     to authenticated;
grant execute on function public.create_credit_note(uuid)                                        to authenticated;
grant execute on function public.mark_document_delivered(uuid)                                   to authenticated;
grant execute on function public.set_document_counter_start(uuid, public.invoice_doc_type, integer) to authenticated;

revoke all on function public.enforce_document_immutability()       from public, anon, authenticated, service_role;
revoke all on function public.enforce_document_child_immutability() from public, anon, authenticated, service_role;

-- ============================================================
-- 13. Self-ledger lifecycle — clients cannot INSERT ledgers (revoked above), so
--     new orgs get their self-ledger from an AFTER INSERT definer trigger, and
--     existing orgs are backfilled below.
-- ============================================================
create or replace function public._create_self_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ledgers (org_id, is_self, legal_name)
  select new.id, true, new.name
  where not exists (
    select 1 from public.ledgers l where l.org_id = new.id and l.is_self
  );
  return new;
end $$;

revoke all on function public._create_self_ledger() from public, anon, authenticated, service_role;

drop trigger if exists organizations_create_self_ledger on public.organizations;
create trigger organizations_create_self_ledger
  after insert on public.organizations
  for each row execute function public._create_self_ledger();

-- BACKFILL — one self-ledger per existing org (legal identity to be completed
-- by the owner in the new business-profile settings; business_id stays NULL
-- until then, which blocks issuing — by design).
insert into public.ledgers (org_id, is_self, legal_name)
select o.id, true, o.name
from public.organizations o
where not exists (
  select 1 from public.ledgers l where l.org_id = o.id and l.is_self
);

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- POSTFLIGHT VERIFICATION (run AFTER applying, read-only). Expected values noted.
-- ============================================================
-- select
--   (select count(*) from public.organizations)                                          as orgs,
--   (select count(*) from public.ledgers where is_self)                                  as self_ledgers,          -- = orgs
--   (select relrowsecurity from pg_class where oid='public.document_counters'::regclass) as counters_rls_on,       -- t
--   (select count(*) from pg_policies where schemaname='public' and tablename='document_counters') as counter_policies, -- 0
--   (select count(*) from information_schema.role_table_grants where table_schema='public'
--      and table_name='document_counters' and grantee in ('anon','authenticated','service_role','public')) as counter_grants, -- 0
--   (select count(*) from pg_policies where schemaname='public' and tablename='documents')          as doc_policies,     -- 4
--   (select count(*) from pg_policies where schemaname='public' and tablename='ledgers')            as ledger_policies,  -- 2
--   (select string_agg(distinct privilege_type, ',' order by privilege_type)
--      from information_schema.role_table_grants
--      where table_schema='public' and table_name='ledgers' and grantee='authenticated')            as ledger_grants,    -- SELECT,UPDATE
--   (select count(*) from public.vat_rates)                                                          as vat_rates,        -- 2
--   (select count(*) from pg_trigger where tgrelid='public.documents'::regclass
--      and tgname='documents_enforce_immutability')                                                  as immutability_trig, -- 1
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--      where n.nspname='public' and p.proname in
--        ('issue_document','cancel_document','create_credit_note','mark_document_delivered',
--         'set_document_counter_start','_require_doc_operator_role') and p.prosecdef)                as secdef_rpcs,      -- 6
--   (select count(*) from pg_constraint where conname in
--      ('clients_id_org_uq','documents_ledger_org_fk','documents_client_org_fk',
--       'document_lines_doc_org_fk','document_payments_doc_org_fk',
--       'ledgers_client_org_fk','customer_consents_ledger_org_fk'))                                  as composite_fks,    -- 7
--   (select count(*) from pg_trigger where tgrelid='public.organizations'::regclass
--      and tgname='organizations_create_self_ledger')                                                as self_ledger_trig; -- 1

-- ============================================================
-- ROLLBACK — SAFE ONLY BEFORE any document has been issued (check first!).
-- Once numbers exist, do NOT drop — disable the feature flag in the app instead.
-- ============================================================
-- begin;
--   do $$ begin
--     if exists (select 1 from public.documents where number is not null) then
--       raise exception 'Issued documents exist — do NOT roll back; disable INVOICING_UI instead.';
--     end if;
--   end $$;
--   drop trigger  if exists organizations_create_self_ledger on public.organizations;
--   drop function if exists public._create_self_ledger();
--   drop function if exists public.set_document_counter_start(uuid, public.invoice_doc_type, integer);
--   drop function if exists public.mark_document_delivered(uuid);
--   drop function if exists public.create_credit_note(uuid);
--   drop function if exists public.cancel_document(uuid, text);
--   drop function if exists public.issue_document(uuid);
--   drop function if exists public._require_doc_operator_role(uuid);
--   drop trigger  if exists document_payments_enforce_immutability on public.document_payments;
--   drop trigger  if exists document_lines_enforce_immutability on public.document_lines;
--   drop trigger  if exists documents_enforce_immutability on public.documents;
--   drop function if exists public.enforce_document_child_immutability();
--   drop function if exists public.enforce_document_immutability();
--   drop table if exists public.document_payments;
--   drop table if exists public.document_lines;
--   drop table if exists public.customer_consents;
--   drop table if exists public.document_counters;
--   drop table if exists public.documents;
--   drop table if exists public.ledgers;
--   drop table if exists public.vat_rates;
--   alter table public.clients drop constraint if exists clients_id_org_uq;
--   drop type if exists public.allocation_status;
--   drop type if exists public.invoice_doc_status;
--   drop type if exists public.invoice_doc_type;
--   notify pgrst, 'reload schema';
-- commit;
