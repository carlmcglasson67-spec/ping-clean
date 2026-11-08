#!/usr/bin/env bash
# Fails if any table created in supabase/migrations never has row level security enabled.
set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
dir=supabase/migrations
[ -d "$dir" ] || { echo "check-rls: no migrations yet"; exit 0; }

all=$(cat "$dir"/*.sql 2>/dev/null | tr 'A-Z' 'a-z')
# Schema-qualified names (public.x, private.x) are checked as written; bare names as public.
tables=$(printf '%s\n' "$all" | grep -oE 'create table( if not exists)? +"?[a-z_0-9]+"?(\."?[a-z_0-9]+"?)?' \
  | sed -E 's/^create table( if not exists)? +//; s/"//g; /\./!s/^/public./' | sort -u)

fail=0
for t in $tables; do
  schema=${t%%.*}; name=${t#*.}
  if [ "$schema" = public ]; then pat="alter table +(public\.)?\"?$name\"? +enable row level security"
  else pat="alter table +\"?$schema\"?\.\"?$name\"? +enable row level security"; fi
  if ! printf '%s\n' "$all" | grep -qE "$pat"; then
    echo "$t: created without 'enable row level security'"; fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "check-rls: ok ($(printf '%s\n' "$tables" | grep -c .) tables)"
exit "$fail"
