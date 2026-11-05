-- What Supabase provides, reduced to what the migration uses (for test/sql.test.js).
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key);
create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users (id) on delete cascade);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create publication supabase_realtime;
