# Go-live: from "built" to "people can use it"

Written 21 Nov 2026. The app is built and tested; what stands between it and the 30 Nov
pilot is set-up in six places (Supabase, Vercel, your domain's DNS, Cloudflare, Stripe,
Resend) and a handful of decisions only Carl can make. This is the one list. Tick things off
here as they're done.

## Where things stand

| Thing | State on 21 Nov |
| --- | --- |
| Code on `main` | Everything through #58. Lint, types, unit, database and end-to-end checks pass. |
| Vercel project `ping-clean` | Deploys `main` to `ping-clean.vercel.app`. **No settings on it yet**, so the launch page says "We're not taking names just now". |
| Supabase project `ping-clean` | Created 21 Nov (London, ref `cqymfeumtvafrarmumkw`, Postgres 17). **Empty: no tables yet.** |
| `pingclean.co.uk` | DNS is at Hostinger. It points at `185.41.148.1`, not at Vercel. |
| Stripe | Nothing set up. The app only accepts **test** keys and refuses a live one. |
| Preview deployments | No database behind them. Public pages only. |

## Stage 1: the database, and the launch page taking names

- [ ] **1. Connect Supabase to this GitHub repository** (Carl, about 3 minutes, once).
  Supabase dashboard → project `ping-clean` → Project Settings → Integrations → GitHub:
  Authorize, choose `carlmcglasson67-spec/ping-clean`, working directory `.`, production
  branch `main`, turn **Deploy to production ON**, leave **Automatic branching OFF** (it
  costs money per branch). From then on, merging a pull request is what changes the live
  database: every migration it hasn't had is applied, in order. Nobody pastes SQL.
- [ ] **2. Merge the go-live pull request.** That is the first merge Supabase sees, so it
  loads all 37 migrations. Check afterwards: Supabase → Table Editor shows the tables;
  Database → Extensions shows `pg_cron` and `pg_net` on; Integrations → Cron shows seven
  `ping-…` jobs. If the run fails, the log is under Branches → main. Fix forward with a new
  migration; never edit one that has already run.
- [ ] **3. Vercel settings, Production only** (Settings → Environment Variables):

  | Name | Value | Who |
  | --- | --- | --- |
  | `NEXT_PUBLIC_SUPABASE_URL` | `https://cqymfeumtvafrarmumkw.supabase.co` | Claude can set |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **publishable** key (Supabase → Project Settings → API keys, starts `sb_publishable_`) | Claude can set |
  | `NEXT_PUBLIC_SITE_URL` | `https://pingclean.co.uk` | Claude can set |
  | `SUPABASE_SERVICE_ROLE_KEY` | the **secret** key from the same page (starts `sb_secret_`; the older `service_role` key works too). Mark it Sensitive. | **Carl pastes** |
  | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | from Cloudflare → Turnstile → add a widget for `pingclean.co.uk` (free) | Carl |
  | `TURNSTILE_SECRET_KEY` | the secret from the same widget. Mark it Sensitive. | **Carl pastes** |

  Set these **after** step 2. With the first two set and no tables, pages that read the
  database would fail. In production the interest form **refuses every entry until both
  Turnstile keys are set** (by design: no spam protection, no form).
- [ ] **4. Point the domain at Vercel.** Vercel → project → Domains → add `pingclean.co.uk`
  and `www.pingclean.co.uk`. Then in Hostinger's DNS for the domain, replace the A record
  with the one Vercel shows (today: `216.150.1.1`) and add the `www` CNAME it shows. Whatever
  is on pingclean.co.uk now is replaced by this site.
- [ ] **5. Redeploy and check.** Vercel → Deployments → Redeploy the latest. Then on
  `https://pingclean.co.uk/launch`: register as a customer and as a cleaner with your own
  details. Each should end on the thank-you panel.
- [ ] **6. Rate limits.** Vercel → Firewall → Configure → New rule. **Not the rule as written
  in #20**: that one limited every POST on every path to 10 per 10 minutes, which was right
  when only the public site existed. Now a cleaner doing one clean sends 15 or more (start,
  eleven ticks, photos, complete), the database's charge job calls the app every minute, and
  Stripe posts its webhooks: all three would be cut off. Two rules instead, both fixed
  window, keyed on IP, action Deny (429):
  - **Public pages:** Request method equals `POST` **and** Request path does **not** start
    with `/work`, `/account`, `/admin` or `/api/stripe` → 10 requests per 10 minutes.
    Covers sign-up, sign-in, reset and the interest form, from whichever page they're sent.
  - **Signed-in areas:** Request method equals `POST` **and** Request path starts with
    `/work`, `/account` or `/admin` → 120 requests per 10 minutes. Room for a clean and for
    an office of people on one connection, but still a ceiling: Next.js will run any form's
    action from any page, so without this rule someone with one account could send sign-in
    attempts through `/account` and skip the first rule.
  - Nothing on `/api/stripe`: it accepts only Stripe's signature or the job secret.

  If the Vercel plan allows one rate-limit rule only, use the first. The gap closes when
  Turnstile goes on the sign-in forms ("Still to build").

## Stage 2: the office can sign in

- [ ] **7. Supabase sign-in settings** (Authentication, exactly as written in #19):
  - Sign In / Providers → Email: **Confirm email ON**, **Secure email change ON**. Phone: OFF.
  - URL Configuration: Site URL `https://pingclean.co.uk`. Redirect URLs: exactly
    `https://pingclean.co.uk/auth/confirm**` and nothing else. Never a `vercel.app` address.
  - Emails → Templates: change the link in all five templates to the ones listed in #19
    (they start `{{ .SiteURL }}/auth/confirm?…`).
  - Emails → SMTP Settings: a custom sender (Resend, step 14). Supabase's own sender only
    manages a few emails an hour. **Required before real people sign up.**
  - **Do NOT turn on CAPTCHA protection (Attack Protection) yet.** #19 lists it as required,
    but the sign-up, sign-in and reset forms don't send a Turnstile token yet. Turn it on
    today and nobody can sign in, including you. See "Still to build" below.
- [ ] **8. Vercel, Production only:** `RESET_PASS_SECRET`: run `openssl rand -hex 32` in a
  terminal and paste the result. Mark it Sensitive. Without it password resets are off.
- [ ] **9. Make the first admin.** Sign up on the live site with your own email and confirm
  it. Then Supabase → SQL Editor, one line, once:
  `update public.profiles set role = 'admin' where email = 'YOUR EMAIL';`
  It is recorded in the audit log. There is deliberately no other way to become an admin.
  Michelle and Shell: same, after they've signed up.
- [ ] **10. Admin console → Settings.** Booking stays closed until the starred ones are
  filled in. The numbers are Carl's (see "Decisions" below):
  price per hour* `£25.00`, shortest clean* `2 hours`, commission*, the two offer windows*
  and the unclaimed alert*, the postcode districts you're open in*. Already set by the
  database: 24 hours' cancellation notice, 72-hour check period before a cleaner is paid,
  payment retries at 24 and 72 hours then the block pauses for up to 7 days.

## Stage 3: payments, in Stripe test mode

- [ ] **11. Stripe** (test mode): turn on Connect (Express accounts). Add two webhook
  endpoints:
  - `https://pingclean.co.uk/api/stripe/webhook`, events on **your account**:
    `setup_intent.succeeded`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
    `payment_intent.requires_action`, `payment_intent.canceled`, `refund.created`,
    `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.closed`.
  - `https://pingclean.co.uk/api/stripe/connect-webhook`, events on **connected accounts**:
    `account.updated`, `account.application.deauthorized`, `payout.paid`, `payout.failed`,
    `payout.canceled`.
- [ ] **12. Vercel, Production only** (all Sensitive except the publishable key):
  `STRIPE_SECRET_KEY` (`sk_test_…`), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`),
  `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` (one `whsec_…` per endpoint
  above), and `PING_JOB_SECRET` (another `openssl rand -hex 32`).
- [ ] **13. Supabase → Integrations → Vault**, two secrets, so the database's charge and
  payout jobs can call the app: `ping_charge_job_url` =
  `https://pingclean.co.uk/api/stripe/charge-due`, and `ping_job_secret` = the same value as
  `PING_JOB_SECRET`. Until both exist the jobs do nothing (they answer "not set up").
- [ ] **14. Resend:** create the account, verify `pingclean.co.uk` (it gives you DNS records
  for Hostinger), then Vercel: `RESEND_API_KEY` (Sensitive) and `PING_EMAIL_FROM`
  (`Ping Clean <hello@pingclean.co.uk>`). Use the same account for step 7's SMTP.
- [ ] **15. One whole run with Stripe's test cards**, on the live site: book a block, save
  card `4242 4242 4242 4242`, approve a cleaner, finish their Stripe set-up, claim, start,
  tick, photos, complete, watch the charge, then the payout after the check period. Also
  one declined card (`4000 0000 0000 0002`) and one that asks the bank
  (`4000 0025 0000 3155`). **None of the payment screens has ever run against real Stripe**:
  every earlier pull request says so. This run is the test.

## Stage 4: the pilot

- [ ] **16. People.** Cleaners apply on the site (`/clean-for-ping`), upload the four
  documents, and the office approves them in the console. Customers sign up and book, or the
  office does it with them.
- [ ] **17. Decide how money moves in the pilot** (see the first decision below).

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
4. **Where the pilot is open:** which postcode districts (CA14, CA28, …).
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

- **Turnstile on sign-up, sign-in and password reset**, then Supabase's CAPTCHA protection
  ON (step 7). Today only the interest form has it.
- **A second Supabase project for previews**, so pull requests can be tried with test
  logins before merging (#19 explains why previews can never share the live one).
- **Settling a clean by hand**: the office marking a missed or unfinished clean as done or
  not done. Today those alerts say "settle it by hand" and there is no button.
- The follow-ups in #12, #21 and #44.

## Things that will bite if forgotten

- **The seed is never loaded on the live database.** It holds six logins with one published
  password, one of them an admin. `supabase/config.toml` switches seeding off and the file
  itself refuses to run outside the test scripts. Don't paste it into the SQL editor.
- **A merged migration is a live schema change.** Read it before merging. A migration that
  has run is never edited: fix forward with a new one.
- **Previews have no database.** "Works on the preview" can only mean the public pages
  until the second project exists.
- **Vercel builds with Node 26; the checks run on Node 22.** No known problem. Worth making
  them match (Vercel → Settings → Build and Deployment → Node.js Version → 22.x).
- **Secrets never go in the repository, a pull request or a chat.** Paste them into Vercel
  and Supabase directly.
