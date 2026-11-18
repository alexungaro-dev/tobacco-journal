begin;

alter table public.smoking_sessions add column extra jsonb not null default '{}'::jsonb
  check (jsonb_typeof(extra) = 'object');

-- Copy labels before changing the foreign keys. Pre-journal sessions may have no tobacco.
update public.smoking_sessions s
set extra = jsonb_build_object(
  'product', case when s.kind = 'cigar' then
    (select jsonb_build_object('source','owned','catalogueId',c.id,'brand',c.brand,'name',c.name,'detail',coalesce(c.vitola,'')) from public.cigars c where (c.user_id,c.id)=(s.user_id,s.cigar_id))
  when s.tobacco_id is not null then
    (select jsonb_build_object('source','owned','catalogueId',t.id,'brand',t.brand,'name',t.name,'detail',coalesce(t.blend_type,'')) from public.tobaccos t where (t.user_id,t.id)=(s.user_id,s.tobacco_id))
  else null end,
  'pipe', (select jsonb_build_object('source','owned','catalogueId',p.id,'brand',p.brand,'name',coalesce(nullif(p.model,''),p.brand),'detail',coalesce(p.shape,'')) from public.pipes p where (p.user_id,p.id)=(s.user_id,s.pipe_id))
);

-- Discover the existing shape constraint by its columns; unnamed CHECK
-- constraints can get different generated names on different installations.
do $$
declare constraint_name text;
begin
  select conname into strict constraint_name from pg_constraint
    where conrelid = 'public.smoking_sessions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%pipe_id%tobacco_id%';
  execute format('alter table public.smoking_sessions drop constraint %I', constraint_name);
end $$;

alter table public.smoking_sessions
  drop constraint smoking_sessions_user_id_pipe_id_fkey,
  drop constraint smoking_sessions_user_id_tobacco_id_fkey,
  drop constraint smoking_sessions_user_id_cigar_id_fkey,
  add foreign key (user_id, pipe_id) references public.pipes(user_id, id) on delete set null (pipe_id),
  add foreign key (user_id, tobacco_id) references public.tobaccos(user_id, id) on delete set null (tobacco_id),
  add foreign key (user_id, cigar_id) references public.cigars(user_id, id) on delete set null (cigar_id),
  add constraint smoking_session_links check (
    (kind = 'pipe' and cigar_id is null) or
    (kind = 'cigar' and pipe_id is null and tobacco_id is null)
  );

-- Receipts survive session deletion, so a late retry cannot charge stock again.
create table public.smoking_session_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  id text not null,
  request_digest text not null,
  primary key (user_id, id)
);
alter table public.smoking_session_receipts enable row level security;
alter table public.smoking_session_receipts force row level security;
revoke all on public.smoking_session_receipts from public, anon, authenticated;
grant select, insert on public.smoking_session_receipts to authenticated;
create policy own_receipts on public.smoking_session_receipts to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function public.record_smoking_session(entry jsonb, stock jsonb default null)
returns public.smoking_sessions
language plpgsql security invoker set search_path = '' as $$
declare
  owner uuid := auth.uid();
  item public.smoking_sessions;
  receipt text := encode(sha256(convert_to(jsonb_build_array(entry, stock)::text, 'UTF8')), 'hex');
  previous text;
  revision timestamptz;
  patch jsonb;
  grams jsonb;
  level jsonb;
begin
  if owner is null then raise exception using errcode = '42501'; end if;
  item := jsonb_populate_record(null::public.smoking_sessions, entry);
  if item.id is null or item.id = '' or item.started_at is null or
     jsonb_typeof(item.extra->'product') is distinct from 'object' or
     (item.kind = 'pipe' and jsonb_typeof(item.extra->'pipe') is distinct from 'object') then
    raise exception using errcode = '22023', message = 'Invalid session';
  end if;
  insert into public.smoking_session_receipts(user_id,id,request_digest)
    values (owner,item.id,receipt) on conflict do nothing;
  if not found then
    select request_digest into previous from public.smoking_session_receipts where user_id=owner and id=item.id;
    if previous is distinct from receipt then
      raise exception using errcode='23505', message='Session ID already used';
    end if;
    select * into item from public.smoking_sessions where user_id=owner and id=item.id;
    if not found then raise exception using errcode='23505', message='Session was deleted'; end if;
    return item;
  end if;
  insert into public.smoking_sessions(user_id,id,kind,pipe_id,tobacco_id,cigar_id,started_at,ended_at,rating,notes,extra)
    values(owner,item.id,item.kind,item.pipe_id,item.tobacco_id,item.cigar_id,item.started_at,item.ended_at,item.rating,item.notes,item.extra)
    returning * into item;

  if stock is null then return item; end if;
  revision := (stock->>'revision')::timestamptz;
  if item.extra->'product'->>'source' is distinct from 'owned' or revision is null then
    raise exception using errcode='22023', message='Invalid stock request';
  end if;
  if item.kind = 'cigar' and item.cigar_id is not null and stock->>'kind' = 'cigar' then
    -- A revision match proves that the preview is still current. Zero and
    -- unspecified quantities never go below zero or become a measured value.
    perform 1 from public.cigars where user_id=owner and id=item.cigar_id and updated_at=revision for no key update;
    if not found then raise exception using errcode='40001', message='Inventory changed'; end if;
    update public.cigars set extra = jsonb_set(extra,'{remaining}',to_jsonb((extra->>'remaining')::numeric - 1))
      where user_id=owner and id=item.cigar_id and
        case when jsonb_typeof(extra->'remaining')='number' then
          (extra->>'remaining')::numeric between 1 and 9007199254740991 and
          mod((extra->>'remaining')::numeric,1)=0 else false end;
  elsif item.kind='pipe' and item.tobacco_id is not null and stock->>'kind'='tobacco' then
    patch := stock->'patch';
    if jsonb_typeof(patch) is distinct from 'object' or patch = '{}'::jsonb or
       (patch - 'remaining' - 'remainingLevel') <> '{}'::jsonb then
      raise exception using errcode='22023', message='Invalid tobacco stock patch';
    end if;
    grams := patch->'remaining';
    level := patch->'remainingLevel';
    if grams is not null and grams <> 'null'::jsonb and
      (jsonb_typeof(grams) <> 'number' or (grams #>> '{}')::numeric < 0) then
      raise exception using errcode='22023', message='Invalid grams';
    end if;
    if level is not null and level <> 'null'::jsonb and
      coalesce(level #>> '{}' not in ('full','almostFull','half','almostEmpty','empty'),true) then
      raise exception using errcode='22023', message='Invalid remaining level';
    end if;
    update public.tobaccos set extra=extra || patch where user_id=owner and id=item.tobacco_id and updated_at=revision;
    if not found then raise exception using errcode='40001', message='Inventory changed'; end if;
  else
    raise exception using errcode='22023', message='Stock requires a linked product';
  end if;
  return item;
end $$;

revoke all on function public.record_smoking_session(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.record_smoking_session(jsonb,jsonb) to authenticated;

commit;
