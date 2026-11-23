// Track C: admin jobs, end to end. Loaded by admin.flows.mjs, signed in as the seeded admin.
import assert from "node:assert/strict";

const ADMIN = "00000000-0000-4000-a000-000000000001";
const BEN = "00000000-0000-4000-a000-000000000003";
const ALEX = "00000000-0000-4000-a000-000000000005";
const HOME = "00000000-0000-4000-b000-0000000000e1";
const BLOCK = "00000000-0000-4000-c000-0000000000e1";
const BLOCK2 = "00000000-0000-4000-c000-0000000000e2";
const BLOCK3 = "00000000-0000-4000-c000-0000000000e3";
const BLOCK4 = "00000000-0000-4000-c000-0000000000e4";

/** An unclaimed block at a new home of Ben's in Whitehaven (CA28, which Alex covers). */
async function unclaimedBlock(sql, id, weeksAhead) {
  await sql(
    `insert into public.series (id, property_id, customer_id, frequency, preferred_day, window_start, window_end, duration_minutes,
                                price_per_hour_pence, commission_type, commission_value, status, starts_on, block_size, offering_since)
     values ($1, $2, $3, 'weekly', 2, '09:00', '13:00', 120, 2000, 'percent', 2500, 'unclaimed',
             (now() at time zone 'Europe/London')::date + $4::int, 2, now() - interval '1 day')`,
    [id, HOME, BEN, weeksAhead * 7]);
}

export default async function jobsFlows({ page, BASE, check, dir, sql, settle, shoot, browser, signIn }) {
  console.log("e2e: admin console, jobs (Track C)");
  await sql(
    `insert into public.properties (id, customer_id, address_line1, town, postcode, bedrooms, bathrooms)
     values ($1, $2, '3 E2E Lane', 'Whitehaven', 'CA28 7ZZ', 2, 1) on conflict do nothing`, [HOME, BEN]);
  await unclaimedBlock(sql, BLOCK, 2);

  const card = (id) => page.locator(`#block-${id}`);
  await page.goto(`${BASE}/admin/jobs`);
  await settle(page);

  await check("today's cleans and blocks needing a cleaner are listed, unclaimed first", async () => {
    const today = await page.getByRole("region", { name: /^Today/ }).innerText();
    assert.match(today, /Workington CA14/);
    const open = page.getByRole("region", { name: /Needs a cleaner/ });
    assert.match(await open.locator("li").first().innerText(), /Whitehaven CA28[\s\S]*Unclaimed/);
  });

  await check("assigning says what happens, and needs a cleaner chosen", async () => {
    await card(BLOCK).getByRole("button", { name: "Assign a cleaner" }).click();
    assert.ok(await card(BLOCK).getByRole("button", { name: "Confirm assignment" }).isDisabled());
    await card(BLOCK).getByLabel(/Give the Whitehaven CA28 block to/).selectOption(ALEX);
    await card(BLOCK).getByText(/Every clean of the block is booked in/).waitFor();
  });

  await check("assigned: the engine books the whole block for them, logged against the admin", async () => {
    await card(BLOCK).getByRole("button", { name: "Confirm assignment" }).click();
    await page.getByRole("region", { name: /Held blocks/ }).locator(`#block-${BLOCK}`).waitFor();
    const [s] = await sql(`select status, cleaner_id from public.series where id = $1`, [BLOCK]);
    assert.deepEqual(s, { status: "claimed", cleaner_id: ALEX });
    const [{ n }] = await sql(`select count(*)::int as n from public.visits where series_id = $1`, [BLOCK]);
    assert.equal(n, 2);
    const [a] = await sql(`select actor_id from public.audit_log where entity = 'series' and entity_id = $1 order by id desc limit 1`, [BLOCK]);
    assert.equal(a.actor_id, ADMIN);
  });

  await check("put back on the board: a new round, its cleans removed", async () => {
    await card(BLOCK).getByRole("button", { name: "Put back on the board" }).click();
    await card(BLOCK).getByText(/The current cleaner loses it/).waitFor();
    await card(BLOCK).getByRole("button", { name: "Yes, put it back" }).click();
    await page.getByRole("region", { name: /Needs a cleaner/ }).locator(`#block-${BLOCK}`).waitFor();
    const [s] = await sql(`select status, cleaner_id, offer_round from public.series where id = $1`, [BLOCK]);
    assert.deepEqual(s, { status: "offering", cleaner_id: null, offer_round: 2 });
    const [{ n }] = await sql(`select count(*)::int as n from public.visits where series_id = $1`, [BLOCK]);
    assert.equal(n, 0);
  });

  await check("a cleaner who stopped being active meanwhile: refused in the admin's words", async () => {
    await unclaimedBlock(sql, BLOCK2, 30);
    await page.reload();
    await settle(page);
    await card(BLOCK2).getByRole("button", { name: "Assign a cleaner" }).click();
    await card(BLOCK2).getByLabel(/block to/).selectOption(ALEX);
    await sql(`update public.cleaners set status = 'suspended' where id = $1`, [ALEX]);
    try {
      await card(BLOCK2).getByRole("button", { name: "Confirm assignment" }).click();
      await card(BLOCK2).getByText("That cleaner isn't active any more, so the job can't go to them.").waitFor();
    } finally {
      await sql(`update public.cleaners set status = 'active' where id = $1`, [ALEX]);
    }
    const [s] = await sql(`select status from public.series where id = $1`, [BLOCK2]);
    assert.equal(s.status, "unclaimed");
  });

  await check("ending a block needs a real reason, which is kept on it", async () => {
    await page.reload();
    await settle(page);
    await card(BLOCK2).getByRole("button", { name: "End block" }).click();
    await card(BLOCK2).getByText(/cleans still booked from today on are cancelled/).waitFor();
    assert.ok(await card(BLOCK2).getByRole("button", { name: "End the block" }).isDisabled());
    await card(BLOCK2).getByLabel(/Why is the Whitehaven CA28 block ending/).fill("!!");
    await card(BLOCK2).getByRole("button", { name: "End the block" }).click();
    await card(BLOCK2).getByText("Say why, in a few words.").waitFor();
    await card(BLOCK2).getByLabel(/Why is/).fill("Customer moved house");
    await card(BLOCK2).getByRole("button", { name: "End the block" }).click();
    await card(BLOCK2).waitFor({ state: "detached" });
    const [s] = await sql(`select status, end_reason from public.series where id = $1`, [BLOCK2]);
    assert.deepEqual(s, { status: "ended", end_reason: "Customer moved house" });
  });

  await check("alerts say what to do; resolving is confirmed, logged, and only once", async () => {
    const [al] = await sql(
      `insert into public.engine_alerts (kind, series_id, message) values ('block_stalled', $1, 'e2e: only 0 of its 2 cleans were ever booked.') returning id`, [BLOCK]);
    await page.reload();
    await settle(page);
    const alerts = page.getByRole("region", { name: /^Alerts/ });
    const item = alerts.locator("li").filter({ hasText: "e2e: only 0 of its 2" });
    assert.match(await item.innerText(), /Block stalled[\s\S]*Whitehaven CA28[\s\S]*end it or put it back on the board/);
    await item.getByRole("button", { name: "Mark resolved" }).click();
    await item.getByRole("button", { name: "Yes, it’s sorted" }).click();
    await item.waitFor({ state: "detached" });
    const [r] = await sql(`select resolved_by, resolved_at is not null as done from public.engine_alerts where id = $1`, [al.id]);
    assert.deepEqual(r, { resolved_by: ADMIN, done: true });
  });

  await check("a stale resolve (someone else got there first) is told kindly", async () => {
    const [al] = await sql(`insert into public.engine_alerts (kind, series_id, message) values ('block_overlap', $1, 'e2e: cut short by one') returning id`, [BLOCK]);
    await page.reload();
    await settle(page);
    const item = page.getByRole("region", { name: /^Alerts/ }).locator("li").filter({ hasText: "e2e: cut short by one" });
    await item.getByRole("button", { name: "Mark resolved" }).click();
    await sql(`update public.engine_alerts set resolved_at = now(), resolved_by = $2 where id = $1`, [al.id, ADMIN]);
    await item.getByRole("button", { name: "Yes, it’s sorted" }).click();
    await item.getByText("Someone on the team has already resolved that one.").waitFor();
  });

  // A clean Alex was booked for and never started: yesterday, left as the night's job leaves it.
  const asAdmin = (statement) =>
    sql(`begin; select set_config('request.jwt.claims', '{"sub":"${ADMIN}","role":"authenticated"}', true); ${statement}; commit`);
  await unclaimedBlock(sql, BLOCK3, 4);
  await asAdmin(`select public.admin_assign_series('${BLOCK3}', '${ALEX}')`);
  const [missed] = await sql(`select id from public.visits where series_id = $1 order by scheduled_date limit 1`, [BLOCK3]);
  await sql(`update public.visits set scheduled_date = (now() at time zone 'Europe/London')::date - 1, status = 'no_show' where id = $1`, [missed.id]);
  await sql(
    `insert into public.engine_alerts (kind, series_id, visit_id, message)
     values ('visit_no_show', $1, $2, 'A booked clean passed without being started. Check with the cleaner and the customer.')`, [BLOCK3, missed.id]);
  await page.goto(`${BASE}/admin/jobs`);
  await settle(page);
  const missedItem = page.getByRole("region", { name: /^Alerts/ }).locator("li").filter({ hasText: "Clean missed" }).filter({ hasText: "Whitehaven CA28" });

  await check("a missed clean is settled, not just hidden: the step names who is charged, who is paid and how much", async () => {
    const text = await missedItem.innerText();
    assert.match(text, /Booked for [\s\S]* · Ben Test’s home · with Alex Test/);
    assert.match(text, /Check with the cleaner and the customer\. Then say whether it was done\./);
    assert.equal(text.match(/A booked clean passed without being started/g).length, 1, "the alert says it once");
    assert.equal(await missedItem.getByRole("button", { name: "Mark resolved" }).count(), 0);
    await missedItem.getByRole("button", { name: "It was done" }).click();
    const step = missedItem.getByRole("group", { name: /Mark the Whitehaven CA28 clean of .* as done\?/ });
    // Seed price: 2 hours at £20, the cleaner keeps 75%.
    assert.match(await step.innerText(), /Charged to Ben Test’s card, now\s+£40\.00\s+Paid to Alex Test, after the check period\s+£30\.00\s+Ping’s fee\s+£10\.00/);
    await step.getByText("This can’t be undone. If the charge is wrong, refund it from Payments.").waitFor();
    // The keyboard moves into the step when it opens...
    await page.waitForFunction(() => /^Mark the Whitehaven CA28 clean/.test(document.activeElement?.textContent ?? ""), null, { timeout: 5000 });
    assert.ok(await step.getByRole("button", { name: "Yes, charge £40.00" }).isDisabled(), "nothing is sent without a reason");
    await step.getByText("Needed before you can confirm.").waitFor();
    await shoot(page, dir, "admin-jobs-settle");
    await step.getByRole("button", { name: "Cancel" }).click();
    // ...and back to the button that opened it when it closes.
    await page.waitForFunction(() => document.activeElement?.textContent === "It was done", null, { timeout: 5000 });
    const [v] = await sql(`select status::text from public.visits where id = $1`, [missed.id]);
    assert.equal(v.status, "no_show");
  });

  await check("\"it wasn't done\" needs a real reason; then nobody is charged, the alert closes and the page says what happened", async () => {
    await missedItem.getByRole("button", { name: "It wasn’t done" }).click();
    await missedItem.getByText(/It stays as a missed clean and this alert closes\. Nobody is charged and Alex Test isn’t paid\./).waitFor();
    await missedItem.getByLabel(/What happened/).fill("??");
    await missedItem.getByRole("button", { name: "Yes, leave it as missed" }).click();
    await missedItem.getByText("Say what happened, in a few words.").waitFor();
    await shoot(page, dir, "admin-jobs-settle-missed");
    await missedItem.getByLabel(/What happened/).fill("Alex was ill and told nobody. Ben agreed to skip it.");
    await missedItem.getByRole("button", { name: "Yes, leave it as missed" }).click();
    await missedItem.waitFor({ state: "detached" });
    const said = await page.getByRole("region", { name: /^Alerts/ }).getByRole("status").innerText();
    assert.match(said, /^Whitehaven CA28, .*: marked as not done\. Nobody is charged\. It’s kept under “Marked as not done”, below, in case it did happen\.$/);
    const [v] = await sql(`select status::text from public.visits where id = $1`, [missed.id]);
    const [{ n: charges }] = await sql(`select count(*)::int as n from public.payments where visit_id = $1`, [missed.id]);
    const [rec] = await sql(`select outcome, was_status::text, reason, actor_id from public.visit_settlements where visit_id = $1`, [missed.id]);
    const [al] = await sql(`select resolved_by from public.engine_alerts where visit_id = $1`, [missed.id]);
    assert.deepEqual({ status: v.status, charges, rec, by: al.resolved_by }, {
      status: "no_show", charges: 0, by: ADMIN,
      rec: { outcome: "not_done", was_status: "no_show", reason: "Alex was ill and told nobody. Ben agreed to skip it.", actor_id: ADMIN },
    });
  });

  await check("it did happen after all: the way back charges the customer once and pays the cleaner", async () => {
    const kept = page.getByRole("group", { name: "Marked as not done" }).locator("li").filter({ hasText: "Whitehaven CA28" });
    assert.match(await kept.innerText(), /Ben Test’s home · with Alex Test[\s\S]*“Alex was ill and told nobody\. Ben agreed to skip it\.”/);
    await shoot(page, dir, "admin-jobs-not-done");
    await kept.getByRole("button", { name: "It was done after all" }).click();
    assert.equal(await kept.getByRole("button", { name: /wasn.t done/ }).count(), 0, "only the one way back is offered");
    await shoot(page, dir, "admin-jobs-settle-after-all");
    await kept.getByLabel(/What happened/).fill("Alex sent her photos: she did the clean on the day.");
    await kept.getByRole("button", { name: "Yes, charge £40.00" }).click();
    await kept.waitFor({ state: "detached" });
    const said = await page.getByRole("region", { name: /^Alerts/ }).getByRole("status").innerText();
    assert.match(said, /^Whitehaven CA28, .*: marked as done\. Ben Test’s card is charged £40\.00; Alex Test is paid £30\.00 after the check period\.$/);
    const [v] = await sql(`select status::text, completed_at is not null as done from public.visits where id = $1`, [missed.id]);
    const pays = await sql(`select status::text, amount_pence, application_fee_pence, cleaner_amount_pence from public.payments where visit_id = $1`, [missed.id]);
    const recs = await sql(`select outcome from public.visit_settlements where visit_id = $1 order by created_at`, [missed.id]);
    assert.deepEqual({ v, pays, recs: recs.map((r) => r.outcome) }, {
      v: { status: "completed", done: true },
      pays: [{ status: "pending", amount_pence: 4000, application_fee_pence: 1000, cleaner_amount_pence: 3000 }],
      recs: ["not_done", "done"],
    });
    // Scored here, so the QC flow that follows finds its queue as it expects.
    await sql(`insert into public.visit_qc (visit_id, score, notes, reviewed_by) values ($1, 8, 'e2e: settled by hand', $2)`, [missed.id, ADMIN]);
  });

  await check("the cleaner is told the office marked it as done, never that every item was ticked", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-GB", timezoneId: "Europe/London", deviceScaleFactor: 2 });
    try {
      const phone = await ctx.newPage();
      await signIn(phone, "alex.cleaner");
      await phone.waitForURL(`${BASE}/work`);
      await phone.goto(`${BASE}/work/visit/${missed.id}`);
      await phone.getByText("Done. Thank you.").waitFor();
      const text = await phone.locator("main").innerText();
      assert.match(text, /The Ping office marked this clean as done for you, so it has no checklist or photos in the app\./);
      assert.ok(!/Every item ticked|The customer can see your checklist/.test(text), "nothing is claimed that didn't happen");
      assert.ok(!/Alex sent her photos|Alex was ill/.test(text), "the office's reason stays with the office");
      await phone.evaluate(() => document.fonts.ready);
      await phone.screenshot({ path: `${dir}/work-visit-done-by-office-390.png`, fullPage: true });
    } finally {
      await ctx.close();
    }
  });

  await check("someone else settles it while the step is open: nothing is done twice, and the page says so", async () => {
    const [second] = await sql(`select id from public.visits where series_id = $1 and status = 'scheduled' order by scheduled_date limit 1`, [BLOCK3]);
    await sql(`update public.visits set scheduled_date = (now() at time zone 'Europe/London')::date - 2, status = 'no_show' where id = $1`, [second.id]);
    await sql(
      `insert into public.engine_alerts (kind, series_id, visit_id, message)
       values ('visit_no_show', $1, $2, 'A booked clean passed without being started. Check with the cleaner and the customer.')`, [BLOCK3, second.id]);
    await page.goto(`${BASE}/admin/jobs`);
    await settle(page);
    const item = page.getByRole("region", { name: /^Alerts/ }).locator("li").filter({ hasText: "Clean missed" }).filter({ hasText: "Whitehaven CA28" });
    await item.getByRole("button", { name: "It was done" }).click();
    await item.getByLabel(/What happened/).fill("Ben says it was done.");
    await asAdmin(`select public.admin_settle_visit('${second.id}', 'not_done', 'e2e: a colleague got there first')`);
    // Hours ago, with this page left open since: the line below is still shown, however old.
    await sql(`update public.visit_settlements set created_at = now() - interval '2 hours' where visit_id = $1`, [second.id]);
    await item.getByRole("button", { name: "Yes, charge £40.00" }).click();
    await item.waitFor({ state: "detached" });
    const line = page.getByRole("region", { name: /^Alerts/ }).getByRole("status");
    const said = await line.innerText();
    assert.match(said, /^Someone on the team had already dealt with this one\. Whitehaven CA28, .*: marked as not done\./);
    assert.match(await line.getAttribute("class"), /warn/, "amber, not the green of something that went through");
    const [{ n: charges }] = await sql(`select count(*)::int as n from public.payments where visit_id = $1`, [second.id]);
    const [{ n: records }] = await sql(`select count(*)::int as n from public.visit_settlements where visit_id = $1`, [second.id]);
    assert.deepEqual({ charges, records }, { charges: 0, records: 1 });
    await shoot(page, dir, "admin-jobs-settle-late");
  });

  await check("a clean that was started and never finished: the step says what the cleaner couldn't do, and \"wasn't done\" cancels it", async () => {
    // A block of its own, later than the last one so the two never share a slot.
    await unclaimedBlock(sql, BLOCK4, 8);
    await asAdmin(`select public.admin_assign_series('${BLOCK4}', '${ALEX}')`);
    const [third] = await sql(`select id from public.visits where series_id = $1 order by scheduled_date limit 1`, [BLOCK4]);
    await sql(`update public.visits set scheduled_date = (now() at time zone 'Europe/London')::date - 3, status = 'in_progress', started_at = now() - interval '3 days' where id = $1`, [third.id]);
    await sql(
      `insert into public.checklist_items (visit_id, item_key, room, label, position, done, skipped_reason)
       values ($1, 'kitchen.sink', 'Kitchen', 'Sink and taps cleaned and polished', 0, true, null),
              ($1, 'bins.empty', 'Whole home', 'Bins emptied and bags replaced', 1, false, 'Bins already collected')`, [third.id]);
    await sql(
      `insert into public.engine_alerts (kind, series_id, visit_id, message)
       values ('visit_unfinished', $1, $2, 'A clean was started but never marked complete. Check it and settle it by hand.')`, [BLOCK4, third.id]);
    await page.goto(`${BASE}/admin/jobs`);
    await settle(page);
    const alerts = page.getByRole("region", { name: /^Alerts/ });
    const item = alerts.locator("li").filter({ hasText: "Clean never finished" }).filter({ hasText: "Whitehaven CA28" });
    const text = await item.innerText();
    assert.match(text, /A clean was started but never marked complete\.\s+Ask the cleaner what happened, then say whether it was done\./);
    assert.ok(!/settle it by hand/.test(text), "the engine's own instruction gives way to the two answers");

    // "Done" says what the cleaner couldn't do before anything is charged.
    await item.getByRole("button", { name: "It was done" }).click();
    await item.getByText("Alex Test marked 1 item “couldn’t do” before stopping. It’s charged in full all the same.").waitFor();
    await shoot(page, dir, "admin-jobs-settle-unfinished");
    await item.getByRole("button", { name: "Cancel" }).click();

    // "Wasn't done" cancels a started clean, and the button says so.
    await item.getByRole("button", { name: "It wasn’t done" }).click();
    await item.getByText("The clean is cancelled. Nobody is charged and Alex Test isn’t paid. This can’t be undone.").waitFor();
    await item.getByLabel(/What happened/).fill("Alex was called away after ten minutes. Ben agreed it doesn’t count.");
    await shoot(page, dir, "admin-jobs-settle-cancel");
    await item.getByRole("button", { name: "Yes, cancel the clean" }).click();
    await item.waitFor({ state: "detached" });
    assert.match(await alerts.getByRole("status").innerText(), /^Whitehaven CA28, .*: marked as not done\. The clean is cancelled and nobody is charged\.$/);
    const [v] = await sql(`select status::text, cancel_reason, cancelled_by from public.visits where id = $1`, [third.id]);
    const [{ n: charges }] = await sql(`select count(*)::int as n from public.payments where visit_id = $1`, [third.id]);
    assert.deepEqual({ v, charges }, { v: { status: "cancelled", cancel_reason: "admin", cancelled_by: ADMIN }, charges: 0 });
    // A cancelled clean is final: only the missed one a colleague settled is kept for a way back.
    assert.equal(await page.getByRole("group", { name: "Marked as not done" }).locator("li").count(), 1);
    // The block carries on: its other clean is still booked.
    const [b] = await sql(`select status::text from public.series where id = $1`, [BLOCK4]);
    assert.equal(b.status, "claimed");
  });

  await check("couldn't get in, the way back: the step names the no-access fee, who pays and what the cleaner gets, then charges it once and tells the customer", async () => {
    // The clean a colleague marked as not done, above. Settings (seed): Carl's rule, the
    // late-cancellation fee of £15.00, split as a clean (Alex keeps 75%).
    const kept = page.getByRole("group", { name: "Marked as not done" }).locator("li").filter({ hasText: "Whitehaven CA28" });
    const [visit] = await sql(`select v.id from public.visits v join public.visit_settlements s on s.visit_id = v.id
                                where v.series_id = $1 and v.status = 'no_show'`, [BLOCK3]);
    await kept.getByRole("button", { name: "Couldn’t get in" }).click();
    const step = kept.getByRole("group", { name: /^Alex Test couldn’t get in for the Whitehaven CA28 clean of .*\?$/ });
    assert.match(await step.innerText(),
      /Charged to Ben Test’s card, now\s+£15\.00\s+Paid to Alex Test for the trip, after the check period\s+£11\.25\s+Ping’s part\s+£3\.75/);
    await step.getByText(/Ben Test is emailed to say Alex Test couldn’t get in, with a link to their account\./).waitFor();
    await page.waitForFunction(() => /couldn’t get in for the Whitehaven CA28 clean/.test(document.activeElement?.textContent ?? ""), null, { timeout: 5000 });
    assert.ok(await step.getByRole("button", { name: "Yes, charge £15.00" }).isDisabled(), "nothing is sent without a reason");
    await step.getByLabel(/What happened at the door/).fill("Alex knocked and rang for ten minutes; nobody in and no key in the safe.");
    await shoot(page, dir, "admin-jobs-no-access");
    await step.getByRole("button", { name: "Yes, charge £15.00" }).click();
    await kept.waitFor({ state: "detached" });
    const said = await page.getByRole("region", { name: /^Alerts/ }).getByRole("status").innerText();
    assert.match(said, /^Whitehaven CA28, .*: marked as couldn’t get in\. Ben Test’s card is charged the £15\.00 no-access fee; Alex Test is paid £11\.25 for the trip after the check period\. Ben Test is emailed to say why\.$/);
    const [v] = await sql(`select status::text, cancel_reason, cancelled_by, late_cancel_fee_pence from public.visits where id = $1`, [visit.id]);
    const pays = await sql(`select kind, status::text, amount_pence, application_fee_pence, cleaner_amount_pence from public.payments where visit_id = $1`, [visit.id]);
    const notes = await sql(`select kind from private.customer_notices where visit_id = $1`, [visit.id]);
    const recs = await sql(`select outcome from public.visit_settlements where visit_id = $1 order by created_at`, [visit.id]);
    assert.deepEqual({ v, pays, notes, recs: recs.map((r) => r.outcome) }, {
      v: { status: "cancelled", cancel_reason: "no_access", cancelled_by: ADMIN, late_cancel_fee_pence: 1500 },
      pays: [{ kind: "late_cancel", status: "pending", amount_pence: 1500, application_fee_pence: 375, cleaner_amount_pence: 1125 }],
      notes: [{ kind: "no_access_fee" }],
      recs: ["not_done", "no_access"],
    });
  });

  await check("couldn't get in, decide each time: a choice is needed, a changed fee is caught, and no charge charges nothing", async () => {
    const [fourth] = await sql(`select id from public.visits where series_id = $1 and status = 'scheduled' order by scheduled_date limit 1`, [BLOCK4]);
    await sql(`update public.visits set scheduled_date = (now() at time zone 'Europe/London')::date - 4, status = 'no_show' where id = $1`, [fourth.id]);
    await sql(`insert into public.engine_alerts (kind, series_id, visit_id, message)
               values ('visit_no_show', $1, $2, 'A booked clean passed without being started. Check with the cleaner and the customer.')`, [BLOCK4, fourth.id]);
    await sql(`update public.settings set no_access_rule = 'admin_decides'`);
    try {
      await page.goto(`${BASE}/admin/jobs`);
      await settle(page);
      const item = page.getByRole("region", { name: /^Alerts/ }).locator("li").filter({ hasText: "Clean missed" }).filter({ hasText: "Whitehaven CA28" });
      // Three answers on a missed clean: under the words on a phone, in the corner on a wide screen.
      assert.deepEqual(await item.getByRole("button").allInnerTexts(), ["It was done", "It wasn’t done", "Couldn’t get in"]);
      await shoot(page, dir, "admin-jobs-no-access-answers");
      await item.getByRole("button", { name: "Couldn’t get in" }).click();
      await item.getByText("Settings say you decide each time. Does Ben Test pay the no-access fee?").waitFor();
      await item.getByLabel(/What happened at the door/).fill("Ben was away and forgot to say.");
      assert.ok(await item.getByRole("button", { name: "Yes, cancel with no charge" }).isDisabled(), "a choice is needed first");
      await item.getByText("Charge the £15.00 fee").click();
      await item.getByText(/Paid to Alex Test for the trip, after the check period\s*£11\.25/).waitFor();
      // The fee changes in Settings while this step is open: nothing is charged, the new
      // figure is shown, and the choice is asked again.
      await sql(`update public.settings set late_cancel_fee_pence = 2000`);
      await item.getByRole("button", { name: "Yes, charge £15.00" }).click();
      await item.getByText("The cost has changed since this page loaded, so nothing was done. Look again at the new figure, then confirm.").waitFor();
      await item.getByText("Charge the £20.00 fee").waitFor();
      const [{ n: none }] = await sql(`select count(*)::int as n from public.payments where visit_id = $1`, [fourth.id]);
      assert.equal(none, 0);
      await item.getByText("No charge this time").click();
      await item.getByText("No charge", { exact: true }).waitFor();
      // A new choice is a fresh look: the old "cost has changed" line goes.
      assert.equal(await item.getByText(/The cost has changed since this page loaded/).count(), 0);
      await shoot(page, dir, "admin-jobs-no-access-decide");
      await item.getByRole("button", { name: "Yes, cancel with no charge" }).click();
      await item.waitFor({ state: "detached" });
      const said = await page.getByRole("region", { name: /^Alerts/ }).getByRole("status").innerText();
      assert.match(said, /^Whitehaven CA28, .*: marked as couldn’t get in\. Nobody is charged\. Ben Test is emailed to say Alex Test couldn’t get in\.$/);
      const [v] = await sql(`select status::text, cancel_reason, late_cancel_fee_pence from public.visits where id = $1`, [fourth.id]);
      const [{ n: charges }] = await sql(`select count(*)::int as n from public.payments where visit_id = $1`, [fourth.id]);
      const notes = await sql(`select kind, payment_id from private.customer_notices where visit_id = $1`, [fourth.id]);
      assert.deepEqual({ v, charges, notes }, { v: { status: "cancelled", cancel_reason: "no_access", late_cancel_fee_pence: 0 }, charges: 0, notes: [{ kind: "no_access_fee", payment_id: null }] });
    } finally {
      await sql(`update public.settings set no_access_rule = 'late_cancel_fee', late_cancel_fee_pence = 1500`);
    }
  });

  // Leave nothing of these blocks on Alex's calendar for the flows that follow. (Settling
  // a block's last clean ends it, so either may have ended already.)
  await asAdmin(`select public.admin_end_block('${BLOCK3}', 'e2e: settle flow finished')`).catch(() => {});
  // (The second block only exists if the check above got as far as making it.)
  await asAdmin(`select public.admin_end_block('${BLOCK4}', 'e2e: settle flow finished')`).catch(() => {});

  await page.goto(`${BASE}/admin/jobs`);
  await shoot(page, dir, "admin-jobs");
}
