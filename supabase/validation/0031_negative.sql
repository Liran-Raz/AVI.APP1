-- 0031 NEGATIVE / behavioral closure-proof — run AFTER 0031 on the throwaway DB.
-- Simulates DIRECT PostgREST access (set role authenticated/anon + auth.uid() GUC)
-- and asserts:
--   * encryption_keys is FAIL-CLOSED — no direct read/write for ANY client role,
--   * attachments enforces the hybrid posture — no direct INSERT/DELETE; UPDATE is
--     the archive toggle ONLY (the immutability trigger freezes everything else),
--   * cross-org isolation holds on every path — RLS filter, RPC membership checks,
--     and the composite org-pin FKs (23503),
--   * create_attachment enforces key org + scope/client coherence + liveness
--     (a client file can never ride the office key and survive crypto-shred),
--   * crypto-shred is owner/manager-only, nulls the wrapped key, leaves the office
--     key intact, and the one-ACTIVE-key partial-unique arbiter allows a re-mint,
--   * legitimate member flows (mint keys, create attachments, archive toggle) PASS.
--
-- Denial channels asserted (each in its own way):
--   * 42501 insufficient_privilege — revoked grants (caught by SQLSTATE),
--   * P0001 raise_exception — RPC belts + the immutability trigger; these share a
--     SQLSTATE with our own FAIL markers, so handlers match on SQLERRM and RE-RAISE
--     anything that does not contain the expected guard phrase,
--   * 23503 foreign_key_violation — composite org-pin FKs,
--   * 23514 check_violation — routing-shape / size CHECKs,
--   * 23505 unique_violation — the one-ACTIVE-key partial-unique arbiter,
--   * silent RLS FILTER — a cross-org / deactivated UPDATE affects 0 rows
--     (asserted via GET DIAGNOSTICS row_count — the 0029 lesson).
--
-- NOTE: UUIDs are inlined as literals (NOT psql :vars) because psql does not
-- substitute :var inside dollar-quoted $$...$$ blocks. Fixtures (0031_harness):
--   org A aaaaaaaa-...a0: OWNER a...a1 / ADMIN a...a2 / EMPLOYEE a...a3 /
--     DEACTIVATED a...a5; clients c...c1 + c...c2; task-with-client d1d1...01
--     (-> c1); task-without-client d2d2...02.
--   org B bbbbbbbb-...b0: OWNER b...b1; client c...c9.

\set ON_ERROR_STOP on

-- ============================================================
-- SECTION M — legitimate flows: members mint keys + attachments via the RPCs.
-- Generated ids are stashed in a session temp table (owned by authenticated so
-- every later authenticated block can read it; it survives SET ROLE switches).
-- ============================================================
set role authenticated;
create temp table _ids (name text primary key, id uuid);

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', false);

-- M1: the owner mints the org-A office key via the RPC.
do $$ declare v uuid; begin
  select public.attachments_insert_office_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0',
    'b64:office-wrapped-A', 'arn:aws:kms:il-central-1:000000000000:key/test-master', null)
    into v;
  if v is null then raise exception 'FAIL M1: office-key mint (org A) returned null'; end if;
  insert into _ids values ('office_key_a', v);
end $$;

-- M2: read-back — exactly one active office key, and it is the minted one.
do $$ declare n int; v uuid; begin
  select count(*) into n
    from public.attachments_get_office_key('aaaaaaaa-0000-0000-0000-0000000000a0');
  if n <> 1 then raise exception 'FAIL M2: expected exactly 1 active office key, got %', n; end if;
  select k.id into v
    from public.attachments_get_office_key('aaaaaaaa-0000-0000-0000-0000000000a0') k;
  if v <> (select id from _ids where name = 'office_key_a') then
    raise exception 'FAIL M2b: office-key read-back id mismatch';
  end if;
end $$;

-- M3: the owner mints client c1's key, wrapped by the office key.
do $$ declare v uuid; begin
  select public.attachments_insert_client_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'cccccccc-0000-0000-0000-0000000000c1',
    'b64:client-wrapped-A1', 'b64:wrap-iv', 'b64:wrap-tag',
    (select id from _ids where name = 'office_key_a'), null)
    into v;
  if v is null then raise exception 'FAIL M3: client-key mint (c1) returned null'; end if;
  insert into _ids values ('client_key_c1', v);
end $$;

-- M4: read-back — one active client key, wrapped by the office key.
do $$ declare n int; v_by uuid; begin
  select count(*) into n from public.attachments_get_client_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'cccccccc-0000-0000-0000-0000000000c1');
  if n <> 1 then raise exception 'FAIL M4: expected exactly 1 active client key, got %', n; end if;
  select k.wrapped_by_key_id into v_by from public.attachments_get_client_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'cccccccc-0000-0000-0000-0000000000c1') k;
  if v_by <> (select id from _ids where name = 'office_key_a') then
    raise exception 'FAIL M4b: client key is not wrapped by the office key';
  end if;
end $$;

-- M5: owner creates a plain client file (certificates_reports, c1, client key).
do $$ declare v uuid; begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'client', 'cccccccc-0000-0000-0000-0000000000c1',
    'certificates_reports', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1', 'statement.pdf', 'application/pdf', 1024,
    'b64:dek1', 'b64:dekiv1', 'b64:dektag1', 'b64:fiv1', 'b64:ftag1',
    (select id from _ids where name = 'client_key_c1'), 'b64:sha1')
    into v;
  if v is null then raise exception 'FAIL M5: create_attachment (client file) returned null'; end if;
end $$;

-- M6 (as the EMPLOYEE): a task-WITH-client file routes to the client
-- (owner=client, category=task_files, provenance=the task, per-client key).
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a3', false);
do $$ declare v uuid; begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'client', 'cccccccc-0000-0000-0000-0000000000c1',
    'task_files', 'd1d1d1d1-0000-0000-0000-000000000001',
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/att2', 'scan.png', 'image/png', 2048,
    'b64:dek2', 'b64:dekiv2', 'b64:dektag2', 'b64:fiv2', 'b64:ftag2',
    (select id from _ids where name = 'client_key_c1'), null)
    into v;
  if v is null then raise exception 'FAIL M6: employee create_attachment (task->client file) returned null'; end if;
end $$;

-- M7 (employee): a task-WITHOUT-client file is office-owned (office key).
do $$ declare v uuid; begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'office', null,
    'task_files', 'd2d2d2d2-0000-0000-0000-000000000002',
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/att3', 'notes.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 4096,
    'b64:dek3', 'b64:dekiv3', 'b64:dektag3', 'b64:fiv3', 'b64:ftag3',
    (select id from _ids where name = 'office_key_a'), null)
    into v;
  if v is null then raise exception 'FAIL M7: create_attachment (office task file) returned null'; end if;
end $$;

-- M8 (employee): office-library file at the EXACT 25MB boundary (26214400 passes).
do $$ declare v uuid; begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'office', null,
    'office_files', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/att4', 'ci.bin', 'application/pdf', 26214400,
    'b64:dek4', 'b64:dekiv4', 'b64:dektag4', 'b64:fiv4', 'b64:ftag4',
    (select id from _ids where name = 'office_key_a'), null)
    into v;
  if v is null then raise exception 'FAIL M8: create_attachment at the 25MB boundary returned null'; end if;
end $$;

-- M9: a member sees all 4 org rows; uploaded_by was stamped from auth.uid();
-- the routing dims of the task->client file persisted exactly.
do $$ declare n int; begin
  select count(*) into n from public.attachments
    where org_id = 'aaaaaaaa-0000-0000-0000-0000000000a0';
  if n <> 4 then raise exception 'FAIL M9: member expected 4 attachments, sees %', n; end if;
  if exists (select 1 from public.attachments
             where org_id = 'aaaaaaaa-0000-0000-0000-0000000000a0' and uploaded_by is null) then
    raise exception 'FAIL M9b: uploaded_by was not stamped from auth.uid()';
  end if;
  if not exists (select 1 from public.attachments
                 where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att2'
                   and owner_kind = 'client'
                   and client_id = 'cccccccc-0000-0000-0000-0000000000c1'
                   and category = 'task_files'
                   and source_task_id = 'd1d1d1d1-0000-0000-0000-000000000001') then
    raise exception 'FAIL M9c: task->client routing dims did not persist';
  end if;
end $$;

-- M10 (org-B owner): the empty-read contract (0 rows before any key exists) that
-- the Node get-or-create flow relies on, then mint org B's office key.
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-0000000000b1', false);
do $$ declare n int; v uuid; begin
  select count(*) into n
    from public.attachments_get_office_key('bbbbbbbb-0000-0000-0000-0000000000b0');
  if n <> 0 then raise exception 'FAIL M10: org B expected 0 office keys before mint, got %', n; end if;
  select public.attachments_insert_office_key(
    'bbbbbbbb-0000-0000-0000-0000000000b0',
    'b64:office-wrapped-B', 'arn:aws:kms:il-central-1:000000000000:key/test-master', null)
    into v;
  if v is null then raise exception 'FAIL M10b: office-key mint (org B) returned null'; end if;
  insert into _ids values ('office_key_b', v);
end $$;

-- ============================================================
-- SECTION K — encryption_keys is FAIL-CLOSED. Even the org OWNER is denied every
-- direct table access; anon is denied the tables AND the RPCs.
-- ============================================================
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', false);

-- K1: owner direct SELECT on encryption_keys -> BLOCKED
do $$ declare n int; begin begin
  select count(*) into n from public.encryption_keys
    where org_id = 'aaaaaaaa-0000-0000-0000-0000000000a0';
  raise exception 'FAIL K1: owner read encryption_keys directly';
exception when insufficient_privilege then null; end; end $$;

-- K2: owner direct INSERT -> BLOCKED
do $$ begin begin
  insert into public.encryption_keys (org_id, scope, kms_key_id, wrapped_key)
    values ('aaaaaaaa-0000-0000-0000-0000000000a0', 'office', 'arn:evil', 'b64:evil');
  raise exception 'FAIL K2: owner inserted into encryption_keys directly';
exception when insufficient_privilege then null; end; end $$;

-- K3: owner direct UPDATE (tamper a wrapped key) -> BLOCKED
do $$ begin begin
  update public.encryption_keys set wrapped_key = 'b64:tampered'
    where org_id = 'aaaaaaaa-0000-0000-0000-0000000000a0';
  raise exception 'FAIL K3: owner updated encryption_keys directly';
exception when insufficient_privilege then null; end; end $$;

-- K4: owner direct DELETE -> BLOCKED
do $$ begin begin
  delete from public.encryption_keys
    where org_id = 'aaaaaaaa-0000-0000-0000-0000000000a0';
  raise exception 'FAIL K4: owner deleted from encryption_keys directly';
exception when insufficient_privilege then null; end; end $$;

set role anon;

-- K5: anon direct SELECT on encryption_keys -> BLOCKED
do $$ declare n int; begin begin
  select count(*) into n from public.encryption_keys;
  raise exception 'FAIL K5: anon read encryption_keys';
exception when insufficient_privilege then null; end; end $$;

-- K6: anon cannot execute the key RPCs (EXECUTE revoked)
do $$ declare n int; begin begin
  select count(*) into n
    from public.attachments_get_office_key('aaaaaaaa-0000-0000-0000-0000000000a0');
  raise exception 'FAIL K6: anon executed attachments_get_office_key';
exception when insufficient_privilege then null; end; end $$;

-- K7: anon direct SELECT on attachments -> BLOCKED (grant is to authenticated only)
do $$ declare n int; begin begin
  select count(*) into n from public.attachments;
  raise exception 'FAIL K7: anon read attachments';
exception when insufficient_privilege then null; end; end $$;

-- K8: anon cannot execute create_attachment
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'office', null, 'office_files', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/anon', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', '00000000-0000-0000-0000-000000000000', null)
    into v;
  raise exception 'FAIL K8: anon executed create_attachment';
exception when insufficient_privilege then null; end; end $$;

set role authenticated;

-- ============================================================
-- SECTION W — attachments write boundary (as the EMPLOYEE, a legitimate member):
-- INSERT/DELETE denied at the grant; UPDATE passes RLS but the immutability
-- trigger freezes everything except the archive toggle.
-- ============================================================
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a3', false);

-- W1: direct INSERT (forged row) -> BLOCKED (no INSERT grant)
do $$ begin begin
  insert into public.attachments
    (org_id, owner_kind, client_id, category, object_key, file_name, mime_type,
     size_bytes, dek_wrapped, dek_iv, dek_tag, file_iv, file_tag, key_id)
  values
    ('aaaaaaaa-0000-0000-0000-0000000000a0', 'office', null, 'office_files',
     'org/aaaaaaaa-0000-0000-0000-0000000000a0/forged', 'f', 'application/pdf',
     1, 'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_a'));
  raise exception 'FAIL W1: direct INSERT into attachments was ACCEPTED';
exception when insufficient_privilege then null; end; end $$;

-- W2: direct DELETE -> BLOCKED (no DELETE grant in R1)
do $$ begin begin
  delete from public.attachments
    where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  raise exception 'FAIL W2: direct DELETE from attachments was ACCEPTED';
exception when insufficient_privilege then null; end; end $$;

-- W3-W8: the immutability trigger freezes crypto / routing / identity / provenance
-- columns. Each attempt must raise the trigger's 'immutable' message; anything
-- else (including our own FAIL marker) re-raises and fails the job.
do $$ begin begin
  update public.attachments set dek_wrapped = 'b64:forged'
    where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  raise exception 'FAIL W3: crypto-column (dek_wrapped) update was ACCEPTED';
exception when raise_exception then
  if position('immutable' in sqlerrm) = 0 then raise; end if;
end; end $$;

do $$ begin begin
  update public.attachments set owner_kind = 'office', client_id = null, category = 'office_files'
    where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  raise exception 'FAIL W4: routing re-route update was ACCEPTED';
exception when raise_exception then
  if position('immutable' in sqlerrm) = 0 then raise; end if;
end; end $$;

do $$ begin begin
  update public.attachments set object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/stolen'
    where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  raise exception 'FAIL W5: object_key update was ACCEPTED';
exception when raise_exception then
  if position('immutable' in sqlerrm) = 0 then raise; end if;
end; end $$;

do $$ begin begin
  update public.attachments set uploaded_by = 'a0000000-0000-0000-0000-0000000000a3'
    where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  raise exception 'FAIL W6: uploaded_by (provenance) update was ACCEPTED';
exception when raise_exception then
  if position('immutable' in sqlerrm) = 0 then raise; end if;
end; end $$;

do $$ begin begin
  update public.attachments set content_sha256 = 'b64:forged-hash'
    where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  raise exception 'FAIL W7: content_sha256 update was ACCEPTED';
exception when raise_exception then
  if position('immutable' in sqlerrm) = 0 then raise; end if;
end; end $$;

do $$ begin begin
  update public.attachments set file_name = 'renamed.pdf', created_at = now()
    where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  raise exception 'FAIL W8: file_name/created_at update was ACCEPTED';
exception when raise_exception then
  if position('immutable' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- W9 (LEGIT): the archive toggle IS allowed for any active member.
do $$ declare cnt int; begin
  update public.attachments
     set archived_at = now(), archived_by = 'a0000000-0000-0000-0000-0000000000a3'
   where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  get diagnostics cnt = row_count;
  if cnt <> 1 then raise exception 'FAIL W9: archive toggle affected % row(s), expected 1', cnt; end if;
  if not exists (select 1 from public.attachments
                 where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1'
                   and archived_at is not null
                   and archived_by = 'a0000000-0000-0000-0000-0000000000a3') then
    raise exception 'FAIL W9b: archive did not persist';
  end if;
end $$;

-- W10 (LEGIT): un-archive.
do $$ declare cnt int; begin
  update public.attachments set archived_at = null, archived_by = null
   where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  get diagnostics cnt = row_count;
  if cnt <> 1 then raise exception 'FAIL W10: un-archive affected % row(s), expected 1', cnt; end if;
  if not exists (select 1 from public.attachments
                 where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1'
                   and archived_at is null) then
    raise exception 'FAIL W10b: un-archive did not persist';
  end if;
end $$;

-- W11: an archive toggle SMUGGLING a crypto change in the same UPDATE -> BLOCKED.
do $$ begin begin
  update public.attachments set archived_at = now(), dek_wrapped = 'b64:smuggled'
    where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  raise exception 'FAIL W11: archive+crypto combined update was ACCEPTED';
exception when raise_exception then
  if position('immutable' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- ============================================================
-- SECTION X — cross-org isolation (attacker = org B's OWNER).
-- ============================================================
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-0000000000b1', false);

-- X1: org B sees ZERO org-A attachments (RLS filter).
do $$ declare n int; begin
  select count(*) into n from public.attachments
    where org_id = 'aaaaaaaa-0000-0000-0000-0000000000a0';
  if n <> 0 then raise exception 'FAIL X1: org B read % org-A attachment(s)', n; end if;
end $$;

-- X2: org B archives an org-A attachment -> RLS FILTERS silently (0 rows).
do $$ declare cnt int; begin
  update public.attachments set archived_at = now()
   where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  get diagnostics cnt = row_count;
  if cnt <> 0 then raise exception 'FAIL X2: cross-org archive affected % row(s)', cnt; end if;
end $$;

-- X3: org B reads org A's office key via the RPC -> membership check BLOCKS.
do $$ declare n int; begin begin
  select count(*) into n
    from public.attachments_get_office_key('aaaaaaaa-0000-0000-0000-0000000000a0');
  raise exception 'FAIL X3: cross-org office-key read was ACCEPTED';
exception when raise_exception then
  if position('not an active member' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- X3b: same for the client-key read RPC.
do $$ declare n int; begin begin
  select count(*) into n from public.attachments_get_client_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'cccccccc-0000-0000-0000-0000000000c1');
  raise exception 'FAIL X3b: cross-org client-key read was ACCEPTED';
exception when raise_exception then
  if position('not an active member' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- X4: org B mints an attachment INTO org A -> membership check BLOCKS.
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'office', null, 'office_files', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/x4', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_a'), null)
    into v;
  raise exception 'FAIL X4: cross-org create_attachment was ACCEPTED';
exception when raise_exception then
  if position('not an active member' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- X5: org B attaches a file to ORG A'S CLIENT inside org B -> the key-coherence
-- belt blocks first (an office key can never own a client file).
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'bbbbbbbb-0000-0000-0000-0000000000b0', 'client', 'cccccccc-0000-0000-0000-0000000000c1',
    'additional', null,
    'org/bbbbbbbb-0000-0000-0000-0000000000b0/x5', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_b'), null)
    into v;
  raise exception 'FAIL X5: cross-org client attachment was ACCEPTED';
exception when raise_exception then
  if position('does not match' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- X6: org B claims ORG A'S TASK as provenance -> the composite org-pin FK fires
-- (23503) even though the plain single-column task FK would be satisfied.
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'bbbbbbbb-0000-0000-0000-0000000000b0', 'office', null, 'task_files',
    'd1d1d1d1-0000-0000-0000-000000000001',
    'org/bbbbbbbb-0000-0000-0000-0000000000b0/x6', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_b'), null)
    into v;
  raise exception 'FAIL X6: cross-org task provenance was ACCEPTED';
exception when foreign_key_violation then null; end; end $$;

-- X7: org B uses ORG A'S KEY for an org-B attachment -> key-org belt BLOCKS.
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'bbbbbbbb-0000-0000-0000-0000000000b0', 'office', null, 'office_files', null,
    'org/bbbbbbbb-0000-0000-0000-0000000000b0/x7', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_a'), null)
    into v;
  raise exception 'FAIL X7: a foreign org key was ACCEPTED';
exception when raise_exception then
  if position('not found in this organization' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- X8: org B mints a client key for ORG A'S client -> client-org belt BLOCKS.
do $$ declare v uuid; begin begin
  select public.attachments_insert_client_key(
    'bbbbbbbb-0000-0000-0000-0000000000b0', 'cccccccc-0000-0000-0000-0000000000c1',
    'b64:x', 'b64:i', 'b64:t', (select id from _ids where name = 'office_key_b'), null)
    into v;
  raise exception 'FAIL X8: cross-org client-key mint was ACCEPTED';
exception when raise_exception then
  if position('client not found' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- X9: org B crypto-shreds ORG A'S client -> role belt BLOCKS (not admin/owner THERE).
do $$ begin begin
  perform public.attachments_revoke_client_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'cccccccc-0000-0000-0000-0000000000c1');
  raise exception 'FAIL X9: cross-org crypto-shred was ACCEPTED';
exception when raise_exception then
  if position('owner or manager' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- ============================================================
-- SECTION S — structural backstops as postgres (bypasses grants/RLS/belts/trigger,
-- so the CONSTRAINT layer itself is what blocks). Also proves the deliberate
-- postgres bypass of the immutability trigger (the definer-RPC/operator path).
-- ============================================================
reset role;

-- S1: org-pin — attachment in org A referencing ORG B'S client -> 23503.
do $$ begin begin
  insert into public.attachments
    (org_id, owner_kind, client_id, category, object_key, file_name, mime_type,
     size_bytes, dek_wrapped, dek_iv, dek_tag, file_iv, file_tag, key_id)
  values
    ('aaaaaaaa-0000-0000-0000-0000000000a0', 'client', 'cccccccc-0000-0000-0000-0000000000c9',
     'additional', 'org/aaaaaaaa-0000-0000-0000-0000000000a0/s1', 's1', 'application/pdf',
     1, 'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_a'));
  raise exception 'FAIL S1: the cross-org client org-pin did not fire';
exception when foreign_key_violation then null; end; end $$;

-- S2: org-pin — attachment in org B claiming ORG A'S task -> 23503 (the composite
-- pin is the blocker; the single-column provenance FK alone would pass).
do $$ begin begin
  insert into public.attachments
    (org_id, owner_kind, client_id, category, object_key, file_name, mime_type,
     size_bytes, dek_wrapped, dek_iv, dek_tag, file_iv, file_tag, key_id, source_task_id)
  values
    ('bbbbbbbb-0000-0000-0000-0000000000b0', 'office', null,
     'task_files', 'org/bbbbbbbb-0000-0000-0000-0000000000b0/s2', 's2', 'application/pdf',
     1, 'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_b'),
     'd1d1d1d1-0000-0000-0000-000000000001');
  raise exception 'FAIL S2: the cross-org task org-pin did not fire';
exception when foreign_key_violation then null; end; end $$;

-- S3: org-pin — client key in org A wrapped by ORG B'S office key -> 23503
-- (the new self-referential encryption_keys_wrapped_by_org_fk).
do $$ begin begin
  insert into public.encryption_keys
    (org_id, scope, client_id, wrapped_key, wrap_iv, wrap_tag, wrapped_by_key_id)
  values
    ('aaaaaaaa-0000-0000-0000-0000000000a0', 'client', 'cccccccc-0000-0000-0000-0000000000c2',
     'b64:x', 'b64:i', 'b64:t', (select id from _ids where name = 'office_key_b'));
  raise exception 'FAIL S3: the cross-org wrapped_by org-pin did not fire';
exception when foreign_key_violation then null; end; end $$;

-- S4: org-pin — attachment in org A pointing at ORG B'S key -> 23503
-- (the new attachments_key_org_fk).
do $$ begin begin
  insert into public.attachments
    (org_id, owner_kind, client_id, category, object_key, file_name, mime_type,
     size_bytes, dek_wrapped, dek_iv, dek_tag, file_iv, file_tag, key_id)
  values
    ('aaaaaaaa-0000-0000-0000-0000000000a0', 'office', null, 'office_files',
     'org/aaaaaaaa-0000-0000-0000-0000000000a0/s4', 's4', 'application/pdf',
     1, 'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_b'));
  raise exception 'FAIL S4: the cross-org key org-pin did not fire';
exception when foreign_key_violation then null; end; end $$;

-- S5: encryption_keys_shape — an office key carrying a client_id -> 23514.
do $$ begin begin
  insert into public.encryption_keys (org_id, scope, client_id, kms_key_id, wrapped_key)
  values ('aaaaaaaa-0000-0000-0000-0000000000a0', 'office',
          'cccccccc-0000-0000-0000-0000000000c1', 'arn:x', 'b64:x');
  raise exception 'FAIL S5: an office key with a client_id was ACCEPTED';
exception when check_violation then null; end; end $$;

-- S6: encryption_keys_shape — a client key WITHOUT a wrapping office key -> 23514.
do $$ begin begin
  insert into public.encryption_keys (org_id, scope, client_id, wrapped_key, wrap_iv, wrap_tag)
  values ('aaaaaaaa-0000-0000-0000-0000000000a0', 'client',
          'cccccccc-0000-0000-0000-0000000000c2', 'b64:x', 'b64:i', 'b64:t');
  raise exception 'FAIL S6: an unwrapped client key was ACCEPTED';
exception when check_violation then null; end; end $$;

-- S7: the postgres BYPASS of the immutability trigger works (this is the
-- definer-RPC / operator path; 0029 idiom) — then revert.
do $$ declare cnt int; begin
  update public.attachments set file_name = 'renamed-by-operator'
   where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att4';
  get diagnostics cnt = row_count;
  if cnt <> 1 then raise exception 'FAIL S7: postgres bypass update affected % row(s)', cnt; end if;
  update public.attachments set file_name = 'ci.bin'
   where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att4';
end $$;

-- ============================================================
-- SECTION D — a DEACTIVATED member of org A is locked out everywhere.
-- ============================================================
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a5', false);

-- D1: reads nothing.
do $$ declare n int; begin
  select count(*) into n from public.attachments
    where org_id = 'aaaaaaaa-0000-0000-0000-0000000000a0';
  if n <> 0 then raise exception 'FAIL D1: a deactivated member read % attachment(s)', n; end if;
end $$;

-- D2: the key RPCs refuse (is_active = false fails the membership check).
do $$ declare n int; begin begin
  select count(*) into n
    from public.attachments_get_office_key('aaaaaaaa-0000-0000-0000-0000000000a0');
  raise exception 'FAIL D2: a deactivated member read the office key';
exception when raise_exception then
  if position('not an active member' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- D3: create_attachment refuses.
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'office', null, 'office_files', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/d3', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_a'), null)
    into v;
  raise exception 'FAIL D3: a deactivated member minted an attachment';
exception when raise_exception then
  if position('not an active member' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- D4: the archive toggle silently filters (0 rows).
do $$ declare cnt int; begin
  update public.attachments set archived_at = now()
   where object_key = 'org/aaaaaaaa-0000-0000-0000-0000000000a0/att1';
  get diagnostics cnt = row_count;
  if cnt <> 0 then raise exception 'FAIL D4: a deactivated member archived % row(s)', cnt; end if;
end $$;

-- ============================================================
-- SECTION L — crypto-shred lifecycle + the one-ACTIVE-key arbiter.
-- ============================================================

-- L1: an EMPLOYEE cannot crypto-shred.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a3', false);
do $$ begin begin
  perform public.attachments_revoke_client_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'cccccccc-0000-0000-0000-0000000000c1');
  raise exception 'FAIL L1: an employee crypto-shredded a client';
exception when raise_exception then
  if position('owner or manager' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- L2 (LEGIT): the ADMIN (manager) crypto-shreds client c1.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a2', false);
do $$ begin
  perform public.attachments_revoke_client_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'cccccccc-0000-0000-0000-0000000000c1');
end $$;

-- L3: the active-key read now returns 0 rows.
do $$ declare n int; begin
  select count(*) into n from public.attachments_get_client_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'cccccccc-0000-0000-0000-0000000000c1');
  if n <> 0 then raise exception 'FAIL L3: a revoked client key is still readable (% row(s))', n; end if;
end $$;

-- L4 (as postgres): the wrapped key material is GONE, status/revoked_at stamped.
reset role;
do $$ begin
  if not exists (select 1 from public.encryption_keys
                 where id = (select id from _ids where name = 'client_key_c1')
                   and wrapped_key is null and status = 'revoked' and revoked_at is not null) then
    raise exception 'FAIL L4: crypto-shred did not null the wrapped key / stamp revoked';
  end if;
end $$;
set role authenticated;

-- L5: the OFFICE key is untouched by a client shred.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', false);
do $$ declare n int; begin
  select count(*) into n
    from public.attachments_get_office_key('aaaaaaaa-0000-0000-0000-0000000000a0');
  if n <> 1 then raise exception 'FAIL L5: the office key was affected by a client shred (% row(s))', n; end if;
end $$;

-- L6: create_attachment refuses the REVOKED key (liveness belt).
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'client', 'cccccccc-0000-0000-0000-0000000000c1',
    'additional', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/l6', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'client_key_c1'), null)
    into v;
  raise exception 'FAIL L6: a revoked key was ACCEPTED for a new attachment';
exception when raise_exception then
  if position('not active' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- L7 (LEGIT): after a shred the partial-unique arbiter allows a NEW active key
-- (the rotation/re-onboard path).
do $$ declare v uuid; begin
  select public.attachments_insert_client_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'cccccccc-0000-0000-0000-0000000000c1',
    'b64:client-wrapped-A1-v2', 'b64:wrap-iv2', 'b64:wrap-tag2',
    (select id from _ids where name = 'office_key_a'), null)
    into v;
  if v is null then raise exception 'FAIL L7: re-minting a client key after shred failed'; end if;
  insert into _ids values ('client_key_c1_v2', v);
end $$;

-- L8: a SECOND active client key for the same client -> 23505 (the race arbiter
-- the Node get-or-create flow relies on).
do $$ declare v uuid; begin begin
  select public.attachments_insert_client_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'cccccccc-0000-0000-0000-0000000000c1',
    'b64:dup', 'b64:i', 'b64:t', (select id from _ids where name = 'office_key_a'), null)
    into v;
  raise exception 'FAIL L8: a second ACTIVE client key was ACCEPTED';
exception when unique_violation then null; end; end $$;

-- L9: a SECOND active office key -> 23505.
do $$ declare v uuid; begin begin
  select public.attachments_insert_office_key(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'b64:dup', 'arn:x', null)
    into v;
  raise exception 'FAIL L9: a second ACTIVE office key was ACCEPTED';
exception when unique_violation then null; end; end $$;

-- ============================================================
-- SECTION H — key scope/client coherence belts (the crypto-shred guarantee).
-- ============================================================

-- H1: a CLIENT file riding the OFFICE key -> BLOCKED (it would survive the
-- client's crypto-shred).
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'client', 'cccccccc-0000-0000-0000-0000000000c1',
    'additional', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/h1', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_a'), null)
    into v;
  raise exception 'FAIL H1: a client file rode the OFFICE key';
exception when raise_exception then
  if position('does not match' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- H2: an OFFICE file riding a CLIENT key -> BLOCKED.
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'office', null, 'office_files', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/h2', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'client_key_c1_v2'), null)
    into v;
  raise exception 'FAIL H2: an office file rode a CLIENT key';
exception when raise_exception then
  if position('does not match' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- H3: client A2's file riding CLIENT A1'S key -> BLOCKED (wrong client's key).
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'client', 'cccccccc-0000-0000-0000-0000000000c2',
    'additional', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/h3', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'client_key_c1_v2'), null)
    into v;
  raise exception 'FAIL H3: a file for client A2 rode client A1''s key';
exception when raise_exception then
  if position('does not match' in sqlerrm) = 0 then raise; end if;
end; end $$;

-- ============================================================
-- SECTION R — routing-shape + size CHECKs through the RPC (belts pass, the
-- table CHECK is the blocker -> 23514).
-- ============================================================

-- R1: owner=office with a client-only category -> 23514.
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'office', null, 'client_uploaded', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/r1', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_a'), null)
    into v;
  raise exception 'FAIL R1: an office file with a client-only category was ACCEPTED';
exception when check_violation then null; end; end $$;

-- R2: owner=client with an office-only category -> 23514.
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'client', 'cccccccc-0000-0000-0000-0000000000c1',
    'office_files', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/r2', 'x', 'application/pdf', 1,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'client_key_c1_v2'), null)
    into v;
  raise exception 'FAIL R2: a client file with an office-only category was ACCEPTED';
exception when check_violation then null; end; end $$;

-- R3: one byte over the 25MB cap -> 23514.
do $$ declare v uuid; begin begin
  select public.create_attachment(
    'aaaaaaaa-0000-0000-0000-0000000000a0', 'office', null, 'office_files', null,
    'org/aaaaaaaa-0000-0000-0000-0000000000a0/r3', 'big', 'application/pdf', 26214401,
    'd', 'i', 't', 'fi', 'ft', (select id from _ids where name = 'office_key_a'), null)
    into v;
  raise exception 'FAIL R3: a file over the 25MB cap was ACCEPTED';
exception when check_violation then null; end; end $$;

reset role;
select 'ALL 0031 ATTACHMENTS/ENCRYPTION BEHAVIORAL CHECKS PASSED (M1-M10, K1-K8, W1-W11, X1-X9, S1-S7, D1-D4, L1-L9, H1-H3, R1-R3)' as result;
