-- Run once in a new Supabase project. All application data is protected by RLS.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check (char_length(name) between 1 and 50),
 nickname text not null unique check (nickname ~ '^[a-z0-9_]{3,24}$'),
 created_at timestamptz not null default now()
);
create table public.couples (
 id uuid primary key default gen_random_uuid(),
 member_one uuid not null unique references public.profiles(id),
 member_two uuid unique references public.profiles(id),
 timezone text not null default 'Asia/Almaty',
 day_start integer not null default 480 check(day_start between 0 and 1380),
 day_end integer not null default 1320 check(day_end between 60 and 1440),
 minimum_window integer not null default 30 check(minimum_window between 15 and 240),
 buffer integer not null default 0 check(buffer between 0 and 120),
 default_penalty integer not null default 2500 check(default_penalty between 0 and 1000000),
 check(member_two is null or member_one<>member_two),check(day_end>day_start)
);
create table private.invitations (
 couple_id uuid primary key references public.couples(id) on delete cascade,
 code_hash text not null unique,expires_at timestamptz not null
);
create function private.my_couple() returns uuid language sql stable security definer set search_path='' as $$
 select id from public.couples where member_one=auth.uid() or member_two=auth.uid() limit 1;
$$;
create function private.is_partner(who uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.couples where id=private.my_couple() and who in(member_one,member_two));
$$;
create table public.events (
 id uuid primary key default gen_random_uuid(),couple_id uuid not null references public.couples(id) on delete cascade,
 user_id uuid not null references public.profiles(id),day date not null,
 title text not null check(char_length(title) between 1 and 120),
 start_min integer not null check(start_min between 0 and 1439),
 end_min integer not null check(end_min between 1 and 1440),
 shared boolean not null default false,check(end_min>start_min)
);
create index idx_events_couple_day on public.events(couple_id,day);
create table public.schedule_days (
 couple_id uuid not null references public.couples(id) on delete cascade,
 user_id uuid not null references public.profiles(id),day date not null,
 primary key(user_id,day)
);
create index idx_days_couple_day on public.schedule_days(couple_id,day);
create table public.tasks (
 id uuid primary key default gen_random_uuid(),couple_id uuid not null references public.couples(id) on delete cascade,
 creator_id uuid not null references public.profiles(id),assignee_id uuid not null references public.profiles(id),
 title text not null check(char_length(title) between 1 and 120),description text not null default '' check(char_length(description)<=2000),
 due_at timestamptz not null,penalty integer not null check(penalty between 0 and 1000000),
 accepted_at timestamptz,completed_at timestamptz,paid_at timestamptz,created_at timestamptz not null default now()
);
create index idx_tasks_couple_due on public.tasks(couple_id,due_at);
create table public.notes (
 id uuid primary key default gen_random_uuid(),couple_id uuid not null references public.couples(id) on delete cascade,
 author_id uuid not null references public.profiles(id),title text not null check(char_length(title) between 1 and 120),
 body text not null default '' check(char_length(body)<=10000),pinned boolean not null default false,created_at timestamptz not null default now()
);
create index idx_notes_couple_created on public.notes(couple_id,created_at desc);
create table public.messages (
 id uuid primary key default gen_random_uuid(),couple_id uuid not null references public.couples(id) on delete cascade,
 sender_id uuid not null references public.profiles(id),body text not null check(char_length(body) between 1 and 4000),created_at timestamptz not null default now()
);
create index idx_messages_couple_created on public.messages(couple_id,created_at desc);

alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.events enable row level security;
alter table public.schedule_days enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;
alter table public.messages enable row level security;
alter table private.invitations enable row level security;

create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or private.is_partner(id));
create policy profiles_insert on public.profiles for insert to authenticated with check(id=auth.uid());
create policy profiles_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy couples_read on public.couples for select to authenticated using(id=private.my_couple());
create policy events_read on public.events for select to authenticated using(couple_id=private.my_couple());
create policy events_insert on public.events for insert to authenticated with check(couple_id=private.my_couple() and user_id=auth.uid() and not shared);
create policy events_delete on public.events for delete to authenticated using(couple_id=private.my_couple() and user_id=auth.uid());
create policy days_read on public.schedule_days for select to authenticated using(couple_id=private.my_couple());
create policy days_insert on public.schedule_days for insert to authenticated with check(couple_id=private.my_couple() and user_id=auth.uid());
create policy days_delete on public.schedule_days for delete to authenticated using(couple_id=private.my_couple() and user_id=auth.uid());
create policy tasks_read on public.tasks for select to authenticated using(couple_id=private.my_couple());
create policy notes_read on public.notes for select to authenticated using(couple_id=private.my_couple());
create policy notes_insert on public.notes for insert to authenticated with check(couple_id=private.my_couple() and author_id=auth.uid());
create policy notes_update on public.notes for update to authenticated using(couple_id=private.my_couple()) with check(couple_id=private.my_couple() and private.is_partner(author_id));
create policy notes_delete on public.notes for delete to authenticated using(couple_id=private.my_couple());
create policy messages_read on public.messages for select to authenticated using(couple_id=private.my_couple());
create policy messages_insert on public.messages for insert to authenticated with check(couple_id=private.my_couple() and sender_id=auth.uid());

-- All membership transitions lock the profile, preventing cross-couple races.
create function public.create_pair() returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null then raise exception 'Please sign in.'; end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 if not found then raise exception 'Complete your profile first.'; end if;
 if private.my_couple() is not null then raise exception 'You already belong to a pair.'; end if;
 insert into public.couples(member_one) values(auth.uid()) returning id into result;
 return result;
end;$$;
create function public.create_invitation() returns text language plpgsql security definer set search_path='' as $$
declare c public.couples;code text;
begin
 select * into c from public.couples where id=private.my_couple() for update;
 if c.id is null or c.member_one<>auth.uid() or c.member_two is not null then raise exception 'An invitation is not available for this pair.'; end if;
 code:=replace(gen_random_uuid()::text,'-','');
 insert into private.invitations(couple_id,code_hash,expires_at) values(c.id,encode(sha256(convert_to(code,'UTF8')),'hex'),now()+interval '7 days')
 on conflict(couple_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at;
 return code;
end;$$;
create function public.join_pair(invite_code text) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid;other uuid;
begin
 if auth.uid() is null then raise exception 'Please sign in.'; end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 if not found then raise exception 'Complete your profile first.'; end if;
 if private.my_couple() is not null then raise exception 'You already belong to a pair.'; end if;
 select couple_id into cid from private.invitations where code_hash=encode(sha256(convert_to(trim(invite_code),'UTF8')),'hex') and expires_at>now();
 if cid is null then raise exception 'This invitation is invalid or has expired.'; end if;
 select member_two into other from public.couples where id=cid for update;
 if other is not null then raise exception 'This pair already has two people.'; end if;
 -- Check again after acquiring the couple lock, in case the invitation was rotated.
 if not exists(select 1 from private.invitations where couple_id=cid and code_hash=encode(sha256(convert_to(trim(invite_code),'UTF8')),'hex') and expires_at>now()) then raise exception 'This invitation has expired.'; end if;
 update public.couples set member_two=auth.uid() where id=cid;
 delete from private.invitations where couple_id=cid;
 return cid;
end;$$;
create function public.save_pair_settings(tz text,start_at integer,end_at integer,min_window integer,travel_buffer integer,default_fee integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if private.my_couple() is null then raise exception 'Join a pair first.'; end if;
 if not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'Choose a valid timezone.'; end if;
 update public.couples set timezone=tz,day_start=start_at,day_end=end_at,minimum_window=min_window,buffer=travel_buffer,default_penalty=default_fee where id=private.my_couple();
end;$$;
create function public.add_task(task_title text,task_description text,assigned_to uuid,deadline timestamptz,fee integer) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if private.my_couple() is null or not private.is_partner(assigned_to) then raise exception 'Choose someone in your pair.'; end if;
 if deadline<=now() then raise exception 'Choose a future deadline.'; end if;
 insert into public.tasks(couple_id,creator_id,assignee_id,title,description,due_at,penalty,accepted_at)
 values(private.my_couple(),auth.uid(),assigned_to,task_title,task_description,deadline,fee,case when assigned_to=auth.uid() then now() else null end) returning id into result;
 return result;
end;$$;
create function public.act_on_task(task_id uuid,action text) returns void language plpgsql security definer set search_path='' as $$
declare t public.tasks;
begin
 select * into t from public.tasks where id=task_id and couple_id=private.my_couple() for update;
 if t.id is null or t.assignee_id<>auth.uid() then raise exception 'Only the person responsible can do this.'; end if;
 if action='accept' and t.accepted_at is null and t.due_at>now() then update public.tasks set accepted_at=now() where id=t.id;
 elsif action='decline' and t.accepted_at is null then delete from public.tasks where id=t.id;
 elsif action='complete' and t.accepted_at is not null and t.completed_at is null then update public.tasks set completed_at=now() where id=t.id;
 elsif action='paid' and t.accepted_at is not null and t.due_at<now() and (t.completed_at is null or t.completed_at>t.due_at) and t.paid_at is null then update public.tasks set paid_at=now() where id=t.id;
 else raise exception 'This action is not available.';
 end if;
end;$$;
-- Narrow grants: there is no client-side bypass for membership or task state.
create function public.plan_window(event_day date,start_at integer,end_at integer,event_title text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.couples;result uuid;
begin
 select * into c from public.couples where id=private.my_couple() for update;
 if c.id is null or c.member_two is null then raise exception 'Your partner needs to join first.'; end if;
 if (select count(*) from public.schedule_days where couple_id=c.id and day=event_day)<>2 then raise exception 'Both schedules need to be confirmed for this day.'; end if;
 if start_at<c.day_start or end_at>c.day_end or end_at-start_at<c.minimum_window then raise exception 'Choose a window within your shared hours.'; end if;
 if exists(select 1 from public.events where couple_id=c.id and day=event_day and start_min-c.buffer<end_at and end_min+c.buffer>start_at) then raise exception 'Your schedules changed. Please choose another window.'; end if;
 insert into public.events(couple_id,user_id,day,title,start_min,end_min,shared) values(c.id,auth.uid(),event_day,event_title,start_at,end_at,true) returning id into result;
 return result;
end;$$;
revoke all on function public.plan_window(date,integer,integer,text) from public,anon;
grant execute on function public.plan_window(date,integer,integer,text) to authenticated;
revoke all on public.profiles,public.couples,public.events,public.schedule_days,public.tasks,public.notes,public.messages from anon,authenticated;
grant select on public.profiles,public.couples,public.events,public.schedule_days,public.tasks,public.notes,public.messages to authenticated;
grant insert on public.profiles,public.events,public.schedule_days,public.notes,public.messages to authenticated;
grant update(name,nickname) on public.profiles to authenticated;
grant update(title,body,pinned) on public.notes to authenticated;
grant delete on public.events,public.schedule_days,public.notes to authenticated;
revoke all on function public.create_pair(),public.create_invitation(),public.join_pair(text),public.save_pair_settings(text,integer,integer,integer,integer,integer),public.add_task(text,text,uuid,timestamptz,integer),public.act_on_task(uuid,text) from public,anon;
grant execute on function public.create_pair(),public.create_invitation(),public.join_pair(text),public.save_pair_settings(text,integer,integer,integer,integer,integer),public.add_task(text,text,uuid,timestamptz,integer),public.act_on_task(uuid,text) to authenticated;
revoke all on function private.my_couple(),private.is_partner(uuid) from public,anon;
grant execute on function private.my_couple(),private.is_partner(uuid) to authenticated;
