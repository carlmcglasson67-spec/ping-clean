# Go-live: from "built" to "people can use it"

Written 21 Nov 2026. The app is built and tested; what stands between it and the 30 Nov
pilot is set-up in six places (Supabase, Vercel, your domain's DNS, Cloudflare, Stripe,
Resend) and a handful of decisions only Carl can make. This is the one list. Tick things off
here as they're done. **The order matters**: each step assumes the ones above it.

## Where things stand

| Thing | State on 21 Nov |
| --- | --- |
| Code on `main` | Everything through #58. Lint, types, unit, database and end-to-end checks pass. |
| Vercel project `ping-clean` | Deploys `main` to `ping-clean.vercel.app`. **No settings on it yet**, so the launch page says "We're not taking names just now". |
| Supabase project `ping-clean` | Created 21 Nov (London, ref `cqymfeumtvafrarmumkw`, Postgres 17). **Empty: no tables yet.** |
| `pingclean.co.uk` | DNS is at Hostinger. It points at `185.41.148.1`, not at Vercel. |
| Stripe | Nothing set up. The app only accepts **test** keys and refuses a live one. |
| Preview deployments | No database behind them. Public pages only. |

## Stage 1: the database

- [ ] **1. Connect Supabase to this GitHub repository** (Carl, about 3 minutes, once).
  Supabase dashboard → project `ping-clean` → Project Settings → Integrations → GitHub:
  Authorize, choose `carlmcglasson67-spec/ping-clean`, working directory `.`, production
  branch `main`, turn **Deploy to production ON**, leave **Automatic branching OFF** (it
  costs money per branch). From then on, merging a pull request is what changes the live
  database: every migration it hasn't had is applied, in order. Nobody pastes SQL.
  **Merge nothing else between this step and the next.**
- [ ] **2. Merge the go-live pull request.** That is the first merge Supabase sees, so it
  loads every migration. Check afterwards: Supabase → Table Editor shows the tables;
  Database → Extensions shows `pg_cron` and `pg_net` on; Integrations → Cron shows seven
  `ping-…` jobs. If a migration fails, the log is under Branches → main, and nothing from
  the failed file is kept: correct **that file** in a new pull request and merge again. A
  migration that has already run is never edited: that one is fixed with a new migration.
- [ ] **3. Leave the API's schemas alone.** Supabase → Project Settings → Data API →
  Exposed schemas stays at the default. Never add `net`, `vault`, `private` or `cron`: the
  database's job calls and secrets live there.

## Stage 2: sign-in settings, before the site is connected

The moment the site has its Supabase settings (step 7), the public sign-up and sign-in
pages are live. So the sign-in settings and the email sender come first.

- [ ] **4. Resend:** create the account and verify `pingclean.co.uk` (it gives you DNS
  records to add at Hostinger). It sends Ping's sign-up and reset emails and, later, the
  payment notices.
- [ ] **5. Supabase sign-in settings** (Authentication, exactly as written in #19):
  - Sign In / Providers → Email: **Confirm email ON**, **Secure email change ON**. Phone: OFF.
  - URL Configuration: Site URL `https://pingclean.co.uk`. Redirect URLs: exactly
    `https://pingclean.co.uk/auth/confirm**` and nothing else. Never a `vercel.app` address.
  - Emails → Templates: change the link in all five templates to the ones listed in #19
    (they start `{{ .SiteURL }}/auth/confirm?…`).
  - Emails → SMTP Settings: Resend's SMTP details from step 4. Supabase's own sender only
    manages a few emails an hour. **Required before real people sign up.**
  - **Leave CAPTCHA protection (Attack Protection) OFF for now.** It goes on at step 9a,
    once the Turnstile pull request (`main-session/auth-turnstile`) is merged and the site
    key is live. Turn it on before then and nobody can sign in, including you.
- [ ] **6. Cloudflare → Turnstile:** add a widget for `pingclean.co.uk` (free), mode
  Managed. It gives a site key and a secret. The same pair does the interest form and
  sign-in: the secret goes in Vercel (step 7) and in Supabase (step 9a).

## Stage 3: connect the site, and the launch page takes names

- [ ] **7. Vercel settings, Production only** (Settings → Environment Variables):

  | Name | Value | Who |
  | --- | --- | --- |
  | `NEXT_PUBLIC_SUPABASE_URL` | `https://cqymfeumtvafrarmumkw.supabase.co` | Claude can set |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **publishable** key (Supabase → Project Settings → API keys, starts `sb_publishable_`) | Claude can set |
  | `NEXT_PUBLIC_SITE_URL` | `https://pingclean.co.uk` | Claude can set |
  | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | the site key from step 6 | Carl |
  | `SUPABASE_SERVICE_ROLE_KEY` | the **secret** key from the API keys page (starts `sb_secret_`; the older `service_role` key works too). Mark it Sensitive. | **Carl pastes** |
  | `TURNSTILE_SECRET_KEY` | the secret from step 6. Mark it Sensitive. | **Carl pastes** |
  | `RESET_PASS_SECRET` | run `openssl rand -hex 32` in a terminal and paste the result. Mark it Sensitive. Without it password resets are off. | **Carl pastes** |

  Only after step 2: with the first two set and no tables, pages that read the database
  would fail. In production the interest form **refuses every entry until both Turnstile
  keys are set** (by design: no spam protection, no form).
- [ ] **8. Point the domain at Vercel.** Vercel → project → Domains → add `pingclean.co.uk`
  and `www.pingclean.co.uk`. **`pingclean.co.uk` (no www) is the main address and `www`
  redirects to it.** Vercel's dialog may offer it the other way round: don't accept that.
  Spam protection, Stripe and the database's job calls are all set to the address without
  www, and each of them fails on a redirect. Then in Hostinger's DNS, replace the A record
  with the one Vercel shows (today: `216.150.1.1`) and add the `www` CNAME it shows.
  Whatever is on pingclean.co.uk now is replaced by this site.
- [ ] **9. Redeploy and check.** Vercel → Deployments → Redeploy the latest (settings only
  take effect on a new deployment). Then on `https://pingclean.co.uk/launch`: register as a
  customer and as a cleaner with your own details. Each should end on the thank-you panel.
- [ ] **9a. Switch on the human check for sign-in** (only once the Turnstile pull request
  is merged and step 9 shows the check box on `/login`). Supabase → Authentication →
  Attack Protection → Enable CAPTCHA protection → provider **Turnstile** → paste the secret
  from step 6 → Save. Then sign out and sign in on `pingclean.co.uk`. If you can't, switch
  it straight back off and tell me.
- [ ] **10. Rate limits.** Vercel → Firewall → Configure → New rule. **Not the rule as
  written in #20**: that one limited every POST on every path to 10 per 10 minutes, which
  was right when only the public site existed. Now a cleaner doing one clean sends 15 or
  more (start, eleven ticks, photos, complete), the database's charge job calls the app
  every minute, and Stripe posts its webhooks: all three would be cut off. Two rules
  instead, both fixed window, keyed on IP, action Deny (429). The paths are matched
  **exactly**, never by "starts with `/work`": Next.js will run a form's action from any
  address, including ones that don't exist (`/workshop`, `/api/stripe/anything`), so a
  loose match would leave a way round the limit.
  - **Signed-in areas:** Request method equals `POST` **and** the path equals `/work`,
    `/account` or `/admin`, or starts with `/work/`, `/account/` or `/admin/` (with the
    slash) → 120 requests per 10 minutes. Room for a clean and for an office of people on
    one connection. A signed-out visitor to these is sent to sign-in before anything runs.
  - **Everything else:** Request method equals `POST` **and** the path is none of the above
    **and** is not exactly one of `/api/stripe/webhook`, `/api/stripe/connect-webhook`,
    `/api/stripe/charge-due`, `/api/stripe/payouts-due` → 10 requests per 10 minutes.
    Covers sign-up, sign-in, reset and the interest form, from whichever address they're
    sent to.
  - No limit on those four Stripe addresses: each refuses anything without Stripe's
    signature or the job secret before it touches the database.

  If the Vercel plan allows one rate-limit rule only, use "Everything else" and widen it to
  cover the signed-in areas at 120. The remaining gap closes when Turnstile goes on the
  sign-in forms ("Still to build").

## Stage 4: the office signs in

- [ ] **11. Make the first admin.** There is deliberately no screen for this.
  1. Sign up on the live site with your own email and confirm it from the email.
  2. **Choose your password** on the page the email link takes you to, then sign in with it.
  3. Supabase → Authentication → Users: copy your **User UID**.
  4. Supabase → SQL Editor, both lines together, once:
     ```sql
     select set_config('app.actor', 'first admin', true);
     update public.profiles set role = 'admin' where id = 'YOUR-USER-UID' returning email, role;
     ```
     It should return one row with your email. No row means the UID was wrong and nothing
     changed. It is recorded in the audit log.

  Michelle and Shell: **not by hand.** Once they've signed up and opened their email link,
  add them in the admin console → **Team** → Add an admin. It is checked, needs a reason and
  is logged against you.
- [ ] **12. Admin console → Settings.** Booking stays closed until the starred ones are
  filled in. The numbers are Carl's (see "Decisions" below):
  price per hour* `£25.00`, shortest clean* `2 hours`, commission*, the two offer windows*
  and the unclaimed alert*, the postcode districts you're open in*: **Carlisle is
  `CA1, CA2, CA3, CA4, CA5, CA6, CA7, CA8`** (Carl, 21 Nov), plus whichever West Cumbria
  districts you open (`CA14` Workington, `CA28` Whitehaven …). Only listed districts can book. Already set by the
  database: 24 hours' cancellation notice, 72-hour check period before a cleaner is paid,
  payment retries at 24 and 72 hours then the block pauses for up to 7 days.

## Stage 5: payments, in Stripe test mode

- [ ] **13. Stripe** (test mode): turn on Connect (Express accounts). Add two webhook
  endpoints:
  - `https://pingclean.co.uk/api/stripe/webhook`, events on **your account**:
    `setup_intent.succeeded`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
    `payment_intent.requires_action`, `payment_intent.canceled`, `refund.created`,
    `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.closed`.
  - `https://pingclean.co.uk/api/stripe/connect-webhook`, events on **connected accounts**:
    `account.updated`, `account.application.deauthorized`, `payout.paid`, `payout.failed`,
    `payout.canceled`.
- [ ] **14. Vercel, Production only** (all Sensitive except the publishable key), **then
  redeploy**: `STRIPE_SECRET_KEY` (`sk_test_…`), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  (`pk_test_…`), `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` (one
  `whsec_…` per endpoint above), `PING_JOB_SECRET` (another `openssl rand -hex 32`),
  `RESEND_API_KEY` and `PING_EMAIL_FROM` (`Ping Clean <hello@pingclean.co.uk>`).
- [ ] **15. Supabase → Integrations → Vault**, two secrets, so the database's charge and
  payout jobs can call the app: `ping_charge_job_url` =
  `https://pingclean.co.uk/api/stripe/charge-due` (exactly: no www, no trailing space),
  and `ping_job_secret` = the same value as `PING_JOB_SECRET`. Until both exist the jobs
  do nothing, and they fail quietly: a mistyped value still looks "not set up".
- [ ] **16. One whole run with Stripe's test cards**, on the live site: book a block, save
  card `4242 4242 4242 4242`, approve a cleaner, finish their Stripe set-up, claim, start,
  tick, photos, complete, watch the charge, then the payout after the check period. Also
  one declined card (`4000 0000 0000 0002`) and one that asks the bank
  (`4000 0025 0000 3155`). If a charge doesn't go out within a couple of minutes, look at
  the job's last calls in the SQL Editor:
  `select status_code, error_msg, created from net._http_response order by created desc limit 5;`
  (200 is right; 401 means the two secrets differ; a redirect means the address is wrong).
  **None of the payment screens, and no photo upload, has ever run against real Stripe or
  real Supabase**: every earlier pull request says so. This run is the test.

## Stage 6: the pilot

- [ ] **17. People.** Cleaners apply on the site (`/clean-for-ping`), upload the four
  documents, and the office approves them in the console. Customers sign up and book, or the
  office does it with them.
- [ ] **18. Decide how money moves in the pilot** (see the first decision below).

## Decisions only Carl can make

1. **Money during the pilot.** Stripe is in test mode until an accountant signs off the
   agent model, VAT and the cleaner terms, and a block isn't offered to cleaners until a
   card is saved. A real card can't be saved in test mode. So on 30 Nov either (a) the
   office books pilot customers with Stripe's test card and they pay Cumbria Bright the way
   they do now, or (b) the sign-off is done and live keys are allowed first (a small code
   change, on purpose). Nobody is lined up to do that sign-off at the moment.
2. **Commission:** what Ping keeps of the £50. The cleaner sees their share before they
   take a job, so it has to be right from the first booking.
3. **Offer windows:** minutes that Top cleaners get first, then Approved, and when the
   office is told nobody has taken a job.
4. **Where the pilot is open.** Carlisle is CA1–CA8 and leads, with West Cumbria too
   (decided 21 Nov). Still open: does Carlisle open on 30 Nov with the pilot, or after it?
   The pilot customers (Cumbria Bright regulars) and today's cleaners are West Cumbria, so
   Carlisle needs its own vetted cleaners first: the 200–250 Indeed applicants are the
   place to start, on `/clean-for-ping`. Opening a district with no cleaners in it means
   bookings nobody can take.
5. **Late-cancellation fee:** the amount. None is set, so a late cancellation costs nothing.
6. **A clean with "couldn't do" items:** charge in full, or hold for the office to decide.
   Not set, so today it is held.
7. **No access** (cleaner turns up, can't get in): no charge, the late-cancellation fee, or
   the office decides each time. Not set, and nothing in the app records it yet.
8. **Rebooking:** how long the previous cleaner gets first refusal (you said 2 hours for
   changeovers; say if that's the number here too).
9. **Wording** still waiting from #56 and #57: "One rate, set by Ping", "Ping finds your
   cover", the consent line on the form, and whether registering twice replaces the first
   answers.

## Still to build before the public launch (not the pilot)

- ~~Turnstile on sign-up, sign-in and password reset~~: built in `main-session/auth-turnstile`.
  Merge it, then step 9a.
- **Someone registering your email before you do.** Supabase keeps the first password
  given for an address that hasn't been confirmed yet. Step 11 guards the admin accounts
  against it by hand; customers and cleaners need the same guard built in (a confirmed
  sign-up should always end with the password that person just chose).
- ~~A proper way to make an admin~~: admin console → Team (`main-session/make-admin`).
- **A second Supabase project for previews**, so pull requests can be tried with test
  logins before merging (#19 explains why previews can never share the live one).
- **No access** (the cleaner turned up and couldn't get in): recording it, and whether it
  carries a fee. Waits for decision 7 above. Until then the office marks the clean "wasn't done".
- The follow-ups in #12, #21 and #44.

## Things that will bite if forgotten

- **The seed is never loaded on the live database.** It holds six logins with one published
  password, one of them an admin. `supabase/config.toml` switches seeding off and the file
  itself writes nothing unless the test script runs it. Don't paste it into the SQL editor.
- **A merged migration is a live schema change.** Read it before merging.
- **Previews have no database.** "Works on the preview" can only mean the public pages
  until the second project exists.
- **Settings in Vercel do nothing until the next deployment.** After changing any, redeploy.
- **Vercel builds with Node 26; the checks run on Node 22.** No known problem. Worth making
  them match (Vercel → Settings → Build and Deployment → Node.js Version → 22.x).
- **Secrets never go in the repository, a pull request or a chat.** Paste them into Vercel
  and Supabase directly.
- **Never run `private.generate_visits()` by hand on the live database.** The scheduled job
  calls a form of it that commits between steps. Run by hand, it can lock against a cleaner
  finishing a clean or the office settling one (the reviewer reproduced the deadlock).
- **The tests have never met the real thing.** They run on Postgres 16 with a stand-in for
  Supabase and Stripe; live is Postgres 17 with real scheduled jobs, storage and Stripe.
  Steps 2, 9 and 16 are where that gets found out.
