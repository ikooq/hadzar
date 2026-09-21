-- Follow-through for shared plans and transparent commitment renegotiation.
begin;

create or replace function public.complete_plan(plan_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  update public.events
    set plan_status = 'completed'
    where id = plan_id
      and couple_id = private.my_couple()
      and shared
      and user_id = auth.uid()
      and plan_status = 'accepted';
  if not found then
    raise exception 'Only the person who proposed an accepted plan can mark it as happened.';
  end if;
end;$$;

create or replace function public.renegotiate_task(
  task_id uuid,
  new_deadline timestamptz,
  new_penalty integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  if new_deadline <= now() then raise exception 'Choose a future deadline.'; end if;
  if new_penalty not between 0 and 1000000 then raise exception 'Choose a valid penalty.'; end if;
  select * into t from public.tasks
    where id = task_id and couple_id = private.my_couple() for update;
  if t.id is null or t.creator_id <> auth.uid() then
    raise exception 'Only the person who made this commitment can change its terms.';
  end if;
  if t.completed_at is not null or t.cancelled_at is not null or t.declined_at is not null then
    raise exception 'This commitment is already closed.';
  end if;
  update public.tasks set
    due_at = new_deadline,
    penalty = new_penalty,
    accepted_at = case when assignee_id = auth.uid() then coalesce(accepted_at, now()) else null end
    where id = t.id;
end;$$;

revoke all on function public.complete_plan(uuid), public.renegotiate_task(uuid,timestamptz,integer) from public, anon;
grant execute on function public.complete_plan(uuid), public.renegotiate_task(uuid,timestamptz,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
