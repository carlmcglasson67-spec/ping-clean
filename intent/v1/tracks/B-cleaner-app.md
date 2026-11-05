# Track B — Cleaner app

Worktree: cleaner-app · Branch: track/cleaner-app

## You own
app/(work)/

## You never edit
lib/, components/ui/, supabase/, package.json, other route groups.
Need a shared change? Write it in SHARED-REQUESTS.md and stop that piece.

## Build (in this order, one PR each)
1. Application + document upload (private bucket, signed URLs).
2. Areas and availability settings.
3. Job board: offers for my tier, town + postcode district only until claimed; claim a series.
4. Today's jobs with directions and full address (claimed only).
5. Checklist, before/after photos, mark complete. Works one-thumbed in bad signal.
6. Earnings and payout history (read-only until Phase 5). PWA manifest + push.

## Done when
A test cleaner claims Track A's booking and completes a visit with checklist and photos.

## Before each PR
design-reviewer → security-reviewer → verifier. Paste their reports in the PR.
