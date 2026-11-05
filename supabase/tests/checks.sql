-- Checks for supabase/migrations, run by test/sql.test.js on a throwaway local Postgres.
-- Each check raises an exception when it fails.
\set ON_ERROR_STOP 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
insert into auth.sessions values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
                                 ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

-- user 1 signs in
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect(public.set_key_check('check-1') = true, 'first computer stores the key check');
select pg_temp.expect(public.set_key_check('check-2') = false, 'a second computer does not replace it');
select pg_temp.expect((select key_check from public.profiles) = 'check-1', 'the stored check is the first one');

select pg_temp.expect(public.push_items('[{"id":"a","base":0,"data":"v1.AAA","device":"pc"},{"id":"b","base":0,"data":"v1.BBB","device":"pc"}]')
  = '[{"id":"a","ok":true,"rev":1},{"id":"b","ok":true,"rev":2}]'::jsonb, 'new rows get rev 1 and 2');
select pg_temp.expect((public.push_items('[{"id":"a","base":0,"data":"v1.STALE","device":"mac"}]')->0->>'ok')::boolean = false, 'a push from a stale base is turned down');
select pg_temp.expect(public.push_items('[{"id":"a","base":0,"data":"v1.STALE","device":"mac"}]')->0->'row'->>'data' = 'v1.AAA', 'and carries the server row');
select pg_temp.expect(public.push_items('[{"id":"a","base":1,"data":"v1.A2","device":"mac"}]') = '[{"id":"a","ok":true,"rev":3}]'::jsonb, 'a push from the current base goes in');
select pg_temp.expect(public.push_items('[{"id":"b","base":2,"deleted":true,"data":"ignored","device":"mac"}]') = '[{"id":"b","ok":true,"rev":4}]'::jsonb, 'a delete goes in');
select pg_temp.expect((select data is null and deleted from public.items where id = 'b'), 'a deleted row keeps no data');
select pg_temp.expect((select string_agg(id || ':' || rev, ',' order by rev) from public.items where rev > 2) = 'a:3,b:4', 'changes since rev 2, in order');
select pg_temp.expect((select last_rev from public.profiles) = 4, 'the profile counts revs');

do $$ begin insert into public.items (user_id, id, rev) values (auth.uid(), 'x', 99); raise exception 'FAILED: direct insert allowed';
exception when insufficient_privilege then raise notice 'ok: rows can only be written through push_items'; end $$;
do $$ begin update public.items set data = 'evil'; if found then raise exception 'FAILED: direct update allowed'; end if; raise notice 'ok: direct updates change nothing';
exception when insufficient_privilege then raise notice 'ok: direct updates refused'; end $$;
do $$ begin perform public.push_items((select jsonb_agg(jsonb_build_object('id', 'n' || g, 'base', 0, 'data', 'x')) from generate_series(1, 501) g));
raise exception 'FAILED: 501 changes accepted'; exception when raise_exception then
  if sqlerrm like 'FAILED%' then raise; end if; raise notice 'ok: at most 500 changes per push'; end $$;

insert into public.devices (user_id, id, name, platform, session_id) values (auth.uid(), 'mac-1', 'v1.NAME', 'mac', 'aaaaaaaa-0000-0000-0000-000000000002');
select public.sign_out_device('mac-1');
reset role;
select pg_temp.expect((select count(*) from auth.sessions) = 1, 'signing a computer out ends its session only');

-- user 2 sees nothing of user 1
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.expect((select count(*) from public.items) = 0, 'another account sees none of the rows');
select pg_temp.expect((select count(*) from public.profiles) = 0, 'or the profile');
select pg_temp.expect(public.push_items('[{"id":"a","base":0,"data":"v1.MINE","device":"x"}]') = '[{"id":"a","ok":true,"rev":1}]'::jsonb, 'the same id in another account is its own row');
do $$ begin insert into public.devices (user_id, id, platform) values ('11111111-1111-1111-1111-111111111111', 'sneaky', 'win'); raise exception 'FAILED: device row for another account';
exception when insufficient_privilege then raise notice 'ok: devices only for your own account'; end $$;

-- not signed in
set role anon;
reset request.jwt.claim.sub;
do $$ begin perform public.push_items('[]'); raise exception 'FAILED: anon may push';
exception when insufficient_privilege then raise notice 'ok: not signed in, no push'; end $$;
do $$ begin perform count(*) from public.items; raise exception 'FAILED: anon may read';
exception when insufficient_privilege then raise notice 'ok: not signed in, no reading'; end $$;

-- user 1 deletes the account
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.delete_account();
reset role;
select pg_temp.expect((select count(*) from auth.users) = 1 and (select count(*) from public.items where user_id = '11111111-1111-1111-1111-111111111111') = 0
  and (select count(*) from public.profiles where user_id = '11111111-1111-1111-1111-111111111111') = 0, 'deleting the account takes everything with it');
select pg_temp.expect((select count(*) from public.items) = 1, 'the other account is untouched');
select pg_temp.expect((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'items') = 1, 'items changes are published for realtime');
