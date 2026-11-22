# Making an admin from the console (#60)

Until now the only way to make an admin was a line of SQL in the Supabase editor. The first admin
is still made that way (go-live list, step 11), because someone has to be first. Every admin after
that is made in **Admin console → Team**.

## Database: `public.admin_set_admin(p_email, p_make, p_reason)`

Only admins can call it. It is security definer, with a locked search_path.

- **Add** (`p_make = true`) works only on a confirmed account, meaning the email link was used.
  - It must be a customer account. A cleaner's or applicant's account is refused (PC061).
  - No confirmed account with that email gives PC060.
  - If the person is already an admin, the answer is PC062.
- **Remove** (`p_make = false`) turns the account back into a customer one.
  - You can't remove yourself (PC063).
  - You can't remove the last admin (PC064).
  - An admin is always removing someone else, so PC064 can't actually happen. It is kept as a
    guard if the function ever changes.
  - Every admin row is locked in id order first, so two admins removing each other at the same
    moment take turns.
- **Reason:** required, as for the other admin actions (a real word, up to 300 characters).
- **Logging:** the existing role audit trigger logs the change against the admin. A second row
  (`make_admin` / `remove_admin`) records the reason.

No table changes. It adds one function, which counts as a schema change: merging this PR is the
sign-off.

## Console: /admin/team

- **Admins list:** your own row is marked "You" and has no remove button.
- **Add an admin:** email and reason, then a second press that spells out what they'll be able to
  see.
- **Remove:** reason, then a second press.
- **Recent changes:** the last ten, saying who made each change and why.
- The page links from the console's tab row.

## Tests

- **Database (`tests/db/admin-access.test.ts`):**
  - Only admins can call the function.
  - Email case and spaces are ignored.
  - Covers: unknown address, unconfirmed account, cleaner, applicant, already an admin, not an
    admin, missing reason, removing yourself, removing another admin.
  - The audit rows are checked.
- **End to end (`admin-team.flows.mjs`):** a cleaner's account is refused; Ben is added, then
  removed; the log shows both.
