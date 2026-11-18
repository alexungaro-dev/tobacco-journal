#!/usr/bin/env bash
# Disposable local PostgreSQL only. No remote database URL is accepted.
set -euo pipefail
cd "$(dirname "$0")/../.."
container="tj-foundation-test-$$"
image="postgres:17@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --detach --name "$container" --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$image" >/dev/null
ready=false
for ((i=0; i<60; i++)); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then docker logs "$container"; exit 1; fi
for sql in supabase/tests/local-bootstrap.sql \
  supabase/migrations/20261116160000_supabase_foundation.sql \
  supabase/tests/foundation.sql; do
  docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 < "$sql"
done

# Seed an actual pre-migration session and verify that backfill survives unlinking.
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users values ('44444444-4444-4444-4444-444444444444');
insert into public.profiles(id) values ('44444444-4444-4444-4444-444444444444');
insert into public.pipes(user_id,id,brand,model)
values ('44444444-4444-4444-4444-444444444444','legacy-pipe','Maker','Historical pipe');
insert into public.smoking_sessions(user_id,id,kind,pipe_id)
values ('44444444-4444-4444-4444-444444444444','old-session','pipe','legacy-pipe');
SQL
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261118170000_smoking_journal.sql
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 <<'SQL'
delete from public.pipes where id='legacy-pipe' and user_id='44444444-4444-4444-4444-444444444444';
do $$
begin
  if not exists (select 1 from public.smoking_sessions where id='old-session'
      and pipe_id is null and extra->'pipe'->>'name'='Historical pipe'
      and extra->'product'='null'::jsonb) then
    raise exception 'Legacy snapshot was not preserved';
  end if;
  raise notice 'PASS: pre-migration snapshot survives catalogue deletion';
end $$;
delete from auth.users where id='44444444-4444-4444-4444-444444444444';
SQL
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261118180000_stock_alerts.sql
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 < supabase/tests/smoking-journal.sql

# Start two distinct registrations against the same observed inventory revision.
journal_owner=33333333-3333-3333-3333-333333333333
docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users values ('33333333-3333-3333-3333-333333333333');
insert into public.profiles(id) values ('33333333-3333-3333-3333-333333333333');
insert into public.cigars(user_id,id,brand,name,extra,updated_at)
values ('33333333-3333-3333-3333-333333333333','race','Maker','Race','{"remaining":1}','2000-01-01T00:00:00Z');
SQL
journal_request() {
  docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 -v "entry_id=$1" <<SQL
set statement_timeout='10s';
set role authenticated;
select set_config('request.jwt.claim.sub','$journal_owner',false);
select (public.record_smoking_session(
  jsonb_build_object('id',:'entry_id','kind','cigar','cigar_id','race','started_at','2026-11-18T19:00:00Z',
    'extra',jsonb_build_object('product',jsonb_build_object('source','owned','catalogueId','race','name','Race'))),
  '{"kind":"cigar","revision":"2000-01-01T00:00:00Z"}'
)).id;
SQL
}
journal_request concurrent-a & journal_a=$!
journal_request concurrent-b & journal_b=$!
journal_wins=0
if wait "$journal_a"; then journal_wins=$((journal_wins+1)); fi
if wait "$journal_b"; then journal_wins=$((journal_wins+1)); fi
test "$journal_wins" -eq 1
journal_result=$(docker exec "$container" psql -X -U postgres -At -v ON_ERROR_STOP=1   -c "select (select count(*) from public.smoking_sessions where cigar_id='race'), (select extra->>'remaining' from public.cigars where id='race'), (select count(*) from public.smoking_session_receipts where id like 'concurrent-%')")
test "$journal_result" = '1|0|1'
echo 'PASS: concurrent registrations with the same revision charge once'
