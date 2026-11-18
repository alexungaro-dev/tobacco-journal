begin;
create function pg_temp.check_journal(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
insert into public.profiles(id) values(auth.uid());
insert into public.pipes(id,brand,model) values ('p','Maker','Pipe');
insert into public.tobaccos(id,brand,name,extra) values ('t','Maker','Blend','{"remaining":27.5,"remainingLevel":"half","status":"opened"}');
insert into public.cigars(id,brand,name,extra) values ('c','Maker','Cigar','{"remaining":3}'), ('zero','Maker','Zero','{"remaining":0}'), ('unknown','Maker','Unknown','{}'), ('invalid','Maker','Invalid','{"remaining":-1}');

do $$
declare
  cigar jsonb := '{"id":"smoke-c","kind":"cigar","cigar_id":"c","started_at":"2026-11-18T19:12:00Z","rating":4,"extra":{"product":{"source":"owned","catalogueId":"c","brand":"Maker","name":"Cigar"}}}';
  pipe jsonb := '{"id":"smoke-p","kind":"pipe","tobacco_id":"t","started_at":"2026-11-18T20:12:00Z","extra":{"pipe":{"source":"gift","name":"Borrowed"},"product":{"source":"owned","catalogueId":"t","name":"Blend"}}}';
  gift jsonb := '{"id":"gift","kind":"pipe","pipe_id":"p","started_at":"2026-11-18T21:12:00Z","extra":{"pipe":{"source":"owned","catalogueId":"p","name":"Pipe"},"product":{"source":"gift","name":"Birthday blend","offeredBy":"Friend"}}}';
  stock jsonb;
  tobacco jsonb;
  unavailable text;
  debit jsonb;
  unavailable_entry jsonb;
begin
  stock := jsonb_build_object('kind','cigar','revision',(select updated_at from public.cigars where id='c'));
  -- now() is transaction-stable in this suite. Seed a distinct revision to
  -- prove that a subsequent write with the originally displayed revision fails.
  tobacco := jsonb_build_object('kind','tobacco','revision','2000-01-01T00:00:00Z','patch',jsonb_build_object('remainingLevel','empty'));
  begin
    perform public.record_smoking_session(pipe,tobacco);
    raise exception 'Stale revision accepted';
  exception when serialization_failure then
    perform pg_temp.check_journal(not exists(select 1 from public.smoking_sessions where id='smoke-p'),'stale stock rolls back session');
    perform pg_temp.check_journal(not exists(select 1 from public.smoking_session_receipts where id='smoke-p'),'stale stock rolls back receipt');
  end;
  tobacco := jsonb_set(tobacco,'{revision}',to_jsonb((select updated_at from public.tobaccos where id='t')));
  perform public.record_smoking_session(pipe,tobacco);
  perform pg_temp.check_journal((select extra @> '{"remainingLevel":"empty","remaining":27.5,"status":"opened"}' from public.tobaccos where id='t'),'tobacco patch preserves exact grams and packaging');
  perform pg_temp.check_journal((select extra->'pipe'->>'source'='gift' and pipe_id is null from public.smoking_sessions where id='smoke-p'),'borrowed pipe works with owned tobacco');

  perform public.record_smoking_session(jsonb_set(pipe,'{id}','"pipe-grams"'),
    jsonb_set(tobacco,'{patch}','{"remaining":18.5}'));
  perform pg_temp.check_journal((select extra @> '{"remainingLevel":"empty","remaining":18.5,"status":"opened"}'
    from public.tobaccos where id='t'),'exact grams can be changed without changing level or status');

  perform pg_temp.check_journal((public.record_smoking_session(cigar,stock)).extra->'stockOutcome' =
    '{"kind":"cigar","remaining":2}'::jsonb, 'cigar debit returns confirmed quantity');
  perform pg_temp.check_journal((public.record_smoking_session(cigar,stock)).extra->'stockOutcome' =
    '{"kind":"cigar","remaining":2}'::jsonb, 'retry preserves confirmed outcome');
  perform pg_temp.check_journal((select extra->'stockOutcome'='{"kind":"tobacco","remainingLevel":"empty"}'::jsonb
    from public.smoking_sessions where id='smoke-p'),'tobacco debit returns confirmed level');
  perform pg_temp.check_journal((select extra->>'remaining'='2' from public.cigars where id='c'),'identical request charges once');
  begin
    perform public.record_smoking_session(jsonb_set(cigar,'{rating}','2'),stock);
    raise exception 'Modified retry accepted';
  exception when unique_violation then
    perform pg_temp.check_journal((select rating=4 from public.smoking_sessions where id='smoke-c'),'different request cannot reuse a receipt');
  end;
  update public.smoking_sessions set notes='Edited' where id='smoke-c';
  delete from public.smoking_sessions where id='smoke-c';
  begin
    perform public.record_smoking_session(cigar,stock);
    raise exception 'Deleted request replayed';
  exception when unique_violation then
    perform pg_temp.check_journal((select extra->>'remaining'='2' from public.cigars where id='c'),'edit, delete and delayed retry leave stock charged once');
  end;
  perform public.record_smoking_session(jsonb_set(cigar,'{id}','"import"'),null);
  perform pg_temp.check_journal((select extra->>'remaining'='2' from public.cigars where id='c'),'import with no stock preserves stock');
  foreach unavailable in array array['zero','unknown','invalid'] loop
    debit := jsonb_build_object('kind','cigar','revision',(select updated_at from public.cigars where id=unavailable));
    unavailable_entry := cigar || jsonb_build_object('id',unavailable || '-session','cigar_id',unavailable);
    begin
      perform public.record_smoking_session(unavailable_entry,debit);
      raise exception 'Unavailable stock accepted';
    exception when sqlstate 'PT422' then
      perform pg_temp.check_journal(not exists(select 1 from public.smoking_sessions where id=unavailable || '-session')
        and not exists(select 1 from public.smoking_session_receipts where id=unavailable || '-session'),
        unavailable || ' debit rolls back both session and receipt');
    end;
    perform public.record_smoking_session(unavailable_entry,null);
    perform pg_temp.check_journal((select not extra ? 'stockOutcome' from public.smoking_sessions where id=unavailable || '-session'),
      unavailable || ' can be logged without a debit');
  end loop;
  perform pg_temp.check_journal((select extra->>'remaining'='0' from public.cigars where id='zero'),'zero remains zero');
  perform pg_temp.check_journal((select not extra ? 'remaining' from public.cigars where id='unknown'),'unknown remains unspecified');
  perform pg_temp.check_journal((select extra->>'remaining'='-1' from public.cigars where id='invalid'),'invalid legacy quantity is not decreased');

  perform public.record_smoking_session(gift,null);
  begin
    perform public.record_smoking_session(gift || '{"id":"invalid-gift","tobacco_id":"t"}', tobacco);
    raise exception 'Stock accepted for a gift';
  exception when invalid_parameter_value then
    perform pg_temp.check_journal(not exists(select 1 from public.smoking_sessions where id='invalid-gift'),'gift stock request is atomic and rejected');
  end;
end $$;

insert into public.media(object_path,mime_type,size_bytes,smoking_session_id)
values (auth.uid()::text || '/session-photos/file','image/png',1,'gift');
insert into storage.objects(bucket_id,name) values ('journal-photos',auth.uid()::text || '/session-photos/file');
delete from public.pipes where id='p';
delete from public.cigars where id='c';
select pg_temp.check_journal((select pipe_id is null and extra->'pipe'->>'name'='Pipe' from public.smoking_sessions where id='gift'),'deleted pipe leaves historic label');
select pg_temp.check_journal((select cigar_id is null and extra->'product'->>'name'='Cigar' from public.smoking_sessions where id='import'),'deleted cigar leaves historic label');

select pg_temp.check_journal((select stock_alerts_enabled and cigar_low_stock_threshold=3
  from public.profiles where id=auth.uid()),'default stock alert preferences');
update public.profiles set stock_alerts_enabled=false, cigar_low_stock_threshold=10 where id=auth.uid();
do $$
begin
  begin
    update public.profiles set cigar_low_stock_threshold=11 where id=auth.uid();
    raise exception 'Invalid threshold accepted';
  exception when check_violation then
    perform pg_temp.check_journal(true, 'threshold outside supported range rejected');
  end;
end $$;

select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
insert into public.profiles(id) values(auth.uid());
with attempted as (
  update public.profiles set cigar_low_stock_threshold=1 where id='11111111-1111-1111-1111-111111111111' returning id
)
select pg_temp.check_journal(not exists(select 1 from attempted)
  and not exists(select 1 from public.profiles where id='11111111-1111-1111-1111-111111111111'),
  'other account cannot read or write stock preferences');
select pg_temp.check_journal((select count(*)=0 from public.smoking_sessions),'foreign sessions hidden');
select pg_temp.check_journal((select count(*)=0 from public.smoking_session_receipts),'foreign receipts hidden');
select pg_temp.check_journal((select count(*)=0 from public.media),'foreign diary photo metadata hidden');
select pg_temp.check_journal((select count(*)=0 from storage.objects),'foreign diary photo hidden');
do $$
begin
  begin
    perform public.record_smoking_session('{"id":"hijack","kind":"cigar","cigar_id":"zero","started_at":"2026-11-18T19:12:00Z","extra":{"product":{"source":"owned"}}}',null);
    raise exception 'Foreign link accepted';
  exception when foreign_key_violation then
    perform pg_temp.check_journal(not exists(select 1 from public.smoking_session_receipts where id='hijack'),'cross-owner reference rejected without a receipt');
  end;
end $$;

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
select pg_temp.check_journal((select not stock_alerts_enabled and cigar_low_stock_threshold=10
  from public.profiles where id=auth.uid()), 'own preferences persist across accounts');
delete from public.smoking_sessions where id='gift';
select pg_temp.check_journal((select count(*)=0 from public.media),'session deletion cascades photo metadata');
set local role anon;
do $$
begin
  begin
    perform public.record_smoking_session('{}',null);
    raise exception 'Anonymous RPC accepted';
  exception when insufficient_privilege then
    perform pg_temp.check_journal(true,'anonymous journal RPC denied');
  end;
end $$;
rollback;
