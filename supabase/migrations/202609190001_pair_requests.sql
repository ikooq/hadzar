-- Pair requests let an existing hadzar profile connect by nickname.
create table public.pair_requests (
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
create index idx_pair_requests_recipient on public.pair_requests(recipient_id, status, created_at desc);
create index idx_pair_requests_sender on public.pair_requests(sender_id, status, created_at desc);
create unique index idx_pair_requests_pending_unique
  on public.pair_requests(sender_id, recipient_id) where status = 'pending';

alter table public.pair_requests enable row level security;
create policy pair_requests_read on public.pair_requests
  for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

create function public.send_pair_request(recipient_nickname text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  sender public.profiles;
  recipient public.profiles;
  sender_couple public.couples;
  result uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  select * into sender from public.profiles where id = auth.uid();
  if sender.id is null then raise exception 'Complete your profile first.'; end if;
  select * into recipient from public.profiles where nickname = lower(trim(recipient_nickname));
  if recipient.id is null then raise exception 'No hadzar account uses that nickname.'; end if;
  if recipient.id = auth.uid() then raise exception 'Choose your partner’s nickname.'; end if;
  if exists(select 1 from public.couples where member_one = recipient.id or member_two = recipient.id) then
    raise exception 'That person is already in a pair.';
  end if;
  select * into sender_couple from public.couples
    where member_one = auth.uid() or member_two = auth.uid() limit 1;
  if sender_couple.id is not null and sender_couple.member_two is not null then
    raise exception 'You already belong to a pair.';
  end if;
  select id into result from public.pair_requests
    where sender_id = auth.uid() and recipient_id = recipient.id and status = 'pending';
  if result is not null then return result; end if;
  insert into public.pair_requests(sender_id, recipient_id, sender_name, sender_nickname)
    values (auth.uid(), recipient.id, sender.name, sender.nickname)
    returning id into result;
  return result;
end;$$;

create function public.accept_pair_request(request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  request_row public.pair_requests;
  sender_couple public.couples;
  result uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  select * into request_row from public.pair_requests
    where id = request_id and recipient_id = auth.uid() and status = 'pending' for update;
  if request_row.id is null then raise exception 'This request is no longer available.'; end if;
  if private.my_couple() is not null then raise exception 'You already belong to a pair.'; end if;
  select * into sender_couple from public.couples
    where member_one = request_row.sender_id or member_two = request_row.sender_id for update;
  if sender_couple.id is null then
    insert into public.couples(member_one, member_two)
      values (request_row.sender_id, auth.uid()) returning id into result;
  elsif sender_couple.member_two is null then
    result := sender_couple.id;
    update public.couples set member_two = auth.uid() where id = result;
  else
    raise exception 'Your partner is already in a pair.';
  end if;
  update public.pair_requests set status = 'accepted', responded_at = now() where id = request_row.id;
  update public.pair_requests set status = 'declined', responded_at = now()
    where status = 'pending' and (sender_id = auth.uid() or recipient_id = auth.uid()) and id <> request_row.id;
  return result;
end;$$;

create function public.decline_pair_request(request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  update public.pair_requests set status = 'declined', responded_at = now()
    where id = request_id and recipient_id = auth.uid() and status = 'pending';
  if not found then raise exception 'This request is no longer available.'; end if;
end;$$;

revoke all on public.pair_requests from anon, authenticated;
grant select on public.pair_requests to authenticated;
revoke all on function public.send_pair_request(text), public.accept_pair_request(uuid), public.decline_pair_request(uuid) from public, anon;
grant execute on function public.send_pair_request(text), public.accept_pair_request(uuid), public.decline_pair_request(uuid) to authenticated;
