# Carlisle

Carl, 21 Nov 2026: Ping launches in **Carlisle first, with West Cumbria too**, and Carlisle
means postcode districts **CA1 to CA8**.

## What changes (no schema change)

- Which postcodes take bookings was already data, not code: `settings.launch_districts`
  (admin console → Settings). Opening Carlisle is setting that to include
  `CA1, CA2, CA3, CA4, CA5, CA6, CA7, CA8` on the live database. Nothing in this PR opens
  a postcode.
- Area content (`app/(site)/_content/towns.ts`) gains a region and six Carlisle pages:
  Carlisle (CA1–CA3), Wetheral and Scotby (CA4), Dalston (CA5), Longtown (CA6),
  Wigton (CA7), Brampton (CA8). Carlisle is listed first everywhere.
- The menu, phone menu, home page and /areas list towns under two headings:
  "Carlisle and around" and "West Cumbria". Town counts are counted, not typed.
- Cleaners choosing their areas see a place name for CA1–CA8 (and CA20, Seascale, which
  was missing and showed as a bare code).
- Site-wide wording: "West Cumbria" becomes "Carlisle and West Cumbria" (titles, meta
  descriptions, footer, launch page, FAQ, clean-for-Ping). Draft terms say "Cumbria".
- Area page FAQ said "CA1 and CA2 and CA3 is the district"; now reads properly for
  towns with more than one district.

## For Carl to check

- The villages named on each Carlisle page and the district labels are from general
  knowledge, not checked against Royal Mail data. Fix any that are wrong.
- Launch page still says Ping "comes from a West Cumbria cleaning team": true, kept.
