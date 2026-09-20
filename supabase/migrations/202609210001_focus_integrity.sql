-- Focus and integrity improvements: schedule freshness, request lifecycle,
-- commitment history, and safer account transitions.
begin;

-- A request cancelled by its sender is different from a request declined by
-- its recipient. Keep that distinction in the shared history.
alter table public.pair_requests
  drop constraint if exists pair_requests_status_check;
alter table public.pair_requests
  add constraint pair_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled'));

create or replace function private.limit_pair_request_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.pair_requests
      where sender_id = new.sender_id and recipient_id = new.recipient_id and status = 'pending') then
    return new;
  end if;
  if (select count(*) from public.pair_requests
      where sender_id = new.sender_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many partner requests. Please try again later.';
  end if;
  return new;
end;$$;
drop trigger if exists pair_request_rate_limit on public.pair_requests;
create trigger pair_request_rate_limit
  before insert on public.pair_requests
  for each row execute function private.limit_pair_request_rate();

create or replace function public.cancel_pair_request(request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  update public.pair_requests
    set status = 'cancelled', responded_at = now()
    where id = request_id and sender_id = auth.uid() and status = 'pending';
  if not found then raise exception 'This request is no longer available.'; end if;
end;$$;

-- Busy events make the prior schedule confirmation stale. Planned shared
-- events intentionally do not invalidate the two confirmations that created
-- them.
create or replace function private.invalidate_schedule_confirmation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and not new.shared)
     or (tg_op = 'DELETE' and not old.shared)
     or (tg_op = 'UPDATE' and (not old.shared or not new.shared)) then
    delete from public.schedule_days
      where couple_id = coalesce(new.couple_id, old.couple_id)
        and day = coalesce(new.day, old.day);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;$$;
drop trigger if exists events_invalidate_schedule on public.events;
create trigger events_invalidate_schedule
  after insert or update or delete on public.events
  for each row execute function private.invalidate_schedule_confirmation();

-- Preserve commitment history instead of deleting a declined promise. These
-- nullable timestamps keep old rows compatible and make actions auditable.
alter table public.tasks add column if not exists declined_at timestamptz;
alter table public.tasks add column if not exists cancelled_at timestamptz;
alter table public.tasks add column if not exists waived_at timestamptz;

-- Changing the shared rhythm invalidates day confirmations too. A pair must
-- confirm the resulting schedule again before planning another window.
create or replace function public.save_pair_settings(
  tz text,
  start_at integer,
  end_at integer,
  min_window integer,
  travel_buffer integer,
  default_fee integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.couples;
begin
  select * into c from public.couples where id = private.my_couple() for update;
  if c.id is null then raise exception 'Join a pair first.'; end if;
  if not exists(select 1 from pg_timezone_names where name = tz) then
    raise exception 'Choose a valid timezone.';
  end if;
  if c.timezone <> tz or c.day_start <> start_at or c.day_end <> end_at
     or c.minimum_window <> min_window or c.buffer <> travel_buffer then
    delete from public.schedule_days where couple_id = c.id;
  end if;
  update public.couples set
    timezone = tz,
    day_start = start_at,
    day_end = end_at,
    minimum_window = min_window,
    buffer = travel_buffer,
    default_penalty = default_fee
  where id = c.id;
end;$$;

create or replace function public.add_task(
  task_title text,
  task_description text,
  assigned_to uuid,
  deadline timestamptz,
  fee integer
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if private.my_couple() is null or not private.is_partner(assigned_to) then
    raise exception 'Choose someone in your pair.';
  end if;
  if deadline <= now() then raise exception 'Choose a future deadline.'; end if;
  insert into public.tasks(
    couple_id, creator_id, assignee_id, title, description, due_at, penalty,
    accepted_at, declined_at, cancelled_at, waived_at
  ) values (
    private.my_couple(), auth.uid(), assigned_to, task_title, task_description,
    deadline, fee, case when assigned_to = auth.uid() then now() else null end,
    null, null, null
  ) returning id into result;
  return result;
end;$$;

create or replace function public.act_on_task(task_id uuid, action text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks
    where id = task_id and couple_id = private.my_couple() for update;
  if t.id is null then raise exception 'This commitment is no longer available.'; end if;

  if action = 'confirm' then
    if t.creator_id <> auth.uid() or t.completed_at is null
       or t.confirmed_at is not null or t.cancelled_at is not null
       or t.declined_at is not null then
      raise exception 'Only the person who made this commitment can confirm it.';
    end if;
    update public.tasks set confirmed_at = now() where id = t.id;
  elsif action = 'cancel' then
    if t.creator_id <> auth.uid() or t.completed_at is not null
       or t.cancelled_at is not null then
      raise exception 'Only the person who made this commitment can cancel it.';
    end if;
    update public.tasks set cancelled_at = now() where id = t.id;
  elsif action = 'waive' then
    if t.creator_id <> auth.uid() or not (t.due_at < now())
       or t.waived_at is not null or t.paid_at is not null then
      raise exception 'This penalty cannot be waived.';
    end if;
    update public.tasks set waived_at = now() where id = t.id;
  elsif t.assignee_id <> auth.uid() then
    raise exception 'Only the person responsible can do this.';
  elsif action = 'accept' and t.accepted_at is null
        and t.declined_at is null and t.cancelled_at is null and t.due_at > now() then
    update public.tasks set accepted_at = now() where id = t.id;
  elsif action = 'decline' and t.accepted_at is null
        and t.declined_at is null and t.cancelled_at is null then
    update public.tasks set declined_at = now() where id = t.id;
  elsif action = 'complete' and t.accepted_at is not null
        and t.completed_at is null and t.cancelled_at is null
        and t.declined_at is null then
    update public.tasks
      set completed_at = now(),
          confirmed_at = case when t.creator_id = auth.uid() then now() else null end
      where id = t.id;
  elsif action = 'paid' and t.accepted_at is not null and t.due_at < now()
        and (t.completed_at is null or t.completed_at > t.due_at)
        and t.paid_at is null and t.waived_at is null
        and t.cancelled_at is null and t.declined_at is null then
    update public.tasks set paid_at = now() where id = t.id;
  else
    raise exception 'This action is not available.';
  end if;
end;$$;

-- Leaving a space must not leave an invitation that can later connect an
-- account after the user thought the relationship was closed.
create or replace function public.leave_pair()
returns void language plpgsql security definer set search_path = '' as $$
declare c public.couples;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  update public.pair_requests
    set status = 'cancelled', responded_at = now()
    where status = 'pending' and (sender_id = auth.uid() or recipient_id = auth.uid());
  select * into c from public.couples
    where member_one = auth.uid() or member_two = auth.uid() for update;
  if c.id is null then raise exception 'You are not connected to a shared space.'; end if;
  if c.member_one = auth.uid() and c.member_two is not null then
    update public.couples set member_one = c.member_two, member_two = null where id = c.id;
  elsif c.member_one = auth.uid() then
    delete from public.couples where id = c.id;
  else
    update public.couples set member_two = null where id = c.id;
  end if;
end;$$;

revoke all on function public.cancel_pair_request(uuid), public.leave_pair() from public, anon;
grant execute on function public.cancel_pair_request(uuid), public.leave_pair() to authenticated;
notify pgrst, 'reload schema';
commit;
