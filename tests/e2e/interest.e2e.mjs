// Register interest, end to end: the form on the instant-price result outside the launch
// area, and on the "Booking opens soon" state while prices are unset. Real Postgres, real
// register_interest (called by the Server Action through the service-role client).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import pg from "pg";

const db = () => new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
const THANKS = "Thanks. We’ll be in touch.";

async function rowsFor(contact) {
  const c = db();
  await c.connect();
  try {
    const { rows } = await c.query(
      `select postcode, email, phone, source from public.interest_signups where email = $1 or phone = $1`,
      [contact],
    );
    return rows;
  } finally {
    await c.end();
  }
}

async function withPricesUnset(fn) {
  const c = db();
  await c.connect();
  const { rows } = await c.query(`select price_per_hour_pence, min_booking_minutes from public.settings where id`);
  await c.query(`update public.settings set price_per_hour_pence = null, min_booking_minutes = null where id`);
  try {
    return await fn();
  } finally {
    await c.query(`update public.settings set price_per_hour_pence = $1, min_booking_minutes = $2 where id`, [rows[0].price_per_hour_pence, rows[0].min_booking_minutes]);
    await c.end();
  }
}

const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
};

export async function interestFlows({ browser, BASE, check, shots }) {
  console.log("e2e: register interest");
  mkdirSync(shots, { recursive: true });

  await check("an out-of-area postcode on the instant price shows the form, postcode filled in", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/price`);
    await page.getByLabel("Your postcode").first().fill("LA1 1AA");
    await page.getByText("Not in LA1 yet").waitFor();
    const form = page.locator("[data-instant-result] form");
    await form.waitFor();
    assert.equal(await form.getByLabel("Your postcode").inputValue(), "LA1 1AA");
    assert.equal(await form.getByRole("checkbox", { name: "Tell me when booking opens near me" }).isChecked(), false);
    await page.close();
  });

  await check("without the tick nothing is stored, and the form says why", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/price`);
    await page.getByLabel("Your postcode").first().fill("LA1 1AA");
    const form = page.locator("[data-instant-result] form");
    await form.getByLabel("Email address").fill("no-tick@example.com");
    await form.getByRole("button", { name: "Let me know" }).click();
    await form.getByText("Tick “Tell me when booking opens near me” so we can let you know.").waitFor();
    // What they typed is kept.
    assert.equal(await form.getByLabel("Email address").inputValue(), "no-tick@example.com");
    assert.equal((await rowsFor("no-tick@example.com")).length, 0);
    await page.close();
  });

  await check("ticked: thanks, and one row from the instant price", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/price`);
    await page.getByLabel("Your postcode").first().fill("LA1 1AA");
    const form = page.locator("[data-instant-result] form");
    await form.getByLabel("Email address").fill("Lancaster.Person@Example.com");
    await form.getByText("Tell me when booking opens near me").click();
    await form.getByRole("button", { name: "Let me know" }).click();
    await page.getByText(THANKS).waitFor();
    const rows = await rowsFor("lancaster.person@example.com");
    assert.equal(rows.length, 1);
    assert.deepEqual({ ...rows[0] }, { postcode: "LA1 1AA", email: "lancaster.person@example.com", phone: null, source: "instant_price" });
    await page.close();
  });

  await check("registering again shows the same thanks, and still one row", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/price`);
    await page.getByLabel("Your postcode").first().fill("LA1 1AA");
    const form = page.locator("[data-instant-result] form");
    await form.getByLabel("Email address").fill("lancaster.person@example.com");
    await form.getByText("Tell me when booking opens near me").click();
    await form.getByRole("button", { name: "Let me know" }).click();
    await page.getByText(THANKS).waitFor();
    assert.equal((await rowsFor("lancaster.person@example.com")).length, 1);
    await page.close();
  });

  await withPricesUnset(async () => {
    await check("while prices are unset, home shows the form; a mobile registers from the holding page", async () => {
      const page = await browser.newPage();
      await page.goto(`${BASE}/`);
      const panel = page.locator("#price");
      await panel.getByText("Booking opens soon.").waitFor();
      const form = panel.locator("form");
      await form.getByLabel("Your postcode").fill("ca28 4ab");
      await form.getByText("Text message").click();
      await form.getByLabel("UK mobile number").fill("07700 900321");
      await form.getByText("Tell me when booking opens near me").click();
      await form.getByRole("button", { name: "Let me know" }).click();
      await panel.getByText(THANKS).waitFor();
      const rows = await rowsFor("+447700900321");
      assert.equal(rows.length, 1);
      assert.deepEqual({ ...rows[0] }, { postcode: "CA28 4AB", email: null, phone: "+447700900321", source: "holding_page" });
      assert.doesNotMatch(await page.locator("main").innerText(), /£\s?\d/);
      await page.close();
    });

    // Design review: the holding-page placement.
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1 });
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      const panel = page.locator("#price");
      await panel.scrollIntoViewIfNeeded();
      await settle(page);
      await panel.screenshot({ path: `${shots}/interest-holding-${width}.png` });
      await page.close();
    }
  });

  // Design review: the instant-price placement.
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1 });
    await page.goto(`${BASE}/price`, { waitUntil: "networkidle" });
    await page.getByLabel("Your postcode").first().fill("LA1 1AA");
    await page.locator("[data-instant-result] form").waitFor();
    await settle(page);
    await page.locator("[data-instant-result]").locator("..").screenshot({ path: `${shots}/interest-instant-price-${width}.png` });
    await page.close();
  }
}
