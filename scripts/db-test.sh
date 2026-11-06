#!/usr/bin/env bash
# Schema + RLS tests against a real, throwaway Postgres. No Docker needed.
#   1. starts an empty Postgres cluster in a temp folder
#   2. loads tests/db/supabase-stub.sql (the bits of Supabase we depend on)
#   3. applies every migration in order, then supabase/seed.sql
#   4. runs tests/db/*.test.ts, which log in as each seeded role and check what it can see
# Set PING_TEST_DATABASE_URL to reuse an existing empty database instead (CI does this).
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

cleanup() { :; }
if [ -z "${PING_TEST_DATABASE_URL:-}" ]; then
  PG_BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$PG_BIN" ] || { echo "No local Postgres found. Install postgresql or set PING_TEST_DATABASE_URL."; exit 1; }
  TMP=$(mktemp -d)
  PORT=$((54000 + RANDOM % 1000))
  RUNAS=()
  if [ "$(id -u)" = "0" ]; then
    id pingtest >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin pingtest
    chown -R pingtest "$TMP"
    RUNAS=(runuser -u pingtest --)
  fi
  "${RUNAS[@]}" "$PG_BIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
  "${RUNAS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
  cleanup() { "${RUNAS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
  trap cleanup EXIT
  export PING_TEST_DATABASE_URL="postgresql://postgres@localhost/postgres?host=$TMP&port=$PORT"
fi

PSQL=(psql "$PING_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f tests/db/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$f" || { echo "Migration failed: $f"; exit 1; }
done
"${PSQL[@]}" -f supabase/seed.sql
echo "db: $(ls supabase/migrations/*.sql | wc -l) migrations + seed applied"

npx vitest run --config vitest.db.config.ts
