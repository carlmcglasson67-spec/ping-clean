# Plan: lapsed checks

## What
Approval checks a cleaner's four documents once. After that, an insurance could run out or a
DBS be sent back and the cleaner kept working with nobody told. The office now gets an alert.

## Rules
- **Lapsed (urgent):** a working cleaner has no verified, in-date document for one of the four.
- **Running out (heads-up):** a check's last valid document ends within 14 days.
- A check is in order while any verified, in-date document of that kind exists, so a renewal
  uploaded early isn't a false alarm.
- Checked nightly (02:30) and at once when a document or the cleaner's status changes.
- Alerts close themselves when the documents are back in order or the cleaner stops working.
- One open alert per cleaner and kind. Resolved by hand while still a problem: back after 7 days.
- **Nobody is suspended automatically.** That would strand booked cleans; it stays a person's call.
- Alerts carry no names; the jobs page shows the cleaner and links to their documents.

## For Carl
- 14 days' warning and the 7-day quiet period are fixed in the database, not settings. Say if
  you want different numbers or want them in Settings.
- Nothing tells the cleaner. The office asks them (an email to the cleaner could come later).
- Tara and Alex in the seed data don't have all four documents, so both show as lapsed on test sites.
