// Track C: register interest, end to end. Loaded by admin.flows.mjs, signed in as the seeded admin.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ADMIN = "00000000-0000-4000-a000-000000000001";

export default async function interestFlows({ page, browser, signIn, BASE, check, dir, sql, settle, shoot }) {
  console.log("e2e: admin console, register interest (Track C)");
  for (const [pc, email, phone] of [["CA25 1AA", "jo@example.com", null], ["CA25 2BB", null, "07700 900123"], ["LA9 4QQ", "=cmd@evil.example", null]]) {
    await sql(`select public.register_interest($1, $2, $3, true, 'instant_price', 'e2e-v1')`, [pc, email, phone]);
  }
  await page.goto(`${BASE}/admin/interest`);
  await settle(page);
  const main = () => page.locator("main").innerText();

  await check("counts by district, and every contact masked", async () => {
    const districts = await page.getByRole("region", { name: "By postcode district" }).innerText();
    assert.match(districts, /CA25[\s\S]*2/);
    assert.match(districts, /LA9[\s\S]*1/);
    const text = await main();
    assert.match(text, /j•••@example\.com/);
    assert.match(text, /•••123/);
    assert.ok(!text.includes("jo@example.com") && !text.includes("900123") && !text.includes("cmd@evil"), "no full contact on the page");
  });

  await check("a district filters the list", async () => {
    await page.getByRole("link", { name: /^CA25/ }).click();
    await page.waitForURL((u) => u.searchParams.get("district") === "CA25");
    await settle(page);
    const people = await page.getByRole("region", { name: /CA25: 2/ }).innerText();
    assert.ok(!people.includes("evil"), "LA9 left out");
  });

  await check("the CSV export downloads, warns about Excel, defuses formulas, and is logged without contacts", async () => {
    await page.goto(`${BASE}/admin/interest`);
    await settle(page);
    await page.getByText("Import directly into your SMS tool; don't re-save in Excel.").waitFor();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export all as CSV" }).click()]);
    assert.match(download.suggestedFilename(), /^ping-interest-all-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile(await download.path(), "utf8");
    assert.match(csv, /^kind,first_name,postcode,postcode_district,email,phone,registered_at,notified_at,answers\r\n/);
    assert.match(csv, /"jo@example\.com"/);
    // Before #31: "'+447700900123" (a leading + was treated as a formula). After #31: "447700900123".
    // Both pass; tighten to the second once #31 is on main.
    assert.match(csv, /"(?:'\+)?447700900123"/);
    assert.match(csv, /"'=cmd@evil\.example"/, "a formula-looking value is defused");
    const [a] = await sql(`select actor_id, detail from public.audit_log where entity = 'interest_signups' and action = 'export' order by id desc limit 1`);
    assert.equal(a.actor_id, ADMIN);
    // Every row on the list, however many the public form's own flows added before this ran.
    const [{ n }] = await sql(`select count(*)::int as n from public.interest_signups`);
    assert.ok(n >= 3, "the three seeded for this flow are there");
    assert.deepEqual(a.detail, { district: "all", rows: n });
    assert.equal(csv.trimEnd().split("\r\n").length - 1, n, "one CSV line per row");
  });

  await check("the export can't be pulled cross-site or by anyone but an admin", async () => {
    const cross = await page.request.post(`${BASE}/admin/interest/export`, { form: { district: "" }, headers: { origin: "https://evil.example" }, maxRedirects: 0 });
    assert.equal(cross.status(), 403);
    const ctx = await browser.newContext();
    const anna = await ctx.newPage();
    await signIn(anna, "anna.customer");
    await anna.waitForURL((u) => u.pathname === "/account");
    const res = await anna.request.post(`${BASE}/admin/interest/export`, { form: { district: "" }, maxRedirects: 0 });
    assert.ok(res.status() === 404 || res.status() === 307, `customer gets nothing (got ${res.status()})`);
    assert.ok(!(await res.text()).includes("jo@example.com"));
    await ctx.close();
  });

  const row = (masked) => page.locator("li").filter({ hasText: masked }).filter({ has: page.getByRole("checkbox") });

  await check("mark as told, and undo", async () => {
    await row("j•••@example.com").getByRole("checkbox").check();
    await page.getByRole("button", { name: /^Mark 1 as told$/ }).click();
    await page.getByText("Marked 1 person as told.").waitFor();
    let [r] = await sql(`select notified_at is not null as told from public.interest_signups where email = 'jo@example.com'`);
    assert.equal(r.told, true);
    await row("j•••@example.com").getByText(/^Told /).waitFor();
    await row("j•••@example.com").getByRole("checkbox").check();
    await page.getByRole("button", { name: "Undo told" }).click();
    await page.getByText('1 person back to "not told yet".').waitFor();
    [r] = await sql(`select notified_at is not null as told from public.interest_signups where email = 'jo@example.com'`);
    assert.equal(r.told, false);
  });

  await check("delete on request: must say how it arrived and confirm the sender matches", async () => {
    const r = row("j•••@example.com");
    await r.getByRole("button", { name: "Delete on request" }).click();
    const del = r.getByRole("button", { name: "Delete permanently" });
    assert.ok(await del.isDisabled(), "disabled until both are answered");
    await r.getByLabel("By text message").check();
    await r.getByRole("checkbox", { name: /checked the request came from/ }).check();
    await shoot(page, dir, "admin-interest-delete");
    await del.click();
    await page.getByText(/A request by text can.t prove it.s theirs/).waitFor();
    const [still] = await sql(`select count(*)::int as n from public.interest_signups where email = 'jo@example.com'`);
    assert.equal(still.n, 1, "not deleted on a mismatched channel");
    await r.getByLabel("By email").check();
    await del.click();
    await page.getByText("Deleted. It can't be brought back.").waitFor();
    const [gone] = await sql(`select count(*)::int as n from public.interest_signups where email = 'jo@example.com'`);
    assert.equal(gone.n, 0);
    const [a] = await sql(`select actor_id, detail from public.audit_log where entity = 'interest_signups' and action = 'delete' order by id desc limit 1`);
    assert.equal(a.actor_id, ADMIN);
    assert.equal(a.detail.email, "changed", "the log never holds the contact");
  });

  await page.goto(`${BASE}/admin/interest`);
  await shoot(page, dir, "admin-interest");
}
