# Plan: a customer cancels a clean, or the rest of their block

Payments plan build step 7, the customer's side ("cancel/skip with the late fee, doesn't
exist yet"). Today a customer can't cancel anything: only the Ping team can end a block.

## Rules (Carl's settings, 8 Nov 2026)

- **24 hours' notice is free** (`cancel_notice_hours`). Notice is counted to the start of the
  clean's arrival window, London time.
- **Less than that is a late cancellation**, but only when a cleaner has the clean: with no
  cleaner yet, nobody is put out, so it's free.
- **Late fee: not set yet** (`late_cancel_fee_pence` is empty). A rule that isn't set doesn't
  run, so today a late cancellation costs nothing and the team is told. When Carl sets a
  fee, the amount is recorded on the clean and shown to the customer before they confirm.
  **Taking that fee from the card is not built here**: the team gets an alert saying a fee
  is due.

## This PR

- `my_cancel_terms(clean)`: what cancelling would mean (allowed, late, notice hours, fee).
- `cancel_my_visit(clean)`: cancels one scheduled clean of the customer's own.
- `cancel_my_block(block)`: cancels every clean still to come and ends the block. A clean
  that's already under way is left alone and charged as normal when it's finished.
- A late cancellation raises a `cancelled_late` alert so the office can ring the cleaner.
- The customer's booking page lists the block's cleans, each with "Cancel this clean", and
  "Cancel the rest of my cleans". Each asks once more before doing it and says plainly
  whether it's free.
- The cleaner's app already shows a cancelled clean as not going ahead.

## Not in this PR

- Charging the late fee to the card (needs the fee, and the split, decided first).
- Telling the cleaner by message. They see it in the app; the office is alerted when it's late.
- Moving a clean to another day. Cancel is the only change a customer can make themselves.

## Data changes (needs Carl's sign-off)

- One new alert kind, `cancelled_late`. Three new functions (above). No new tables or columns.
