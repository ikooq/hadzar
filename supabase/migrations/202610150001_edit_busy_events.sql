begin;

drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (couple_id = private.my_couple() and user_id = auth.uid() and not shared)
  with check (couple_id = private.my_couple() and user_id = auth.uid() and not shared);

grant update(title, start_min, end_min) on public.events to authenticated;

commit;
