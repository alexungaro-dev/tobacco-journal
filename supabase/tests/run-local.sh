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
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then docker logs "$container"; exit 1; fi
for sql in supabase/tests/local-bootstrap.sql \
  supabase/migrations/20261116160000_supabase_foundation.sql \
  supabase/tests/foundation.sql; do
  docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 < "$sql"
done
