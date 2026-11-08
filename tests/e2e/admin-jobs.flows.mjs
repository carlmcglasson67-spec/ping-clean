// Track C: admin jobs, end to end. Loaded by admin.flows.mjs, signed in as the seeded admin.
import assert from "node:assert/strict";

const ADMIN = "00000000-0000-4000-a000-000000000001";
const BEN = "00000000-0000-4000-a000-000000000003";
const ALEX = "00000000-0000-4000-a000-000000000005";
const HOME = "00000000-0000-4000-b000-0000000000e1";
const BLOCK = "00000000-0000-4000-c000-0000000000e1";
const BLOCK2 = "00000000-0000-4000-c000-0000000000e2";

/** An unclaimed block at a new home of Ben's in Whitehaven (CA28, which Alex covers). */
async function unclaimedBlock(sql, id, weeksAhead) {
  await sql(
    `insert into public.series (id, property_id, customer_id, frequency, preferred_day, window_start, window_end, duration_minutes,
                                price_per_hour_pence, commission_type, commission_value, status, starts_on, block_size, offering_since)
     values ($1, $2, $3, 'weekly', 2, '09:00', '13:00', 120, 2000, 'percent', 2500, 'unclaimed',
             (now() at time zone 'Europe/London')::date + $4::int, 2, now() - interval '1 day')`,
    [id, HOME, BEN, weeksAhead * 7]);
}

export default async function jobsFlows({ page, BASE, check, dir, sql, settle, shoot }) {
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

  await page.goto(`${BASE}/admin/jobs`);
  await shoot(page, dir, "admin-jobs");
}
