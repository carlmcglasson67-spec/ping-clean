# Plan: cancel the rest of my cleans

## What
A customer can cancel one clean (payments 11) but only the office can end a block. This lets
the customer cancel everything still to come and end their block, from the booking page.
(The part of PR #48 that #49 didn't bring across. #48 can be closed.)

## Rules
- Each clean is cancelled exactly as "Cancel this clean" would: same notice period, same
  late fee, same split, same office alert. One shared database function does both.
- The customer sees the total before confirming. If it changed (the cut-off passed, the
  setting changed), nothing is cancelled and they're shown the new figure.
- Then the block ends: offers withdrawn, no more cleans booked, the office gets a
  "block closed" alert.
- **Not while a clean is under way or its time has started.** The block has to stay live
  for the cleaner to do that clean. The customer is told to come back after, or call.
- Cleans already done are untouched. Only the block's own customer can do it.

## For Carl
- Is "not while a clean is under way" right, or should the office be able to override?
- The cleaner still isn't messaged; the office alert asks you to ring them (as today).
