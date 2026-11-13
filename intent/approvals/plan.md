# Plan: cleaner decisions (shared request C-1)

## What
The admin console can review documents but nothing can make a cleaner able to work. This adds
the decision: approve (with a tier), decline, suspend, reactivate, change tier.

## How
- **Database decides.** `admin_review_cleaner` and `admin_set_cleaner_tier` (security definer,
  admin only). The page only passes the choice.
- **Approve / reactivate** need the newest document of each of the four kinds to be verified and,
  where it has an end date, in date (London). Otherwise PC052, with the kinds still waiting.
- **Moves allowed:** applicant → working or declined; working → suspended; suspended → working.
  Anything else is PC053. Tier changes are for working cleaners only.
- **Reasons:** required to decline, suspend or change tier (a real word, up to 300 characters);
  optional note on approve and reactivate.
- **Log:** `cleaner_reviews` (who, what, tier, why), admin-read only, written only by the
  functions. The existing `cleaners` audit trigger also logs the change with the admin as actor.
- **Console:** the Decision panel is switched on, asks once before acting, and shows
  "Decisions so far".

## Changed from the request
- Codes are PC052/PC053 (PC040–PC042 were taken by payments). An out-of-date insurance is
  reported through PC052 with the kind named, rather than a separate code.

## For Carl
1. Should a declined or suspended cleaner see the reason? Today: no, team only.
2. Ping doesn't message the cleaner on any decision yet (no approval email). Say if you want one.
