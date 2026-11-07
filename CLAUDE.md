# Ping Clean

Regular domestic cleaning marketplace for West Cumbria. Customers book, vetted
self-employed cleaners claim the work, Ping takes a commission. Founding spec:
https://claude.ai/artifact/1WEp7QQgrj5dGn1wzooEWz (summary in intent/v1/spec.md).

## Commands
- Dev: npm run dev (http://localhost:3000)
- Test: npm test (unit), npm run test:db (schema + RLS, every role, real Postgres, no Docker),
  npm run test:e2e (builds the app, signs in as every seeded role in Chrome)
- Lint/types: npm run lint && npm run typecheck (run before every commit)
- DB: npx supabase start | npx supabase db reset | npm run db:types (regenerates lib/db/types.ts)
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

## Brand (Carl's official brand, 7 Nov 2026)
- What Ping sells: REGULAR DOMESTIC CLEANS ONLY at launch. Never list deep cleans, end of
  tenancy or Airbnb changeovers (those are Cumbria Bright, not Ping V1).
- Price is not decided. Never write a price anywhere (the flyers' £22.50 is provisional);
  the settings table is the only source.
- Logo: `<Logo>`, `<LogoMark>`, `<Wordmark>` from components/ui. Never retype "PingClean"
  as text in place of it. Files in public/brand/ (full colour, white, navy, mark, icons,
  signal-waves.svg); Carl's original crop is pingclean-logo-original.png. Rebuild with
  scripts/brand/gen-logo.py, then scripts/brand/icons.sh.
- Colours (tokens in app/globals.css, contrast tested in components/ui/tokens.test.ts):
  navy #010C26 / #011A3A / text #001D44, brand blue #0052FE, bright blue #1B7EFA,
  teal #00C2D1 (glow #18F5E8), teal-deep #0C93AC, teal-ink #08707F, mist #E2E7E9 / #F2F1F1.
  Signature gradient blue #0052FE to teal #00C2D1, left to right, big type only.
  Teal is never small text on light: use teal-ink. Use the token names, never hex in pages.
- Feel: deep navy heroes with fine teal signal waves (`signal-waves`, `NavyPanel`), white
  and mist content sections, bold Sora headings, Figtree body.
- Taglines: "A cleaner home is just a Ping away." and "The new way of connecting cleaners
  to clients". Domain pingclean.co.uk.
- No AI-generated people presented as real Ping cleaners. Photo slots stay placeholders.

## Things Claude gets wrong
- Do not use the Supabase service-role key in any client component or route group page.
- Do not let a cleaner see a customer's full address before they have claimed the series.
- Do not invent prices, commission or tier windows. Read them from the settings table.
(When Claude makes the same mistake twice, add it here.)
