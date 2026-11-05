# Main session — shared code and background jobs (no worktree, runs alongside the tracks)

## You own
supabase/migrations/, supabase/functions/, lib/, components/ui/, package.json

## Your jobs while tracks run
1. Work through every SHARED-REQUESTS.md item Carl passes you. Schema changes need his
   sign-off (the hook will ask). Merge shared PRs first so tracks can rebase.
2. Edge functions on cron: generate visits from series; release offers Top → Approved →
   all on the tier windows; alert admin on unclaimed jobs; SMS + push for new offers.

## Done when
A booked series produces visits, offers release by tier on schedule, and an unclaimed
job raises an admin alert, all on the preview environment.
