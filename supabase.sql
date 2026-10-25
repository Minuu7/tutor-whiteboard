-- Run once in the Supabase SQL editor (safe to re-run)

-- 1. Classroom table
create table if not exists public.whiteboard_sessions (
  room_id text primary key,
  access_token text,
  canvas_snapshot jsonb,
  updated_at timestamptz default now()
);
alter table public.whiteboard_sessions add column if not exists access_token text;

alter table public.whiteboard_sessions enable row level security;
drop policy if exists "anon read"   on public.whiteboard_sessions;
drop policy if exists "anon insert" on public.whiteboard_sessions;
drop policy if exists "anon update" on public.whiteboard_sessions;
create policy "anon read"   on public.whiteboard_sessions for select using (true);
create policy "anon insert" on public.whiteboard_sessions for insert with check (true);
create policy "anon update" on public.whiteboard_sessions for update using (true);

-- 2. Public storage bucket for rendered worksheet pages
insert into storage.buckets (id, name, public)
values ('worksheets', 'worksheets', true)
on conflict (id) do update set public = true;

drop policy if exists "worksheets read"   on storage.objects;
drop policy if exists "worksheets insert" on storage.objects;
drop policy if exists "worksheets update" on storage.objects;
create policy "worksheets read"   on storage.objects for select using (bucket_id = 'worksheets');
create policy "worksheets insert" on storage.objects for insert with check (bucket_id = 'worksheets');
create policy "worksheets update" on storage.objects for update using (bucket_id = 'worksheets');
