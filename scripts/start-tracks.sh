#!/usr/bin/env bash
# Prints the exact command to run in each terminal for the parallel phase.
# Usage: bash scripts/start-tracks.sh [2|3]   (default 2 tracks + main)
n="${1:-2}"
brief() { echo "Read CLAUDE.md, intent/v1/plan.md and intent/v1/tracks/$1. You are that track. Enter plan mode and show me your plan for item 1 only."; }

echo "Terminal 1 (main, shared code):"
echo "  claude \"$(brief MAIN-shared.md)\""
echo
echo "Terminal 2 (Track A):"
echo "  claude --worktree site-booking \"$(brief A-site-booking.md)\""
echo
echo "Terminal 3 (Track B):"
echo "  claude --worktree cleaner-app \"$(brief B-cleaner-app.md)\""
if [ "$n" = "3" ]; then
  echo
  echo "Terminal 4 (Track C):"
  echo "  claude --worktree admin-console \"$(brief C-admin-console.md)\""
fi
