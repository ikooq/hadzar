-- Shared-time quality labels, repeatable couple rituals, and transparent deadline extensions.
begin;

alter table public.events add column if not exists moment_kind text not null default 'open';
alter table public.events add column if not exists ritual_group_id uuid;
alter table public.events add column if not exists ritual_rule text;
alter table public.events drop constraint if exists events_moment_kind_check;
alter table public.events add constraint events_moment_kind_check
  check (moment_kind in ('open','date','quick_catch_up','errands','quiet_time','ritual'));
alter table public.events drop constraint if exists events_ritual_rule_check;
alter table public.events add constraint events_ritual_rule_check
  check (ritual_rule is null or ritual_rule in ('weekly','monthly'));
create index if not exists idx_events_ritual_group on public.events(ritual_group_id);

alter table public.tasks add column if not exists extension_requested_at timestamptz;
alter table public.tasks add column if not exists extension_requested_by uuid references public.profiles(id);
alter table public.tasks add column if not exists requested_due_at timestamptz;
alter table public.tasks add column if not exists extension_note text not null default '' check (char_length(extension_note) <= 1000);

drop function if exists public.propose_window(date,integer,integer,text,text);
create or replace function public.propose_window(
  event_day date,
  start_at integer,
  end_at integer,
  event_title text,
  event_note text default '',
  moment_kind text default 'open'
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.couples; result uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  if moment_kind not in ('open','date','quick_catch_up','errands','quiet_time','ritual') then
    raise exception 'Choose a valid kind of time.';
  end if;
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
  insert into public.events(couple_id,user_id,day,title,start_min,end_min,shared,plan_status,plan_note,moment_kind)
    values(c.id,auth.uid(),event_day,event_title,start_at,end_at,true,'proposed',coalesce(event_note,''),moment_kind)
    returning id into result;
  return result;
end;$$;

create or replace function public.propose_recurring_window(
  event_day date,
  start_at integer,
  end_at integer,
  event_title text,
  event_note text default '',
  moment_kind text default 'ritual',
  ritual_rule text default 'weekly',
  occurrences integer default 4
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  group_id uuid := gen_random_uuid();
  first_id uuid;
  current_id uuid;
  i integer;
  target_day date;
begin
  if ritual_rule not in ('weekly','monthly') then raise exception 'Choose a valid ritual rhythm.'; end if;
  if occurrences not between 2 and 12 then raise exception 'Choose between two and twelve repetitions.'; end if;
  for i in 0..occurrences - 1 loop
    target_day := case when ritual_rule = 'weekly' then event_day + (i * 7) else (event_day + (i * interval '1 month'))::date end;
    current_id := public.propose_window(target_day,start_at,end_at,event_title,event_note,moment_kind);
    update public.events set ritual_group_id = group_id, ritual_rule = propose_recurring_window.ritual_rule,
      moment_kind = 'ritual' where id = current_id;
    if i = 0 then
      -- Keep the first id as the stable reference returned to the client.
      first_id := current_id;
    end if;
  end loop;
  return first_id;
end;$$;

create or replace function public.request_task_extension(
  task_id uuid,
  new_deadline timestamptz,
  request_note text default ''
)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  if new_deadline <= now() then raise exception 'Choose a future deadline.'; end if;
  select * into t from public.tasks where id = task_id and couple_id = private.my_couple() for update;
  if t.id is null or t.assignee_id <> auth.uid() then raise exception 'Only the person responsible can ask for more time.'; end if;
  if t.accepted_at is null or t.completed_at is not null or t.cancelled_at is not null or t.declined_at is not null then
    raise exception 'This commitment cannot be extended right now.';
  end if;
  if t.extension_requested_at is not null then raise exception 'An extension is already waiting for a response.'; end if;
  update public.tasks set extension_requested_at = now(), extension_requested_by = auth.uid(),
    requested_due_at = new_deadline, extension_note = coalesce(request_note,'') where id = t.id;
  perform private.notify_user(t.creator_id, t.couple_id, 'task_extension', 'More time requested', t.title, t.id);
end;$$;

create or replace function public.respond_task_extension(task_id uuid, action text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if action not in ('accept','decline') then raise exception 'Choose a valid extension response.'; end if;
  select * into t from public.tasks where id = task_id and couple_id = private.my_couple() for update;
  if t.id is null or t.creator_id <> auth.uid() or t.extension_requested_at is null then
    raise exception 'This extension request is no longer available.';
  end if;
  if action = 'accept' then
    update public.tasks set due_at = requested_due_at, extension_requested_at = null,
      extension_requested_by = null, requested_due_at = null, extension_note = '' where id = t.id;
  else
    update public.tasks set extension_requested_at = null, extension_requested_by = null,
      requested_due_at = null, extension_note = '' where id = t.id;
  end if;
  perform private.notify_user(t.assignee_id, t.couple_id,
    'task_extension', case when action = 'accept' then 'More time accepted' else 'Extension declined' end, t.title, t.id);
end;$$;

revoke all on function public.propose_window(date,integer,integer,text,text,text),
  public.propose_recurring_window(date,integer,integer,text,text,text,text,integer),
  public.request_task_extension(uuid,timestamptz,text), public.respond_task_extension(uuid,text)
  from public, anon;
grant execute on function public.propose_window(date,integer,integer,text,text,text),
  public.propose_recurring_window(date,integer,integer,text,text,text,text,integer),
  public.request_task_extension(uuid,timestamptz,text), public.respond_task_extension(uuid,text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
