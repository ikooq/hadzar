-- Run this complete file in the existing hadzar project's SQL Editor.
-- Safe both with and without the earlier pair_requests migration, and on rerun.
begin;

create table if not exists public.pair_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null,
  sender_nickname text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> recipient_id)
);
create index if not exists idx_pair_requests_recipient on public.pair_requests(recipient_id, status, created_at desc);
create index if not exists idx_pair_requests_sender on public.pair_requests(sender_id, status, created_at desc);
create unique index if not exists idx_pair_requests_pending_unique
  on public.pair_requests(sender_id, recipient_id) where status = 'pending';
alter table public.pair_requests enable row level security;
drop policy if exists pair_requests_read on public.pair_requests;
create policy pair_requests_read on public.pair_requests for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

-- Only the public consent-checked RPCs may call this helper.
-- Callers hold both profile locks before entering it.
create or replace function private.connect_pair(first_user uuid, second_user uuid)
returns uuid language plpgsql set search_path = '' as $$
declare
  first_space public.couples;
  second_space public.couples;
  result uuid;
begin
  if first_user is null or second_user is null or first_user = second_user then raise exception 'Choose your partner’s account.'; end if;
  perform id from public.couples
    where member_one in (first_user, second_user) or member_two in (first_user, second_user)
    order by id for update;
  select * into first_space from public.couples where member_one = first_user or member_two = first_user;
  select * into second_space from public.couples where member_one = second_user or member_two = second_user;
  if first_space.member_two is not null or second_space.member_two is not null then
    raise exception 'One of you already belongs to a pair with a partner.';
  end if;
  if first_space.id is not null and second_space.id is not null then
    -- Avoid silently changing the meaning of existing local schedule times.
    if first_space.timezone <> second_space.timezone and (
      exists(select 1 from public.events where couple_id = second_space.id) or
      exists(select 1 from public.schedule_days where couple_id = second_space.id)
    ) then
      raise exception 'Your spaces use different time zones. Choose the same shared timezone in Settings before joining.';
    end if;
    update public.events set couple_id = first_space.id where couple_id = second_space.id;
    update public.schedule_days set couple_id = first_space.id where couple_id = second_space.id;
    update public.tasks set couple_id = first_space.id where couple_id = second_space.id;
    update public.notes set couple_id = first_space.id where couple_id = second_space.id;
    update public.messages set couple_id = first_space.id where couple_id = second_space.id;
    -- All content has moved; only the empty solo container and its invite go away.
    delete from public.couples where id = second_space.id;
  end if;
  if first_space.id is not null then
    result := first_space.id;
    update public.couples set member_two = second_user where id = result;
  elsif second_space.id is not null then
    result := second_space.id;
    update public.couples set member_two = first_user where id = result;
  else
    insert into public.couples(member_one, member_two) values(first_user, second_user) returning id into result;
  end if;
  delete from private.invitations where couple_id = result;
  return result;
end;$$;
revoke all on function private.connect_pair(uuid,uuid) from public, anon, authenticated;

create or replace function public.send_pair_request(recipient_nickname text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  sender public.profiles;
  recipient public.profiles;
  result uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  select * into recipient from public.profiles where nickname = lower(ltrim(trim(recipient_nickname), '@'));
  if recipient.id is null then raise exception 'No hadzar account uses that nickname.'; end if;
  if recipient.id = auth.uid() then raise exception 'Choose your partner’s nickname.'; end if;
  perform id from public.profiles where id in (auth.uid(), recipient.id) order by id for no key update;
  select * into sender from public.profiles where id = auth.uid();
  if sender.id is null then raise exception 'Complete your profile first.'; end if;
  if exists(select 1 from public.couples where member_two is not null and
    (member_one in (sender.id, recipient.id) or member_two in (sender.id, recipient.id))) then
    raise exception 'One of you already belongs to a pair with a partner.';
  end if;
  insert into public.pair_requests(sender_id, recipient_id, sender_name, sender_nickname)
    values(sender.id, recipient.id, sender.name, sender.nickname)
    on conflict(sender_id, recipient_id) where status = 'pending'
    do update set sender_name = excluded.sender_name, sender_nickname = excluded.sender_nickname
    returning id into result;
  return result;
end;$$;

create or replace function public.accept_pair_request(request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  request_row public.pair_requests;
  result uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  select * into request_row from public.pair_requests where id = request_id and recipient_id = auth.uid();
  if request_row.id is null then raise exception 'This request is no longer available.'; end if;
  perform id from public.profiles where id in (request_row.sender_id, auth.uid()) order by id for no key update;
  -- Lock related requests in a stable order, including reciprocal invitations.
  perform id from public.pair_requests where id = request_id or (status = 'pending' and
    (sender_id in (request_row.sender_id, auth.uid()) or recipient_id in (request_row.sender_id, auth.uid())))
    order by id for update;
  select * into request_row from public.pair_requests where id = request_id and recipient_id = auth.uid();
  if request_row.id is null then raise exception 'This request is no longer available.'; end if;
  if request_row.status = 'accepted' then
    select id into result from public.couples where
      (member_one = request_row.sender_id and member_two = auth.uid()) or
      (member_two = request_row.sender_id and member_one = auth.uid());
    if result is not null then return result; end if;
  end if;
  if request_row.status is distinct from 'pending' then raise exception 'This request is no longer available.'; end if;
  result := private.connect_pair(request_row.sender_id, auth.uid());
  update public.pair_requests set status = 'accepted', responded_at = now() where id = request_id;
  update public.pair_requests set status = 'declined', responded_at = now() where status = 'pending' and
    (sender_id in (request_row.sender_id, auth.uid()) or recipient_id in (request_row.sender_id, auth.uid()));
  return result;
end;$$;

create or replace function public.decline_pair_request(request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  update public.pair_requests set status = 'declined', responded_at = now()
    where id = request_id and recipient_id = auth.uid() and status = 'pending';
  if not found then raise exception 'This request is no longer available.'; end if;
end;$$;

create or replace function public.join_pair(invite_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target_id uuid;
  inviter uuid;
  result uuid;
  token_hash text := encode(sha256(convert_to(trim(invite_code), 'UTF8')), 'hex');
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  select c.id, c.member_one into target_id, inviter from private.invitations i
    join public.couples c on c.id = i.couple_id where i.code_hash = token_hash and i.expires_at > now();
  if target_id is null then raise exception 'This invitation is invalid or has expired.'; end if;
  if inviter = auth.uid() then raise exception 'This is your own invitation. Send it to your partner.'; end if;
  perform id from public.profiles where id in (inviter, auth.uid()) order by id for no key update;
  if not exists(select 1 from public.profiles where id = auth.uid()) then raise exception 'Complete your profile first.'; end if;
  perform id from public.pair_requests where status = 'pending' and
    (sender_id in (inviter, auth.uid()) or recipient_id in (inviter, auth.uid())) order by id for update;
  perform id from public.couples where member_one in (inviter, auth.uid()) or member_two in (inviter, auth.uid()) order by id for update;
  if not exists(select 1 from private.invitations i join public.couples c on c.id = i.couple_id
    where c.id = target_id and c.member_one = inviter and i.code_hash = token_hash and i.expires_at > now()) then
    raise exception 'This invitation is invalid or has expired.';
  end if;
  result := private.connect_pair(inviter, auth.uid());
  update public.pair_requests set status = 'declined', responded_at = now() where status = 'pending' and
    (sender_id in (inviter, auth.uid()) or recipient_id in (inviter, auth.uid()));
  return result;
end;$$;

revoke all on public.pair_requests from anon, authenticated;
grant select on public.pair_requests to authenticated;
revoke all on function public.send_pair_request(text), public.accept_pair_request(uuid), public.decline_pair_request(uuid), public.join_pair(text) from public, anon;
grant execute on function public.send_pair_request(text), public.accept_pair_request(uuid), public.decline_pair_request(uuid), public.join_pair(text) to authenticated;
notify pgrst, 'reload schema';
commit;
