# Making an admin from the console (#60)

Until now the only way to make an admin was a line of SQL in the Supabase editor. The first admin
is still made that way (go-live list, step 11), because someone has to be first. Every admin after
that is made in **Admin console → Team**.

## Database

Two functions, admins only, security definer, with a locked search_path. Both start the same
way (`private.team_change_begin`):

- check the caller is an admin
- check the reason (a real word, up to 300 characters)
- lock every admin row in id order
- check the caller is still an admin, since they may have been removed while waiting

The two functions:

- `admin_add_admin(p_email, p_reason)`. It needs exactly one account with that address, and
  that account must be confirmed, not deleted and not banned (PC060).
  - It must be a customer account. A cleaner's or applicant's account is refused (PC061).
  - A customer with cleans booked is refused (PC065), because an admin account can't manage or
    pay for its own cleans.
  - Already an admin: PC062. No email: PC066.
- `admin_remove_admin(p_profile, p_reason)` works by id, so a changed or reused email can't
  point it at the wrong person.
  - You can't remove yourself (PC063).
  - You can't remove the last admin (PC064).

Two admins removing each other at the same moment take turns. The second is refused, because
they are no longer an admin.

Reasons go in a new table, `public.team_changes`, which admins can read and nobody can write
except these functions. They are not stored in the audit log, which is never edited and must
hold no personal details. The existing role audit trigger still logs each change against the
admin.

This depends on the sign-up fix (#65). A "confirmed" account only proves who owns it once using
the email link replaces the password, so merge #65 first.

New table plus two functions: merging is the sign-off.

## Console: /admin/team

- **Admins list:** your own row is marked "You" and has no remove button.
- **Add an admin:** email and reason, then a second press that spells out what they'll be able to
  see.
- **Remove:** reason, then a second press.
- **Recent changes:** the last ten, saying who made each change and why.
- The page links from the console's tab row.

## Tests

- **Database (`tests/db/admin-access.test.ts`):**
  - Only admins can call either function.
  - Email case and spaces don't matter.
  - Refused: unknown address, unconfirmed account, deleted account, banned account, cleaner,
    applicant, customer with cleans booked, already an admin, no email, not an admin, missing
    reason, removing yourself.
  - What goes into the record and what stays out of the audit log.
  - A real two-connection race: two admins removing each other.
- **End to end (`admin-team.flows.mjs`):**
  - A cleaner is refused, and a booked customer is refused.
  - A new office account is added, then removed.
  - The record shows both changes.
