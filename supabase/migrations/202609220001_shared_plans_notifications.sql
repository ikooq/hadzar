-- Shared plan proposals, short window holds, private note reminders,
-- recurring-series metadata, and durable in-app notifications.
begin;

alter table public.events add column if not exists series_id uuid;
alter table public.events add column if not exists series_rule text;
alter table public.events add column if not exists plan_status text not null default 'none';
alter table public.events add column if not exists plan_note text not null default '';
alter table public.events add column if not exists hold_expires_at timestamptz;
alter table public.events drop constraint if exists events_plan_status_check;
alter table public.events add constraint events_plan_status_check
  check (plan_status in ('none','proposed','accepted','reschedule_requested','declined','completed'));

alter table public.notes add column if not exists visibility text not null default 'shared';
alter table public.notes add column if not exists remind_at timestamptz;
alter table public.notes drop constraint if exists notes_visibility_check;
alter table public.notes add constraint notes_visibility_check
  check (visibility in ('shared','private'));

drop policy if exists notes_read on public.notes;
drop policy if exists notes_insert on public.notes;
drop policy if exists notes_update on public.notes;
drop policy if exists notes_delete on public.notes;
create policy notes_read on public.notes for select to authenticated
  using (couple_id = private.my_couple() and (visibility = 'shared' or author_id = auth.uid()));
create policy notes_insert on public.notes for insert to authenticated
  with check (couple_id = private.my_couple() and author_id = auth.uid()
    and visibility in ('shared','private'));
create policy notes_update on public.notes for update to authenticated
  using (couple_id = private.my_couple()
    and (visibility = 'shared' or author_id = auth.uid()))
  with check (couple_id = private.my_couple()
    and visibility in ('shared','private')
    and ((visibility = 'private' and author_id = auth.uid())
      or (visibility = 'shared' and (author_id = auth.uid() or private.is_partner(author_id)))));
create policy notes_delete on public.notes for delete to authenticated
  using (couple_id = private.my_couple() and (visibility = 'shared' or author_id = auth.uid()));
grant update(visibility, remind_at) on public.notes to authenticated;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid references public.couples(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null check (char_length(title) between 1 and 160),
  body text not null default '' check (char_length(body) <= 1000),
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_read on public.notifications;
drop policy if exists notifications_update on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = auth.uid() and (couple_id is null or couple_id = private.my_couple()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid() and (couple_id is null or couple_id = private.my_couple()))
  with check (user_id = auth.uid() and (couple_id is null or couple_id = private.my_couple()));
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;

create or replace function public.mark_notification_read(notification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications set read_at = coalesce(read_at, now())
    where id = notification_id and user_id = auth.uid()
      and couple_id = private.my_couple();
end;$$;
revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create table if not exists public.window_holds (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  held_by uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  start_min integer not null check (start_min between 0 and 1439),
  end_min integer not null check (end_min between 1 and 1440),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (end_min > start_min)
);
create unique index if not exists idx_window_holds_unique
  on public.window_holds(couple_id, day, start_min, end_min);
alter table public.window_holds enable row level security;
drop policy if exists window_holds_read on public.window_holds;
create policy window_holds_read on public.window_holds for select to authenticated
  using (couple_id = private.my_couple() and expires_at > now());
revoke all on public.window_holds from anon, authenticated;
grant select on public.window_holds to authenticated;

create or replace function public.hold_window(
  event_day date,
  start_at integer,
  end_at integer,
  hold_minutes integer default 10
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.couples; result uuid;
begin
  select * into c from public.couples where id = private.my_couple() for update;
  if c.id is null or c.member_two is null then raise exception 'Your partner needs to join first.'; end if;
  if hold_minutes not between 1 and 30 then raise exception 'Choose a hold between one and thirty minutes.'; end if;
  if start_at < c.day_start or end_at > c.day_end or end_at - start_at < c.minimum_window then
    raise exception 'Choose a window within your shared hours.';
  end if;
  delete from public.window_holds where expires_at <= now() or couple_id = c.id and held_by = auth.uid();
  if (select count(*) from public.schedule_days where couple_id = c.id and day = event_day) <> 2 then
    raise exception 'Both schedules need to be confirmed for this day.';
  end if;
  if exists(select 1 from public.window_holds
      where couple_id = c.id and day = event_day and start_min = start_at and end_min = end_at
        and expires_at > now() and held_by <> auth.uid()) then
    raise exception 'Your partner is holding this window right now.';
  end if;
  if exists(select 1 from public.events where couple_id = c.id and day = event_day
      and start_min - c.buffer < end_at and end_min + c.buffer > start_at) then
    raise exception 'Your schedules changed. Please choose another window.';
  end if;
  insert into public.window_holds(couple_id, held_by, day, start_min, end_min, expires_at)
    values(c.id, auth.uid(), event_day, start_at, end_at, now() + make_interval(mins => hold_minutes))
    on conflict (couple_id, day, start_min, end_min) do update set held_by = excluded.held_by, expires_at = excluded.expires_at
    returning id into result;
  return result;
end;$$;
create or replace function public.release_window(hold_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.window_holds where id = hold_id and held_by = auth.uid();
end;$$;
revoke all on function public.hold_window(date,integer,integer,integer), public.release_window(uuid) from public, anon;
grant execute on function public.hold_window(date,integer,integer,integer), public.release_window(uuid) to authenticated;

create or replace function public.propose_window(
  event_day date,
  start_at integer,
  end_at integer,
  event_title text,
  event_note text default ''
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.couples; result uuid;
begin
  select * into c from public.couples where id = private.my_couple() for update;
  if c.id is null or c.member_two is null then raise exception 'Your partner needs to join first.'; end if;
  if (select count(*) from public.schedule_days where couple_id = c.id and day = event_day) <> 2 then
    raise exception 'Both schedules need to be confirmed for this day.';
  end if;
  if start_at < c.day_start or end_at > c.day_end or end_at - start_at < c.minimum_window then
    raise exception 'Choose a window within your shared hours.';
  end if;
  if exists(select 1 from public.events where couple_id = c.id and day = event_day
      and start_min - c.buffer < end_at and end_min + c.buffer > start_at) then
    raise exception 'Your schedules changed. Please choose another window.';
  end if;
  insert into public.events(couple_id,user_id,day,title,start_min,end_min,shared,plan_status,plan_note)
    values(c.id,auth.uid(),event_day,event_title,start_at,end_at,true,'proposed',coalesce(event_note,''))
    returning id into result;
  return result;
end;$$;

create or replace function public.respond_to_plan(plan_id uuid, action text, note text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if action not in ('accept','decline','reschedule') then raise exception 'Choose a valid plan response.'; end if;
  if not exists(select 1 from public.events where id = plan_id and couple_id = private.my_couple() and shared) then
    raise exception 'This plan is no longer available.';
  end if;
  if exists(select 1 from public.events where id = plan_id and user_id = auth.uid()) then
    raise exception 'The person who proposed this plan cannot respond to it.';
  end if;
  update public.events set
    plan_status = case action when 'accept' then 'accepted' when 'decline' then 'declined' else 'reschedule_requested' end,
    plan_note = case when note = '' then plan_note else note end
    where id = plan_id and plan_status = 'proposed';
  if not found then raise exception 'This plan is no longer awaiting a response.'; end if;
end;$$;
revoke all on function public.propose_window(date,integer,integer,text,text), public.respond_to_plan(uuid,text,text) from public, anon;
grant execute on function public.propose_window(date,integer,integer,text,text), public.respond_to_plan(uuid,text,text) to authenticated;

create or replace function private.notify_user(target_user uuid, target_couple uuid, notification_type text, notification_title text, notification_body text, target_related uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if target_user is null or target_user = auth.uid() then return; end if;
  insert into public.notifications(couple_id,user_id,type,title,body,related_id)
    values(target_couple,target_user,notification_type,notification_title,notification_body,target_related);
end;$$;

create or replace function private.notify_pair_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then
    perform private.notify_user(new.recipient_id,
      (select id from public.couples where member_one in (new.sender_id,new.recipient_id) or member_two in (new.sender_id,new.recipient_id) limit 1),
      'pair_request','A partner request',new.sender_name || ' wants to share a space.',new.id);
  end if;
  return new;
end;$$;
drop trigger if exists pair_request_notification on public.pair_requests;
create trigger pair_request_notification after insert on public.pair_requests
  for each row execute function private.notify_pair_request();

create or replace function private.notify_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.couples; target uuid;
begin
  select * into c from public.couples where id = new.couple_id;
  target := case when c.member_one = new.sender_id then c.member_two else c.member_one end;
  perform private.notify_user(target,c.id,'message','A new message',left(new.body,140),new.id);
  return new;
end;$$;
drop trigger if exists message_notification on public.messages;
create trigger message_notification after insert on public.messages
  for each row execute function private.notify_message();

create or replace function private.notify_task_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.couples; target uuid; title text; body text;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  select * into c from public.couples where id = new.couple_id;
  target := case when new.creator_id = c.member_one then c.member_two else c.member_one end;
  title := case when new.cancelled_at is distinct from old.cancelled_at then 'A commitment was cancelled'
    when new.declined_at is distinct from old.declined_at then 'A commitment was declined'
    when new.completed_at is distinct from old.completed_at then 'A commitment was completed'
    when new.confirmed_at is distinct from old.confirmed_at then 'A completion was confirmed'
    when new.accepted_at is distinct from old.accepted_at then 'A commitment was accepted'
    when new.waived_at is distinct from old.waived_at then 'A penalty was waived' else null end;
  if title is not null then perform private.notify_user(target,c.id,'task',title,new.title,new.id); end if;
  return new;
end;$$;
drop trigger if exists task_notification on public.tasks;
create trigger task_notification after update on public.tasks
  for each row execute function private.notify_task_change();

create or replace function private.notify_plan_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.couples; target uuid;
begin
  if not new.shared or new.plan_status = 'none' then return new; end if;
  select * into c from public.couples where id = new.couple_id;
  target := case when c.member_one = new.user_id then c.member_two else c.member_one end;
  perform private.notify_user(target,c.id,'plan',case when new.plan_status = 'proposed' then 'A plan was proposed' else 'A plan changed' end,new.title,new.id);
  return new;
end;$$;
drop trigger if exists plan_notification on public.events;
create trigger plan_notification after insert or update of plan_status on public.events
  for each row execute function private.notify_plan_change();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
