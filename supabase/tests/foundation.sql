-- Run as local database owner, after the migration. Roll back all fixtures.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'FAIL: %', label; end if;
 raise notice 'PASS: %', label;
end $$;
create function pg_temp.expect_error(command text, expected_state text) returns void language plpgsql as $$
begin
 begin
  execute command;
 exception when others then
  if sqlstate = expected_state then
   raise notice 'PASS: rejected with %', sqlstate;
   return;
  end if;
  raise;
 end;
 raise exception 'FAIL: command unexpectedly succeeded: %', command;
end $$;
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
insert into public.profiles(id) values (auth.uid());
insert into public.pipes(id,brand,model,status,filter,legacy_payload)
values ('legacy-id', '', 'Model', 'future_status', 'future_filter', '{"unknown":42,"date":"nonstandard"}');
insert into public.tobaccos(id,brand,name) values ('t','Brand','Blend');
insert into public.cigars(id,brand,name) values ('c','Brand','Cigar');
insert into public.smoking_sessions(id,kind,pipe_id,tobacco_id) values ('s','pipe','legacy-id','t');
insert into public.smoking_sessions(id,kind,cigar_id) values ('sc','cigar','c');
insert into public.media(id,object_path,mime_type,size_bytes,pipe_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',auth.uid()::text || '/photo.jpg','image/jpeg',123,'legacy-id');
insert into storage.objects(bucket_id,name) values ('journal-photos',auth.uid()::text || '/photo.jpg');
select pg_temp.expect_error($q$insert into public.pipes(id,user_id,brand,model) values ('forged','22222222-2222-2222-2222-222222222222','B','M')$q$, '42501');
select pg_temp.expect_error($q$update public.pipes set user_id = '22222222-2222-2222-2222-222222222222'$q$, '42501');
select pg_temp.expect_error($q$insert into public.pipes(brand,model,price) values ('B','M',-1)$q$, '23514');
select pg_temp.expect_error($q$insert into public.pipes(brand,model,price) values ('B','M','NaN')$q$, '23514');
select pg_temp.expect_error($q$insert into public.smoking_sessions(kind,pipe_id,cigar_id) values ('pipe','legacy-id','c')$q$, '23514');
select pg_temp.expect_error($q$insert into public.smoking_sessions(kind,pipe_id,started_at,ended_at) values ('pipe','legacy-id','2026-01-02','2026-01-01')$q$, '23514');
select pg_temp.expect_error($q$insert into public.media(object_path,mime_type,size_bytes,pipe_id) values ('11111111-1111-1111-1111-111111111111/x','image/jpeg',3145729,'legacy-id')$q$, '23514');
select pg_temp.expect_error($q$delete from public.pipes where id='legacy-id'$q$, '23503');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
insert into public.profiles(id) values (auth.uid());
select pg_temp.assert_true((select count(*) = 1 from public.profiles), 'profile isolation');
select pg_temp.assert_true((select count(*) = 0 from public.pipes), 'pipe isolation');
select pg_temp.assert_true((select count(*) = 0 from public.tobaccos), 'tobacco isolation');
select pg_temp.assert_true((select count(*) = 0 from public.cigars), 'cigar isolation');
select pg_temp.assert_true((select count(*) = 0 from public.smoking_sessions), 'session isolation');
select pg_temp.assert_true((select count(*) = 0 from public.media), 'media isolation');
select pg_temp.assert_true((select count(*) = 0 from storage.objects), 'photo isolation');
with changed as (update public.pipes set model='stolen' returning *)
select pg_temp.assert_true((select count(*) = 0 from changed), 'foreign update invisible');
with removed as (delete from public.pipes returning *)
select pg_temp.assert_true((select count(*) = 0 from removed), 'foreign delete invisible');
select pg_temp.expect_error($q$insert into public.smoking_sessions(kind,pipe_id) values ('pipe','legacy-id')$q$, '23503');
select pg_temp.expect_error($q$insert into public.media(object_path,mime_type,size_bytes,pipe_id) values ('22222222-2222-2222-2222-222222222222/x','image/png',1,'legacy-id')$q$, '23503');
select pg_temp.expect_error($q$insert into storage.objects(bucket_id,name) values ('journal-photos','11111111-1111-1111-1111-111111111111/stolen.jpg')$q$, '42501');
-- Shared policy contract: every entity rejects forged owners and hides foreign writes.
do $$
declare t text; n integer;
begin
 foreach t in array array['profiles','pipes','tobaccos','cigars','smoking_sessions','media'] loop
  execute format('update public.%I set updated_at = now() where %I = $1', t,
    case when t = 'profiles' then 'id' else 'user_id' end)
    using '11111111-1111-1111-1111-111111111111'::uuid;
  get diagnostics n = row_count;
  perform pg_temp.assert_true(n = 0, t || ' foreign update blocked');
  execute format('delete from public.%I where %I = $1', t,
    case when t = 'profiles' then 'id' else 'user_id' end)
    using '11111111-1111-1111-1111-111111111111'::uuid;
  get diagnostics n = row_count;
  perform pg_temp.assert_true(n = 0, t || ' foreign delete blocked');
 end loop;
end $$;
select pg_temp.expect_error($q$insert into public.profiles(id) values ('33333333-3333-3333-3333-333333333333')$q$, '42501');
select pg_temp.expect_error($q$insert into public.tobaccos(user_id,brand,name) values ('11111111-1111-1111-1111-111111111111','B','N')$q$, '42501');
select pg_temp.expect_error($q$insert into public.cigars(user_id,brand,name) values ('11111111-1111-1111-1111-111111111111','B','N')$q$, '42501');
select pg_temp.expect_error($q$insert into public.smoking_sessions(user_id,kind,cigar_id) values ('11111111-1111-1111-1111-111111111111','cigar','c')$q$, '42501');
select pg_temp.expect_error($q$insert into public.media(user_id,object_path,mime_type,size_bytes,pipe_id) values ('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111/forged','image/png',1,'legacy-id')$q$, '42501');
select pg_temp.expect_error($q$insert into public.smoking_sessions(kind,cigar_id) values ('cigar','c')$q$, '23503');
insert into public.pipes(id,brand,model) values ('own-pipe','B','M');
select pg_temp.expect_error($q$insert into public.smoking_sessions(kind,pipe_id,tobacco_id) values ('pipe','own-pipe','t')$q$, '23503');
select pg_temp.expect_error($q$insert into public.media(object_path,mime_type,size_bytes,smoking_session_id) values ('22222222-2222-2222-2222-222222222222/session','image/png',1,'s')$q$, '23503');
with changed as (update storage.objects set name='22222222-2222-2222-2222-222222222222/stolen' returning *)
select pg_temp.assert_true((select count(*)=0 from changed), 'foreign photo update blocked');
with removed as (delete from storage.objects returning *)
select pg_temp.assert_true((select count(*)=0 from removed), 'foreign photo delete blocked');
delete from public.pipes where id='own-pipe';
insert into public.pipes(id,brand,model) values ('legacy-id','B','M');
select pg_temp.assert_true((select count(*)=1 from public.pipes), 'same legacy ID allowed across users');
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
update public.pipes set model='updated', updated_at='2000-01-01' where id='legacy-id';
select pg_temp.assert_true((select updated_at = now() from public.pipes where id='legacy-id'), 'timestamp trigger');
update storage.objects set name=auth.uid()::text || '/renamed.jpg';
select pg_temp.expect_error($q$update storage.objects set name='22222222-2222-2222-2222-222222222222/moved.jpg'$q$, '42501');
delete from storage.objects;
select pg_temp.assert_true((select count(*)=0 from storage.objects), 'owner photo CRUD');
delete from public.smoking_sessions;
delete from public.pipes;
select pg_temp.assert_true((select count(*)=0 from public.media), 'media metadata cascades with pipe');
set local role anon;
select pg_temp.expect_error('select * from public.pipes', '42501');
reset role;
-- Account deletion must cascade through the complete graph despite session RESTRICT.
delete from auth.users where id='22222222-2222-2222-2222-222222222222';
select pg_temp.assert_true((select count(*)=0 from public.pipes where user_id='22222222-2222-2222-2222-222222222222'), 'account deletion cascades');
select pg_temp.assert_true((select not public and file_size_limit=3145728 from storage.buckets where id='journal-photos'), 'private limited bucket');
select pg_temp.assert_true((select count(*)=6 from pg_class where relnamespace='public'::regnamespace and relrowsecurity and relforcerowsecurity), 'RLS forced on six tables');
rollback;
