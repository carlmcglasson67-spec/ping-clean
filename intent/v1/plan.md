# Plan: Ping Clean V1

Each phase ships to a Vercel preview and passes the verifier agent before the next starts.

## Who owns what during parallel work
| Path | Owner |
| --- | --- |
| supabase/migrations/, supabase/functions/, lib/, components/ui/, package.json | Main session only |
| app/(site)/ | Track A |
| app/(work)/ | Track B |
| app/(admin)/ | Track C |
| app/(account)/ | Track A (after booking) |

A track that needs a shared change (new column, new helper) stops and asks the main
session, rather than editing the shared file itself. That is what stops merge collisions.

## Phase 1 — Foundations (ONE session, no parallel work)
Everything else depends on the schema, so this is never split.
1. Next.js + Supabase scaffold, route groups, auth for three roles.
2. Full V1 schema as migrations, RLS on every table, seed data for test accounts.
3. lib/db (typed client), lib/money (pence helpers), lib/auth (role guards).
4. Design tokens and base components in components/ui/.
Done: each role logs in on the preview URL and sees only its own data.

## Phase 2–4 — Parallel build: main session + tracks
Each session gets its own brief in intent/v1/tracks/. Run `bash scripts/start-tracks.sh`
for the exact command per terminal. Tracks drop shared needs in SHARED-REQUESTS.md.

### Tracks (start with TWO, add the third once review keeps up)
| Track | Worktree | Builds | Done when |
| --- | --- | --- | --- |
| A — Site + booking | claude --worktree site-booking | Marketing site, area pages, instant price, checkout creating a series with saved card (Stripe test), customer account | Test customer books end to end |
| B — Cleaner app | claude --worktree cleaner-app | Application + documents, job board, claim a series, today's jobs, checklist, photos | Test cleaner claims Track A's booking and completes a visit |
| C — Admin console | claude --worktree admin-console | Approvals, settings, unclaimed alerts, manual assign, QC queue, tiers | Admin approves a cleaner and scores a visit |

Main session (no worktree) meanwhile builds supabase/functions: visit generation,
tiered offer release, unclaimed alerts.

## Phase 5 — Money (ONE session)
Charge after clean, Connect payouts, fee split, refunds. Touches every surface, so not
split. Done: a test visit pays out the right pence. Live keys stay off until Kate signs off.

## Phase 6 — Pilot
A handful of Cumbria Bright regulars and 2–3 cleaners for two weeks.

## Merge order
Main session merges shared changes first, then tracks rebase onto main, then Carl
reviews and merges each track's PR one at a time.
