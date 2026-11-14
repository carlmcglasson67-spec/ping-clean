// The launch page, end to end: /launch says what Ping is, and a customer and a would-be
// cleaner each register with a few answers. Real Postgres, real register_launch_interest
// (called by the Server Action through the service-role client).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import pg from "pg";

const db = () => new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
const THANKS = "Thanks. You’re on the list.";

async function rowsFor(contact) {
  const c = db();
  await c.connect();
  try {
    const { rows } = await c.query(
      `select kind, first_name, postcode, email, phone, source, answers from public.interest_signups where email = $1 or phone = $1 order by kind`,
      [contact],
    );
    return rows;
  } finally {
    await c.end();
  }
}

const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200); // let the entrance animations finish
};

export async function launchFlows({ browser, BASE, check, shots }) {
  console.log("e2e: launch page");
  mkdirSync(shots, { recursive: true });

  await check("says what Ping is, with no price anywhere and regular cleans only", async () => {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1 });
      await page.goto(`${BASE}/launch`, { waitUntil: "networkidle" });
      await settle(page);
      const text = await page.locator("main").innerText();
      for (const s of ["cleaners to clients.", "What Ping Clean is", "clean for a living.", "West Cumbria, town by town.", "Workington", "Be first in"]) {
        // Case-insensitive: the small labels are set in capitals by the stylesheet.
        assert.ok(text.toLowerCase().includes(s.toLowerCase()), `expected to see "${s}" at ${width}px`);
      }
      assert.doesNotMatch(text, /£\s?\d/, "no price on the launch page");
      assert.doesNotMatch(text, /deep clean|end of tenancy|changeover|airbnb/i, "regular domestic cleans only");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `no sideways scroll at ${width}px`);
      await page.screenshot({ path: `${shots}/launch-${width}.png`, fullPage: true });
      await page.close();
    }
  });

  await check("without the tick nothing is stored, the form says why, and keeps what was typed and tapped", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/launch`);
    const form = page.locator("#register form");
    await form.getByLabel("Your postcode").fill("ca14 3xx");
    await form.getByLabel("Email address").fill("no-tick@example.com");
    await form.getByText("Every week", { exact: true }).click();
    await form.getByRole("button", { name: "Put me on the list" }).click();
    await form.getByText("Tick “Tell me when booking opens near me” so we can let you know.").waitFor();
    assert.equal(await form.getByLabel("Email address").inputValue(), "no-tick@example.com");
    assert.equal(await form.getByRole("checkbox", { name: "Every week" }).isChecked(), true);
    assert.equal((await rowsFor("no-tick@example.com")).length, 0);
    await page.close();
  });

  await check("a customer registers with a name and answers, and can only pick three priorities", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/launch`);
    const form = page.locator("#register form");
    await form.getByLabel("First name").fill("Jo");
    await form.getByLabel("Your postcode").fill("ca14 3xx");
    await form.getByLabel("Email address").fill("Launch.Customer@Example.com");
    await form.getByText("Every two weeks", { exact: true }).click();
    await form.getByRole("checkbox", { name: "3", exact: true }).check({ force: true });
    for (const p of ["The same cleaner each time", "Turning up when they say", "Proof it’s been done"]) await form.getByText(p, { exact: true }).click();
    assert.equal(await form.getByRole("checkbox", { name: "No contract" }).isDisabled(), true, "a fourth priority can't be picked");
    await form.getByText("3 of 5 answered").waitFor();
    await form.getByLabel(/What has let you down/).fill("They never turned up.");
    await form.getByText("Tell me when booking opens near me").click();
    await form.getByRole("button", { name: "Put me on the list" }).click();
    await page.getByText(THANKS).waitFor();
    // The long form has become a short card: it must be brought into view, not left above the fold.
    await page.waitForTimeout(900);
    const box = await page.getByRole("status").boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 900 + 1, "the thanks card is fully on screen after sending");
    await page.screenshot({ path: `${shots}/launch-thanks-1440.png` });
    const rows = await rowsFor("launch.customer@example.com");
    assert.equal(rows.length, 1);
    assert.deepEqual({ ...rows[0] }, {
      kind: "customer", first_name: "Jo", postcode: "CA14 3XX", email: "launch.customer@example.com", phone: null, source: "launch_page",
      answers: { frequency: "fortnightly", bedrooms: "3", priorities: ["same_cleaner", "reliable", "proof"], note: "They never turned up." },
    });
    await page.close();
  });

  await check("'I want to clean with Ping' opens the cleaner side, and a cleaner registers by text message", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/launch`);
    await page.getByRole("link", { name: "I want to clean with Ping" }).click();
    await page.waitForURL((u) => u.searchParams.get("as") === "cleaner");
    const form = page.locator("#register form");
    await form.getByText("A few quick questions about your work").waitFor();
    await form.getByLabel("Your postcode").fill("CA28 6AA");
    await form.getByText("Text message").click();
    await form.getByLabel("UK mobile number").fill("07700 900777");
    await form.getByText("More than 3 years", { exact: true }).click();
    await form.getByText("Weekends", { exact: true }).click();
    await form.getByText("Evenings", { exact: true }).click();
    await form.getByText("Tell me when Ping is taking on cleaners near me").click();
    await settle(page);
    // Nothing in the register panel may be wider than the phone: the panel clips what overflows,
    // so an over-wide button or chip would silently cut the card off (design review BLOCK).
    const wide = await page.evaluate(() => {
      const max = document.documentElement.clientWidth;
      return [...document.querySelectorAll("#register *")]
        .filter((el) => el.getBoundingClientRect().width > 0 && (el.getBoundingClientRect().right > max + 0.5 || el.getBoundingClientRect().left < -0.5))
        .filter((el) => !el.closest("[aria-hidden]"))
        .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`)
        .slice(0, 5);
    });
    assert.deepEqual(wide, [], "everything in the register panel fits a 390px screen");
    await page.locator("#register").screenshot({ path: `${shots}/launch-form-cleaner-390.png` });
    await form.getByRole("button", { name: "Join the cleaners’ list" }).click();
    await page.getByText(THANKS).waitFor();
    await page.waitForTimeout(900);
    const box = await page.getByRole("status").boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 844 + 1, "the thanks card is fully on screen on a phone");
    await page.screenshot({ path: `${shots}/launch-thanks-390.png` });
    await page.getByRole("link", { name: /See how cleaning with Ping works/ }).waitFor();
    const rows = await rowsFor("+447700900777");
    assert.equal(rows.length, 1);
    assert.deepEqual({ ...rows[0] }, {
      kind: "cleaner", first_name: null, postcode: "CA28 6AA", email: null, phone: "+447700900777", source: "launch_page",
      // Stored in the order the options appear on the page, not the order they were tapped.
      answers: { experience: "over_3", availability: ["evenings", "weekends"] },
    });
    await page.close();
  });

  await check("registering again shows the same thanks and still one row, with the new answers", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/launch`);
    const form = page.locator("#register form");
    await form.getByLabel("Your postcode").fill("CA14 3XX");
    await form.getByLabel("Email address").fill("launch.customer@example.com");
    await form.getByText("Every week", { exact: true }).click();
    await form.getByText("Tell me when booking opens near me").click();
    await form.getByRole("button", { name: "Put me on the list" }).click();
    await page.getByText(THANKS).waitFor();
    const rows = await rowsFor("launch.customer@example.com");
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].answers, { frequency: "weekly" });
    await page.close();
  });

  await check("the footer links to the launch list", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/`);
    await page.getByRole("contentinfo").getByRole("link", { name: "Launch list" }).click();
    await page.waitForURL(`${BASE}/launch`);
    await page.close();
  });
}
