-- Enable Supabase Realtime for live sync
-- Tables added here will broadcast INSERT/UPDATE/DELETE events to subscribed clients
-- 2026-05-16

-- ============================================================
-- Add tables to the supabase_realtime publication
-- (Supabase automatically creates this publication)
-- ============================================================

alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table clients;
alter publication supabase_realtime add table profiles;

-- Set replica identity to full so we get full row data in UPDATE/DELETE events.
-- This is important for client-side cache reconciliation.
alter table tasks replica identity full;
alter table notifications replica identity full;
alter table clients replica identity full;
