-- Product improvements for live updates, task confirmation, request history,
-- message unread state, and self-service account controls.
begin;

alter table public.tasks add column if not exists confirmed_at timestamptz;

alter table public.pair_requests add column if not exists recipient_name text;
alter table public.pair_requests add column if not exists recipient_nickname text;
update public.pair_requests r
set recipient_name = p.name, recipient_nickname = p.nickname
from public.profiles p
where p.id = r.recipient_id
  and (r.recipient_name is null or r.recipient_nickname is null);

create table if not exists public.message_reads (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);
alter table public.message_reads enable row level security;
drop policy if exists message_reads_read on public.message_reads;
drop policy if exists message_reads_insert on public.message_reads;
drop policy if exists message_reads_update on public.message_reads;
create policy message_reads_read on public.message_reads for select to authenticated
  using (user_id = auth.uid() and couple_id = private.my_couple());
create policy message_reads_insert on public.message_reads for insert to authenticated
  with check (user_id = auth.uid() and couple_id = private.my_couple());
create policy message_reads_update on public.message_reads for update to authenticated
  using (user_id = auth.uid() and couple_id = private.my_couple())
  with check (user_id = auth.uid() and couple_id = private.my_couple());
revoke all on public.message_reads from anon, authenticated;
grant select, insert, update on public.message_reads to authenticated;

create or replace function public.send_pair_request(recipient_nickname text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  sender public.profiles;
  recipient public.profiles;
  result uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  select * into recipient from public.profiles
    where nickname = lower(ltrim(trim(recipient_nickname), '@'));
  if recipient.id is null then raise exception 'No hadzar account uses that nickname.'; end if;
  if recipient.id = auth.uid() then raise exception 'Choose your partner’s nickname.'; end if;
  perform id from public.profiles where id in (auth.uid(), recipient.id) order by id for no key update;
  select * into sender from public.profiles where id = auth.uid();
  if sender.id is null then raise exception 'Complete your profile first.'; end if;
  if exists(select 1 from public.couples where member_two is not null and
    (member_one in (sender.id, recipient.id) or member_two in (sender.id, recipient.id))) then
    raise exception 'One of you already belongs to a pair with a partner.';
  end if;
  insert into public.pair_requests(
    sender_id, recipient_id, sender_name, sender_nickname, recipient_name, recipient_nickname
  ) values (
    sender.id, recipient.id, sender.name, sender.nickname, recipient.name, recipient.nickname
  )
  on conflict(sender_id, recipient_id) where status = 'pending'
  do update set
    sender_name = excluded.sender_name,
    sender_nickname = excluded.sender_nickname,
    recipient_name = excluded.recipient_name,
    recipient_nickname = excluded.recipient_nickname
  returning id into result;
  return result;
end;$$;

create or replace function public.cancel_pair_request(request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  update public.pair_requests set status = 'declined', responded_at = now()
    where id = request_id and sender_id = auth.uid() and status = 'pending';
  if not found then raise exception 'This request is no longer available.'; end if;
end;$$;

create or replace function public.act_on_task(task_id uuid, action text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = task_id and couple_id = private.my_couple() for update;
  if t.id is null then raise exception 'This commitment is no longer available.'; end if;
  if action = 'confirm' then
    if t.creator_id <> auth.uid() or t.completed_at is null or t.confirmed_at is not null then
      raise exception 'Only the person who made this commitment can confirm it.';
    end if;
    update public.tasks set confirmed_at = now() where id = t.id;
  elsif t.assignee_id <> auth.uid() then
    raise exception 'Only the person responsible can do this.';
  elsif action = 'accept' and t.accepted_at is null and t.due_at > now() then
    update public.tasks set accepted_at = now() where id = t.id;
  elsif action = 'decline' and t.accepted_at is null then
    delete from public.tasks where id = t.id;
  elsif action = 'complete' and t.accepted_at is not null and t.completed_at is null then
    update public.tasks
      set completed_at = now(), confirmed_at = case when t.creator_id = auth.uid() then now() else null end
      where id = t.id;
  elsif action = 'paid' and t.accepted_at is not null and t.due_at < now()
    and (t.completed_at is null or t.completed_at > t.due_at) and t.paid_at is null then
    update public.tasks set paid_at = now() where id = t.id;
  else
    raise exception 'This action is not available.';
  end if;
end;$$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  delete from auth.users where id = auth.uid();
end;$$;

revoke all on function public.cancel_pair_request(uuid), public.delete_my_account() from public, anon;
grant execute on function public.cancel_pair_request(uuid), public.delete_my_account() to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pair_requests') then
      alter publication supabase_realtime add table public.pair_requests;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks') then
      alter publication supabase_realtime add table public.tasks;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then
      alter publication supabase_realtime add table public.events;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'schedule_days') then
      alter publication supabase_realtime add table public.schedule_days;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes') then
      alter publication supabase_realtime add table public.notes;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
