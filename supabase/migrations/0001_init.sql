-- KeyBridge cloud: each account's shortcuts, groups and trash, sealed on the computers with the
-- account code (src/main/vault.js) - the server only ever holds ciphertext.
-- Run once in the Supabase SQL editor of the project.

-- One profile per account.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- A known value sealed with the account code: lets a new computer tell a wrong code from the right one.
  key_check text check (key_check is null or char_length(key_check) <= 1000),
  -- Grows with every change to the account's items (see push_items).
  last_rev bigint not null default 0,
  created_at timestamptz not null default now()
);

-- One row per shortcut, group or trash entry. `data` is sealed; deleted rows stay as markers so
-- every computer learns about the delete.
create table public.items (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  rev bigint not null,
  data text check (data is null or char_length(data) <= 200000),
  deleted boolean not null default false,
  device text not null default '' check (char_length(device) <= 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index items_user_rev on public.items (user_id, rev);

-- The account's computers, for "Devices" and "Sign this computer out". The name is sealed too.
create table public.devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  name text check (name is null or char_length(name) <= 2000),
  platform text not null check (platform in ('win', 'mac')),
  session_id uuid,
  last_seen timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.devices enable row level security;

-- Each account sees only its own rows. Items and profiles change only through the functions below.
create policy "own profile" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own items" on public.items for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own devices" on public.devices for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.profiles, public.items, public.devices from anon;

-- The first computer stores the key check. Returns false when the account already has one: then
-- this computer asks for the code and checks it against the stored value.
create function public.set_key_check(check_value text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  insert into public.profiles (user_id, key_check) values (uid, check_value)
  on conflict (user_id) do update set key_check = excluded.key_check
    where public.profiles.key_check is null;
  return found;
end $$;

-- Saves changes from one computer: [{ id, base, data, deleted, device }]. A change goes in only if
-- the row is still at `base` (the rev that computer last saw; 0 for a new row). Otherwise the reply
-- carries the server's row and the computer settles the conflict. Pushes of one account run one at
-- a time, so revs become visible in order.
create function public.push_items(changes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  change jsonb;
  cur public.items%rowtype;
  next_rev bigint;
  total bigint;
  is_deleted boolean;
  replies jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 500 then
    raise exception 'send at most 500 changes at a time';
  end if;
  insert into public.profiles (user_id) values (uid) on conflict (user_id) do nothing;
  select p.last_rev into next_rev from public.profiles p where p.user_id = uid for update;
  select count(*) into total from public.items i where i.user_id = uid;

  for change in select value from jsonb_array_elements(changes) loop
    select * into cur from public.items i where i.user_id = uid and i.id = change->>'id';
    if found and cur.rev <> coalesce((change->>'base')::bigint, 0) then
      replies := replies || jsonb_build_array(jsonb_build_object('id', cur.id, 'ok', false, 'row',
        jsonb_build_object('id', cur.id, 'rev', cur.rev, 'data', cur.data, 'deleted', cur.deleted, 'device', cur.device)));
      continue;
    end if;
    if not found then
      total := total + 1;
      if total > 20000 then raise exception 'too many items in this account'; end if;
    end if;
    next_rev := next_rev + 1;
    is_deleted := coalesce((change->>'deleted')::boolean, false);
    insert into public.items (user_id, id, rev, data, deleted, device, updated_at)
    values (uid, change->>'id', next_rev, case when is_deleted then null else change->>'data' end,
            is_deleted, coalesce(change->>'device', ''), now())
    on conflict (user_id, id) do update
      set rev = excluded.rev, data = excluded.data, deleted = excluded.deleted,
          device = excluded.device, updated_at = excluded.updated_at;
    replies := replies || jsonb_build_array(jsonb_build_object('id', change->>'id', 'ok', true, 'rev', next_rev));
  end loop;

  update public.profiles set last_rev = next_rev where user_id = uid;
  return replies;
end $$;

-- Signs one of the account's other computers out: its session ends, so it can't sync any more.
create function public.sign_out_device(device_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from auth.sessions s using public.devices d
  where d.user_id = uid and d.id = device_id and s.id = d.session_id and s.user_id = uid;
  delete from public.devices where user_id = uid and id = device_id;
end $$;

-- Deletes the account and everything in it (profiles, items and devices go with it).
create function public.delete_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function public.set_key_check(text), public.push_items(jsonb),
  public.sign_out_device(text), public.delete_account() from public, anon;
grant execute on function public.set_key_check(text), public.push_items(jsonb),
  public.sign_out_device(text), public.delete_account() to authenticated;

-- A change to an account's items nudges its other computers to sync right away.
alter publication supabase_realtime add table public.items;
