begin;

-- The existing profiles RLS and grants cover these account-owned preferences.
alter table public.profiles
  add column stock_alerts_enabled boolean not null default true,
  add column cigar_low_stock_threshold smallint not null default 3
    check (cigar_low_stock_threshold between 1 and 10);

create or replace function public.record_smoking_session(entry jsonb, stock jsonb default null)
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
  updated_stock jsonb;
  outcome jsonb;
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
    values(owner,item.id,item.kind,item.pipe_id,item.tobacco_id,item.cigar_id,item.started_at,item.ended_at,item.rating,item.notes,item.extra - 'stockOutcome')
    returning * into item;

  if stock is null then return item; end if;
  revision := (stock->>'revision')::timestamptz;
  if item.extra->'product'->>'source' is distinct from 'owned' or revision is null then
    raise exception using errcode='22023', message='Invalid stock request';
  end if;
  if item.kind = 'cigar' and item.cigar_id is not null and stock->>'kind' = 'cigar' then
    -- Check the revision under a row lock compatible with the session FK.
    -- A failed debit rolls back both the session and its retry receipt.
    perform 1 from public.cigars where user_id=owner and id=item.cigar_id and updated_at=revision for no key update;
    if not found then raise exception using errcode='40001', message='Inventory changed'; end if;
    update public.cigars set extra = jsonb_set(extra,'{remaining}',to_jsonb((extra->>'remaining')::numeric - 1))
      where user_id=owner and id=item.cigar_id and
        case when jsonb_typeof(extra->'remaining')='number' then
          (extra->>'remaining')::numeric between 1 and 9007199254740991 and
          mod((extra->>'remaining')::numeric,1)=0 else false end
      returning extra into updated_stock;
    if not found then raise exception using errcode='PT422', message='Cigar stock unavailable'; end if;
    outcome := jsonb_build_object('kind','cigar','remaining',updated_stock->'remaining');
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
    update public.tobaccos set extra=extra || patch where user_id=owner and id=item.tobacco_id and updated_at=revision
      returning extra into updated_stock;
    if not found then raise exception using errcode='40001', message='Inventory changed'; end if;
    outcome := jsonb_build_object('kind','tobacco','remainingLevel',updated_stock->'remainingLevel');
  else
    raise exception using errcode='22023', message='Stock requires a linked product';
  end if;
  -- Keep the confirmed result with the session so replay returns the same outcome.
  update public.smoking_sessions set extra=extra || jsonb_build_object('stockOutcome',outcome)
    where user_id=owner and id=item.id returning * into item;
  return item;
end $$;

commit;
