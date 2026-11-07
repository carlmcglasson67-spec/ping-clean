// Sign up, ?next= return, and password reset, end to end against the fake Supabase.
// Email links come from the stub's test outbox (built as Ping's email templates build them).
import assert from "node:assert/strict";
import pg from "pg";

const FAKE = "http://127.0.0.1:54321";
const db = () => new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });

async function mailFor(email, type) {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${FAKE}/__test/mail?email=${encodeURIComponent(email)}&type=${type}`);
    if (r.ok) return (await r.json()).link;
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error(`no ${type} email for ${email}`);
}
/** Opening an email link only shows a button; pressing it uses the link (review fix 3). */
async function openLink(page, link, button = /Confirm my email|Continue to reset your password/) {
  await page.goto(link);
  await page.getByRole("button", { name: button }).click();
}
/** After confirming: the page names the signed-in account (re-review N6), then Continue. */
async function continueAfterConfirm(page, email) {
  await page.waitForURL((u) => u.pathname === "/auth/confirmed");
  const masked = `${email[0]}•••${email.slice(email.lastIndexOf("@"))}`;
  await page.getByText(masked).waitFor();
  await page.getByRole("link", { name: "Continue" }).click();
}
const setConfirm = (confirm) => fetch(`${FAKE}/__test/config`, { method: "POST", body: JSON.stringify({ confirm }) });

async function fillSignup(page, { name, email, password, phone = "", terms = true, privacy = true }) {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Create a password").fill(password);
  if (phone) await page.getByLabel("Mobile number (optional)").fill(phone);
  if (terms) await page.getByLabel(/terms of use/).check();
  if (privacy) await page.getByLabel(/privacy notice/).check();
  await page.getByRole("button", { name: "Create my account" }).click();
}

/** Every path the browser asks for while fn runs (navigations and RSC fetches alike). */
async function pathsVisited(page, fn) {
  const seen = [];
  const onRequest = (r) => { try { seen.push(new URL(r.url()).pathname); } catch {} };
  page.on("request", onRequest);
  try { await fn(); } finally { page.off("request", onRequest); }
  return seen;
}

export async function authFlows({ browser, BASE, check, shots }) {
  const password = "blue kettle 42";
  const nia = { name: "Nia Test", email: `nia.${Date.now()}@ping.test`, password, phone: "07700 900321" };

  console.log("e2e: sign up and reset");

  await check("refuses a weak password and missing consent, in plain words", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/signup`);
    await fillSignup(page, { name: "Weak Test", email: "weak@ping.test", password: "password123", terms: false, privacy: false });
    await page.getByText("That one's too easy to guess").first().waitFor();
    await page.getByText("Tick to agree to the terms of use.").waitFor();
    await page.getByText("Tick to say you've read the privacy notice.").waitFor();
    await page.close();
  });

  await check("signs up, confirms by email and lands in My cleans, as a customer, with the phone saved", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/signup`);
    await page.evaluate(() => document.fonts.ready);
    if (shots) await page.screenshot({ path: `${shots}/signup-1440.png`, fullPage: true });
    await fillSignup(page, nia);
    await page.getByTestId("check-email").waitFor();
    if (shots) await page.screenshot({ path: `${shots}/signup-check-email-1440.png`, fullPage: true });
    const link = await mailFor(nia.email, "signup");
    assert.match(link, /\/auth\/confirm\?flow=signup&token_hash=[0-9a-f]+&type=email$/);
    await page.goto(link);
    await page.getByRole("button", { name: "Confirm my email" }).waitFor();
    if (shots) await page.screenshot({ path: `${shots}/confirm-email-1440.png`, fullPage: true });
    await page.getByRole("button", { name: "Confirm my email" }).click();
    await page.waitForURL((u) => u.pathname === "/auth/confirmed");
    await page.getByText("Not you?").waitFor();
    if (shots) await page.screenshot({ path: `${shots}/confirmed-1440.png`, fullPage: true });
    await continueAfterConfirm(page, nia.email);
    await page.waitForURL(`${BASE}/account`);
    await page.getByRole("heading", { name: "Hello, Nia." }).waitFor();
    const c = db(); await c.connect();
    const { rows } = await c.query(`select p.role, p.phone, u.raw_user_meta_data ->> 'terms_version' as terms,
      u.raw_user_meta_data ->> 'phone' as meta_phone from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [nia.email]);
    await c.end();
    // The phone now lives on the profile only (review fix 7).
    assert.deepEqual(rows[0], { role: "customer", phone: "07700 900321", terms: "draft-2026-11", meta_phone: null });
    await ctx.close();
  });

  await check("gives the same answer for an address that already has an account", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/signup`);
    await fillSignup(page, { name: "Anna Again", email: "anna.customer@ping.test", password });
    await page.getByTestId("check-email").waitFor();
    await page.close();
  });

  await check("a confirmation link works once", async () => {
    const page = await browser.newPage();
    const link = await mailFor(nia.email, "signup");
    await openLink(page, link);
    await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("link") === "expired");
    await page.getByText("That link has expired or has already been used").waitFor();
    await page.close();
  });

  await check("just opening an email link (as a mail scanner does) uses nothing and signs nobody in (review fix 3)", async () => {
    const scan = await browser.newContext();
    const sp = await scan.newPage();
    const zoe = { name: "Zoe Test", email: `zoe.${Date.now()}@ping.test`, password };
    await sp.goto(`${BASE}/signup`);
    await fillSignup(sp, zoe);
    await sp.getByTestId("check-email").waitFor();
    const link = await mailFor(zoe.email, "signup");
    const scanner = await browser.newContext();
    const s2 = await scanner.newPage();
    const res = await s2.goto(link); // a plain GET, no button press
    assert.equal(res.status(), 200);
    assert.equal(new URL(s2.url()).pathname, "/auth/confirm");
    const cookies = await scanner.cookies();
    assert.ok(!cookies.some((k) => k.name.includes("auth-token")), "a GET must not create a session");
    await scanner.close();
    await openLink(sp, link); // the real person, later: still works
    await continueAfterConfirm(sp, zoe.email);
    await sp.waitForURL(`${BASE}/account`);
    await scan.close();
  });

  await check("the cleaner application sends new people to sign up and brings them back to /work/apply (B1)", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/work/apply`);
    // Straight to sign-up (Track B's request): most applicants are new to Ping.
    assert.equal(new URL(page.url()).pathname, "/signup");
    assert.equal(new URL(page.url()).searchParams.get("next"), "/work/apply");
    assert.equal(await page.getByRole("link", { name: "Sign in" }).getAttribute("href"), "/login?next=%2Fwork%2Fapply");
    await page.getByText("Your regulars.").waitFor(); // the cleaner version of the page
    const owen = { name: "Owen Test", email: `owen.${Date.now()}@ping.test`, password };
    await fillSignup(page, owen);
    await page.getByTestId("check-email").waitFor();
    const link = await mailFor(owen.email, "signup");
    assert.match(link, /next=%2Fwork%2Fapply/);
    const seen = await pathsVisited(page, async () => {
      await openLink(page, link);
      await continueAfterConfirm(page, owen.email);
      await page.waitForLoadState("networkidle");
    });
    // Sent on to the application. (Until Track B's /work/apply page is merged, main's
    // cleaner-only /work layout then bounces a customer to /account.)
    assert.ok(seen.includes("/work/apply"), `expected a visit to /work/apply, saw ${seen.join(", ")}`);
    await ctx.close();
  });

  await check("a signed-out visitor to checkout is sent to sign-up, every other app page to sign-in", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/account/book`);
    assert.equal(new URL(page.url()).pathname, "/signup");
    assert.equal(new URL(page.url()).searchParams.get("next"), "/account/book");
    await page.goto(`${BASE}/account`);
    assert.equal(new URL(page.url()).pathname, "/login");
    await page.close();
  });

  await check("an existing customer signing in from /work/apply is sent back there too (B1)", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login?next=${encodeURIComponent("/work/apply")}`);
    await page.getByLabel("Email").fill("ben.customer@ping.test");
    await page.getByLabel("Password").fill("ping-test-2026");
    const seen = await pathsVisited(page, async () => {
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
    });
    assert.ok(seen.includes("/work/apply"), `expected a visit to /work/apply, saw ${seen.join(", ")}`);
    await ctx.close();
  });

  await check("a ?next= pointing off Ping is ignored; with confirmation off the phone still leaves the metadata (N3)", async () => {
    await setConfirm(false);
    try {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${BASE}/signup?next=${encodeURIComponent("https://evil.example/account")}`);
      const ruth = { name: "Ruth Test", email: `ruth.${Date.now()}@ping.test`, password, phone: "07700 900456" };
      await fillSignup(page, ruth);
      // Confirmation is off in this check, so sign-up signs straight in.
      await page.waitForURL(`${BASE}/account`);
      const c = db(); await c.connect();
      const { rows } = await c.query(`select p.phone, u.raw_user_meta_data ->> 'phone' as meta_phone
        from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [ruth.email]);
      await c.end();
      assert.deepEqual(rows[0], { phone: "07700 900456", meta_phone: null });
      await ctx.close();
    } finally {
      await setConfirm(true);
    }
  });

  await check("forgotten password: same answer for any address, link sets a new one, old link then fails", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await page.getByRole("link", { name: "Forgotten your password?" }).click();
    await page.waitForURL(`${BASE}/forgot-password`);
    if (shots) await page.screenshot({ path: `${shots}/forgot-password-1440.png`, fullPage: true });
    await page.getByLabel("Email").fill("nobody.here@ping.test");
    await page.getByRole("button", { name: "Send me a reset link" }).click();
    await page.getByTestId("reset-sent").waitFor();
    const r = await fetch(`${FAKE}/__test/mail?email=nobody.here@ping.test&type=recovery`);
    assert.equal(r.status, 404, "no email for an address without an account");

    await page.goto(`${BASE}/forgot-password`);
    await page.getByLabel("Email").fill(nia.email);
    await page.getByRole("button", { name: "Send me a reset link" }).click();
    await page.getByTestId("reset-sent").waitFor();
    if (shots) await page.screenshot({ path: `${shots}/forgot-password-sent-1440.png`, fullPage: true });

    const link = await mailFor(nia.email, "recovery");
    assert.match(link, /\/auth\/confirm\?flow=reset&token_hash=[0-9a-f]+&type=recovery$/);
    await page.goto(link);
    await page.getByRole("button", { name: "Continue to reset your password" }).waitFor();
    if (shots) await page.screenshot({ path: `${shots}/confirm-reset-1440.png`, fullPage: true });
    await page.getByRole("button", { name: "Continue to reset your password" }).click();
    await page.waitForURL(`${BASE}/reset-password`);
    await page.getByLabel("New password").waitFor();
    if (shots) await page.screenshot({ path: `${shots}/reset-password-1440.png`, fullPage: true });
    await page.getByLabel("New password").fill("green teapot 77");
    await page.getByRole("button", { name: "Save my new password" }).click();
    await page.waitForURL(`${BASE}/account`);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${BASE}/login`); // same host, so the next sign-in's cookie sticks
    await page.getByLabel("Email").fill(nia.email);
    await page.getByLabel("Password").fill("green teapot 77");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${BASE}/account`);

    // The reset link has been used: opening it again changes nothing. (Signed in, so the
    // expired-link notice on /login gives way to their own app.)
    await openLink(page, link);
    await page.waitForURL(`${BASE}/account`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${BASE}/login`);
    await openLink(page, link);
    await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("link") === "expired");
    await page.getByText("That link has expired or has already been used").waitFor();
    await ctx.close();
  });

  await check("the new-password page refuses without a fresh reset link, even when signed in", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/reset-password`);
    await page.getByTestId("reset-expired").waitFor();
    if (shots) await page.screenshot({ path: `${shots}/reset-password-expired-1440.png`, fullPage: true });
    // Signed in normally (no reset link): still refused.
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Email").fill("anna.customer@ping.test");
    await page.getByLabel("Password").fill("ping-test-2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${BASE}/account`);
    await page.goto(`${BASE}/reset-password`);
    await page.getByTestId("reset-expired").waitFor();
    // A hand-built reset cookie (the old scheme, forged in the console) opens nothing:
    // only the signed session token counts now (re-review N1).
    const anna = "00000000-0000-4000-a000-000000000002";
    for (const value of [`${anna}.${Date.now() + 14 * 60_000}`, "1"]) {
      await ctx.addCookies([{ name: "ping-reset", value, url: `${BASE}/reset-password` }]);
      await page.goto(`${BASE}/reset-password`);
      await page.getByTestId("reset-expired").waitFor();
      assert.equal(await page.getByLabel("New password").count(), 0);
    }
    await ctx.close();
  });

  if (shots) await check("screenshots for the review", async () => {
    // Phone widths for the review.
    const ctx =await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const [path, name] of [["/signup", "signup"], ["/signup?next=%2Fwork%2Fapply", "signup-apply"], ["/forgot-password", "forgot-password"], ["/reset-password", "reset-password-expired"], ["/login", "login"]]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${shots}/${name}-390.png`, fullPage: true });
    }
    // The new-password form itself, at phone width: request a link and follow it.
    await page.goto(`${BASE}/forgot-password`);
    await page.getByLabel("Email").fill(nia.email);
    await page.getByRole("button", { name: "Send me a reset link" }).click();
    await page.getByTestId("reset-sent").waitFor();
    await openLink(page, await mailFor(nia.email, "recovery"));
    await page.getByLabel("New password").waitFor();
    await page.screenshot({ path: `${shots}/reset-password-390.png`, fullPage: true });
    await ctx.close();
    const wide = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await wide.newPage();
    await p2.goto(`${BASE}/signup?next=%2Fwork%2Fapply`, { waitUntil: "networkidle" });
    await p2.screenshot({ path: `${shots}/signup-apply-1440.png`, fullPage: true });
    await p2.goto(`${BASE}/terms`, { waitUntil: "networkidle" });
    await p2.screenshot({ path: `${shots}/terms-1440.png`, fullPage: true });
    await wide.close();
  });
}
