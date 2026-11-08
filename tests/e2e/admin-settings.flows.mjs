// Track C: admin settings, end to end. Loaded by admin.flows.mjs, signed in as the seeded admin.
// Runs last of the admin sections (name order): it changes the price.
import assert from "node:assert/strict";

const ADMIN = "00000000-0000-4000-a000-000000000001";

export default async function settingsFlows({ page, BASE, check, dir, sql, settle, shoot }) {
  console.log("e2e: admin console, settings (Track C)");
  const price = () => page.getByLabel("Customer price per hour");
  const review = () => page.getByRole("button", { name: /^Review/ });
  const example = async () => ({
    price: await page.getByTestId("example-price").innerText(),
    earns: await page.getByTestId("example-earnings").innerText(),
    fee: await page.getByTestId("example-fee").innerText(),
  });

  await page.goto(`${BASE}/admin/settings`);
  await settle(page);

  await check("shows what's saved, in pounds and hours, and an exact worked example", async () => {
    const [s] = await sql(`select price_per_hour_pence, min_booking_minutes, commission_value from public.settings`);
    assert.deepEqual(s, { price_per_hour_pence: 2000, min_booking_minutes: 120, commission_value: 2500 });
    assert.equal(await price().inputValue(), "20.00");
    assert.equal(await page.getByLabel("Minimum booking").inputValue(), "2");
    assert.equal(await page.getByLabel("Commission", { exact: true }).inputValue(), "25");
    assert.deepEqual(await example(), { price: "£40.00", earns: "£30.00", fee: "£10.00" });
    assert.match(await page.getByLabel("Previous cleaner gets a rebook first, for").inputValue(), /^$/, "unset stays empty");
  });

  await check("the example follows the numbers as they're typed, to the penny", async () => {
    await price().fill("22.50");
    assert.deepEqual(await example(), { price: "£45.00", earns: "£33.75", fee: "£11.25" });
    await page.getByLabel("Length of clean").selectOption("150");
    assert.deepEqual(await example(), { price: "£56.25", earns: "£42.19", fee: "£14.06" });
  });

  await check("a value that isn't clean pounds and pence is refused before review", async () => {
    await price().fill("22.505");
    await page.getByText("Enter pounds and pence.").waitFor();
    assert.ok(await review().isDisabled());
    await price().fill("22.50");
  });

  await check("changing the commission type clears its value, so it's typed in for the right one", async () => {
    await page.getByText("Per hour", { exact: true }).click();
    assert.equal(await page.getByLabel("Commission", { exact: true }).inputValue(), "");
    await page.getByText("Type the commission, or clear the type too.").waitFor();
    assert.ok(await review().isDisabled());
    await page.getByText("A percentage", { exact: true }).click();
    await page.getByLabel("Commission", { exact: true }).fill("25");
  });

  await check("review lists old → new; nothing is saved until confirmed", async () => {
    await review().click();
    const panel = page.getByRole("region", { name: "Check before saving" });
    const text = await panel.innerText();
    assert.match(text, /Customer price per hour[\s\S]*£20\.00 an hour[\s\S]*£22\.50 an hour/);
    assert.match(text, /keep the price and commission they were booked at/);
    const [s] = await sql(`select price_per_hour_pence from public.settings`);
    assert.equal(s.price_per_hour_pence, 2000, "not saved yet");
  });

  await check("confirmed: saved in pence and logged against the admin, old and new", async () => {
    await page.getByRole("button", { name: "Save these changes" }).click();
    await page.getByText("Saved. 1 setting changed.").waitFor();
    const [s] = await sql(`select price_per_hour_pence, commission_value from public.settings`);
    assert.deepEqual(s, { price_per_hour_pence: 2250, commission_value: 2500 });
    const [a] = await sql(`select actor_id, detail from public.audit_log where entity = 'settings' order by id desc limit 1`);
    assert.equal(a.actor_id, ADMIN);
    assert.deepEqual(a.detail, { price_per_hour_pence: { from: 2000, to: 2250 } });
  });

  await check("clearing a required number warns that booking switches off", async () => {
    await page.reload();
    await settle(page);
    await page.getByLabel("Launch postcode districts").fill("");
    await review().click();
    await page.getByRole("region", { name: "Check before saving" }).getByText(/This switches booking off/).waitFor();
    await shoot(page, dir, "admin-settings-review");
    await page.getByRole("button", { name: "Back to editing" }).click();
  });

  await check("if someone else saved meanwhile, nothing is overwritten", async () => {
    await page.reload();
    await settle(page);
    await sql(`update public.settings set cancel_notice_hours = 12`); // another admin, after this page loaded
    await price().fill("21.00");
    await review().click();
    await page.getByRole("button", { name: "Save these changes" }).click();
    await page.getByText(/changed the settings while you were editing/).waitFor();
    const [s] = await sql(`select price_per_hour_pence, cancel_notice_hours from public.settings`);
    assert.deepEqual(s, { price_per_hour_pence: 2250, cancel_notice_hours: 12 });
  });

  await page.goto(`${BASE}/admin/settings`);
  await shoot(page, dir, "admin-settings");
}
