// The first version of customer cancelling (PR #48) recorded a late fee without charging it.
// It must not come back: only cancel_visit and cancel_block may cancel for a customer.
import { afterAll, expect, it } from "vitest";
import { as, pool } from "./helpers";

afterAll(() => pool.end());

it("the old cancel functions don't exist, and the late-cancel alert kind is the live one", async () => {
  const r = await as("superuser", async (q) => ({
    old: await q.rows<{ proname: string }>(
      `select proname from pg_proc where proname in ('cancel_my_visit', 'cancel_my_block', 'my_cancel_terms', 'cancel_visit_for_customer', 'cancel_terms')`),
    live: (await q.rows<{ proname: string }>(`select proname from pg_proc where proname in ('cancel_visit', 'cancel_block', 'cancel_block_quote') order by 1`)).map((x) => x.proname),
    oldKind: await q.attempt(`insert into public.engine_alerts (kind, message) values ('cancelled_late', 'x')`),
  }));
  expect(r.old).toEqual([]);
  expect(r.live).toEqual(["cancel_block", "cancel_block_quote", "cancel_visit"]);
  expect(r.oldKind).not.toBe("ok");
});
