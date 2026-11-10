// Track C: the QC queue, end to end. Loaded by admin.flows.mjs, signed in as the seeded admin.
// Uses the clean Track B's flow completed today (photos really in the bucket, one "couldn't do").
import assert from "node:assert/strict";

const ADMIN = "00000000-0000-4000-a000-000000000001";
const ANNA_TODAY = "00000000-0000-4000-e000-000000000002";

export default async function qcFlows({ page, BASE, check, dir, sql, settle, shoot }) {
  console.log("e2e: admin console, QC (Track C)");
  await page.goto(`${BASE}/admin/qc`);
  await settle(page);
  const queue = page.getByRole("region", { name: /To score/ });
  const card = queue.locator("li").filter({ hasText: "Workington CA14" }).first();

  await check("a finished clean waits with its couldn't-do items and the cleaner's reasons", async () => {
    const [v] = await sql(`select status, couldnt_do_count from public.visits where id = $1`, [ANNA_TODAY]);
    assert.equal(v.status, "completed");
    const skipped = await sql(`select skipped_reason from public.checklist_items where visit_id = $1 and skipped_reason is not null`, [ANNA_TODAY]);
    const text = await card.innerText();
    assert.match(text, new RegExp(`${v.couldnt_do_count} couldn.t do`));
    for (const s of skipped) assert.ok(text.includes(s.skipped_reason), "shows the reason");
  });

  await check("before and after photos load through 10-minute signed links", async () => {
    const imgs = card.locator("img");
    assert.ok((await imgs.count()) >= 2, "a before and an after photo");
    for (const img of await imgs.all()) {
      const src = await img.getAttribute("src");
      assert.match(src, /\/object\/sign\/visit-photos\//);
      const exp = Number(new URL(src).searchParams.get("token").split(".")[0]);
      assert.ok(exp - Date.now() / 1000 <= 600, "expires within 10 minutes");
      const res = await page.request.get(src);
      assert.equal(res.status(), 200, "the signed link serves the photo");
      assert.ok((await res.body()).length > 0, "and it isn't empty");
    }
  });

  await check("scoring needs a score; saved once, against the admin, notes kept out of the log", async () => {
    assert.ok(await card.getByRole("button", { name: "Choose a score" }).isDisabled());
    await card.getByText("8", { exact: true }).click();
    await card.getByLabel(/Notes/).fill("Kitchen spotless. Back bedroom locked, as noted.");
    await shoot(page, dir, "admin-qc");
    await card.getByRole("button", { name: "Save score: 8" }).click();
    await page.getByText("Every finished clean is scored").waitFor();
    const [q] = await sql(`select score, notes, reviewed_by from public.visit_qc where visit_id = $1`, [ANNA_TODAY]);
    assert.deepEqual(q, { score: 8, notes: "Kitchen spotless. Back bedroom locked, as noted.", reviewed_by: ADMIN });
    const [a] = await sql(`select actor_id, detail from public.audit_log where entity = 'visit_qc' order by id desc limit 1`);
    assert.equal(a.actor_id, ADMIN);
    assert.equal(a.detail.notes, "changed");
  });

  await check("the new score is listed under recently scored", async () => {
    const recent = await page.getByRole("region", { name: "Recently scored" }).locator("li").first().innerText();
    assert.match(recent, /8\s*\/10[\s\S]*Workington CA14/);
  });

  await check("a clean someone else scored meanwhile can't be scored twice", async () => {
    // A second finished clean for the queue, scored by "someone else" after the page loaded.
    const [v] = await sql(
      `insert into public.visits (series_id, customer_id, cleaner_id, scheduled_date, window_start, window_end, duration_minutes, status, started_at, completed_at, price_pence, cleaner_earnings_pence, ping_fee_pence)
       select series_id, customer_id, cleaner_id, scheduled_date - 14, window_start, window_end, duration_minutes, 'completed', now() - interval '3 hours', now() - interval '1 hour', price_pence, cleaner_earnings_pence, ping_fee_pence
       from public.visits where id = $1 returning id`, [ANNA_TODAY]);
    await page.reload();
    await settle(page);
    const c = page.getByRole("region", { name: /To score/ }).locator("li").first();
    await c.getByText("6", { exact: true }).click();
    await sql(`insert into public.visit_qc (visit_id, score, reviewed_by) values ($1, 7, $2)`, [v.id, ADMIN]);
    await c.getByRole("button", { name: "Save score: 6" }).click();
    await c.getByText("Someone on the team has already scored this clean.").waitFor();
    const [q] = await sql(`select score from public.visit_qc where visit_id = $1`, [v.id]);
    assert.equal(q.score, 7);
  });

  await page.goto(`${BASE}/admin/qc`);
  await shoot(page, dir, "admin-qc-empty");

  await check("more than a page waiting: pages through them all, none dropped", async () => {
    // 13 older finished cleans (12 a page), on dates no other clean uses.
    await sql(
      `insert into public.visits (series_id, customer_id, cleaner_id, scheduled_date, window_start, window_end, duration_minutes, status, started_at, completed_at, price_pence, cleaner_earnings_pence, ping_fee_pence)
       select v.series_id, v.customer_id, v.cleaner_id, v.scheduled_date - 100 - g, v.window_start, v.window_end, v.duration_minutes, 'completed',
              now() - make_interval(days => 100 + g), now() - make_interval(days => 100 + g) + interval '2 hours', v.price_pence, v.cleaner_earnings_pence, v.ping_fee_pence
       from public.visits v, generate_series(1, 13) g where v.id = $1`, [ANNA_TODAY]);
    const [{ n }] = await sql(`select count(*)::int as n from public.visits v where v.status = 'completed' and not exists (select 1 from public.visit_qc q where q.visit_id = v.id)`);
    assert.equal(n, 13);
    await page.goto(`${BASE}/admin/qc`);
    await settle(page);
    const queueItems = () => page.getByRole("region", { name: /To score/ }).locator(":scope > ul > li");
    assert.equal(await queueItems().count(), 12);
    await page.getByText("Page 1 of 2 · 13 to score").waitFor();
    await page.getByRole("link", { name: "Next 12" }).click();
    await page.waitForURL((u) => u.searchParams.get("page") === "2");
    await settle(page);
    assert.equal(await queueItems().count(), 1);
    await page.getByRole("link", { name: "Previous 12" }).waitFor();
    await page.goto(`${BASE}/admin/qc?page=99`); // a page that doesn't exist shows the last one
    await settle(page);
    await page.getByText("Page 2 of 2 · 13 to score").waitFor();
  });
}
