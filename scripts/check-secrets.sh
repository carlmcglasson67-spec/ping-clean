#!/usr/bin/env bash
# Fails if live payment keys, committed env files, or the Supabase service-role key
# reach places they must not. Usage: check-secrets.sh [files...] (default: all tracked files)
set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if [ "$#" -gt 0 ]; then files=("$@"); else mapfile -t files < <(git ls-files 2>/dev/null || find . -type f -not -path './node_modules/*' -not -path './.git/*'); fi

fail=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    *.env|*.env.local|*.env.production|.env*)
      case "$f" in *.example) ;; *) echo "$f: env file must not be committed"; fail=1 ;; esac ;;
  esac
  case "$f" in scripts/check-secrets.sh|.claude/hooks/*) continue ;; esac
  if grep -nE '(sk|rk)_live_[A-Za-z0-9]{8,}' "$f" >/dev/null 2>&1; then
    grep -nE '(sk|rk)_live_[A-Za-z0-9]{8,}' "$f" | sed "s|^|$f:|; s|_live_[A-Za-z0-9]*|_live_***|g"
    echo "  ^ live Stripe key in code"; fail=1
  fi
  case "$f" in
    app/*|components/*)
      if grep -n 'SUPABASE_SERVICE_ROLE' "$f" >/dev/null 2>&1; then
        grep -n 'SUPABASE_SERVICE_ROLE' "$f" | sed "s|^|$f:|; s|_live_[A-Za-z0-9]*|_live_***|g"
        echo "  ^ service-role key used under app/ or components/ (server-only: lib/db/admin.ts)"; fail=1
      fi ;;
  esac
done

[ "$fail" -eq 0 ] && echo "check-secrets: ok"
exit "$fail"
