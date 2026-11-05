# Track C — Admin console (start only once A and B reviews are keeping up)

Worktree: admin-console · Branch: track/admin-console

## You own
app/(admin)/

## You never edit
lib/, components/ui/, supabase/, package.json, other route groups.
Need a shared change? Write it in SHARED-REQUESTS.md and stop that piece.

## Build (in this order, one PR each)
1. Cleaner approvals: view documents, approve/reject, set tier.
2. Settings: price per hour, commission, minimum hours, tier windows, cancellation rules.
3. Unclaimed jobs board + manual assign.
4. QC queue: photos, checklist, score each visit.
5. Basic reports: visits, revenue, Ping fees, cleaner league.
Every action writes an audit row.

## Done when
Admin approves a test cleaner, changes the price, assigns an unclaimed series and scores a visit.

## Before each PR
design-reviewer → security-reviewer → verifier. Paste their reports in the PR.
