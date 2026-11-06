# Ping Clean

Regular domestic cleaning marketplace for West Cumbria. Customers book, vetted
self-employed cleaners claim the work, Ping takes a commission. Founding spec:
https://claude.ai/artifact/1WEp7QQgrj5dGn1wzooEWz (summary in intent/v1/spec.md).

## Commands
- Dev: npm run dev (http://localhost:3000)
- Test: npm test (unit), npm run test:db (schema + RLS, every role, real Postgres, no Docker),
  npm run test:e2e (Playwright, needs dev server)
- Lint/types: npm run lint && npm run typecheck (run before every commit)
- DB: npx supabase start | npx supabase db reset | npx supabase gen types typescript --local > lib/db/types.ts
- Guardrails: bash scripts/check-secrets.sh && bash scripts/check-rls.sh

## Architecture
- One Next.js (App Router, TypeScript) app on Vercel, one Supabase project.
- Route groups: app/(site) public site, app/(account) customer PWA,
  app/(work) cleaner PWA, app/(admin) admin console. Each group owns its folder.
- Shared code lives in lib/ and components/ui/. Only the main session edits these
  during parallel work (see intent/v1/plan.md).
- Core model: a series (the regular arrangement) generates visits. Cleaners claim
  a series, never a single visit.
- Background work (visit generation, tiered offer release, unclaimed alerts) runs in
  supabase/functions/ on cron, never in the Next.js app.
- Planning files for each change live in intent/<change>/ (intent.md, spec.md, plan.md).

## Rules
- Plan before code. Use plan mode for anything touching more than one file.
- Small PRs, one branch per feature. Carl merges. Never push to main.
- No schema change without Carl's sign-off (a hook will ask).
- Every table has RLS enabled in the same migration that creates it.
- Money is integer pence, never floats. Price, cleaner earnings and Ping fee are
  stored separately on every visit.
- Stripe test mode only. Live keys never appear in the repo.
- Done = works on the Vercel preview URL with test accounts, checked by the verifier agent.
- UI follows the pervonio-premium-design skill from the first commit.

## Things Claude gets wrong
- Do not use the Supabase service-role key in any client component or route group page.
- Do not let a cleaner see a customer's full address before they have claimed the series.
- Do not invent prices, commission or tier windows. Read them from the settings table.
(When Claude makes the same mistake twice, add it here.)
