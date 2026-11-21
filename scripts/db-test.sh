#!/usr/bin/env bash
# Schema + RLS tests against a real, throwaway Postgres. No Docker needed.
#   1. starts an empty Postgres cluster in a temp folder (UTF-8, like production, so text
#      lengths count characters, not bytes)
#   2. loads tests/db/supabase-stub.sql (the bits of Supabase we depend on)
#   3. applies every migration in order, then supabase/seed.sql
#   4. runs tests/db/*.test.ts, which log in as each seeded role and check what it can see
#      (argument "types": regenerate lib/db/types.ts instead; "e2e": run the app end to end)
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
  "${RUNAS[@]}" "$PG_BIN/initdb" -D "$TMP/data" -U postgres -A trust -E UTF8 --no-locale >/dev/null
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
# The seed only runs for a session that says it is a test database (see the top of the file).
"${PSQL[@]}" -c "set ping.seed_ok = 'local-test-only'" -f supabase/seed.sql
echo "db: $(ls supabase/migrations/*.sql | wc -l) migrations + seed applied"

# A second database with every migration and NO seed: exactly what the live database starts
# as. tests/db/from-empty.test.ts walks a brand-new customer and cleaner through a whole
# clean on it, so anything that only ever existed in the seed is caught here, not on launch day.
bare_db() {
  "${PSQL[@]}" -c "drop database if exists ping_bare" -c "create database ping_bare"
  PING_BARE_DATABASE_URL=$(node -e 'const u = new URL(process.argv[1]); u.pathname = "/ping_bare"; console.log(u.toString())' "$PING_TEST_DATABASE_URL")
  export PING_BARE_DATABASE_URL
  local bare=(psql "$PING_BARE_DATABASE_URL" -X -q -v ON_ERROR_STOP=1)
  # Roles belong to the whole server and the first database already made them.
  sed '/^create role /d' tests/db/supabase-stub.sql | "${bare[@]}" -f -
  for f in supabase/migrations/*.sql; do
    "${bare[@]}" -f "$f" >/dev/null 2>&1 || { echo "Migration failed on the empty database: $f"; exit 1; }
  done
}

if [ "${1:-}" = "types" ]; then
  mkdir -p lib/db && node scripts/gen-db-types.mjs
elif [ "${1:-}" = "e2e" ]; then
  node tests/e2e/roles.e2e.mjs
else
  bare_db
  npx vitest run --config vitest.db.config.ts
fi
