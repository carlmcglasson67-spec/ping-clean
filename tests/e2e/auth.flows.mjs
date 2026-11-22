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
/**
 * After confirming: the page names the signed-in account (re-review N6). A new account then
 * chooses its password (#60) and carries on to where it was going.
 */
async function continueAfterConfirm(page, email, password = "blue kettle 42") {
  await page.waitForURL((u) => u.pathname === "/auth/confirmed");
  const masked = `${email[0]}•••${email.slice(email.lastIndexOf("@"))}`;
  await page.getByText(masked).waitFor();
  await page.getByRole("link", { name: "Choose my password" }).click();
  await page.waitForURL((u) => u.pathname === "/reset-password" && u.searchParams.get("first") === "1");
  await firstPassword(page, { password });
}
/**
 * The first-password step: the details only the address's owner gives (#60). The name is
 * shown filled in from sign-up, for checking.
 */
async function firstPassword(page, { password, name, phone = "", terms = true, privacy = true }) {
  if (name !== undefined) await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Choose a password").fill(password);
  if (phone) await page.getByLabel("Mobile number (optional)").fill(phone);
  if (terms) await page.getByLabel(/terms of use/).check();
  if (privacy) await page.getByLabel(/privacy notice/).check();
  await page.getByRole("button", { name: "Save and continue" }).click();
}
/** Signs in with email and password; true if it got past /login. */
async function canSignIn(browser, BASE, email, password) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const ok = new URL(page.url()).pathname !== "/login";
  await ctx.close();
  return ok;
}
const setConfirm = (confirm) => fetch(`${FAKE}/__test/config`, { method: "POST", body: JSON.stringify({ confirm }) });

async function fillSignup(page, { name, email }) {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  // No password here: it's chosen after the email link (#60).
  assert.equal(await page.getByLabel("Create a password").count(), 0);
  // Nor phone or consent: those come from the owner after the link, too.
  assert.equal(await page.getByLabel("Mobile number (optional)").count(), 0);
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
    // The first-password step: a weak password and missing consent are refused in plain words.
    await page.getByRole("link", { name: "Choose my password" }).click();
    await page.getByRole("heading", { name: "Choose your password" }).waitFor();
    assert.equal(await page.getByLabel("Your name").inputValue(), "Nia Test", "the name from sign-up, shown for checking");
    if (shots) await page.screenshot({ path: `${shots}/first-password-1440.png`, fullPage: true });
    await firstPassword(page, { password: "password123", terms: false, privacy: false });
    await page.getByText("That one's too easy to guess").first().waitFor();
    await page.getByText("Tick to agree to the terms of use.").waitFor();
    await page.getByText("Tick to say you've read the privacy notice.").waitFor();
    await firstPassword(page, { password: nia.password, phone: nia.phone });
    await page.waitForURL(`${BASE}/account`);
    await page.getByRole("heading", { name: "Hello, Nia." }).waitFor();
    const c = db(); await c.connect();
    const { rows } = await c.query(`select p.role, p.phone, u.raw_user_meta_data ->> 'terms_version' as terms,
      u.raw_user_meta_data ->> 'phone' as meta_phone from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [nia.email]);
    await c.end();
    // The phone now lives on the profile only (review fix 7).
    assert.deepEqual(rows[0], { role: "customer", phone: "07700 900321", terms: "draft-2026-11", meta_phone: null });
    // The pass for the first password works once: the page is shut again now (final check F1).
    await page.goto(`${BASE}/reset-password`);
    await page.getByTestId("reset-expired").waitFor();
    const c2 = db(); await c2.connect();
    const { rows: m } = await c2.query(`select raw_user_meta_data -> 'password_pending' as pending from auth.users where email = $1`, [nia.email]);
    await c2.end();
    assert.equal(m[0].pending, null, "the account no longer waits for a password");
    await ctx.close();
    assert.ok(await canSignIn(browser, BASE, nia.email, nia.password), "signs in with the password chosen after confirming");
  });

  await check("a stranger who signs up with someone else's address first can't get into the account (#60)", async () => {
    const victim = { name: "Vic Test", email: `vic.${Date.now()}@ping.test` };
    // The stranger gets there first. They never see a password, because there isn't one to see.
    const s = await browser.newContext();
    const sp = await s.newPage();
    await sp.goto(`${BASE}/signup`);
    await fillSignup(sp, { name: "Stranger", email: victim.email });
    await sp.getByTestId("check-email").waitFor();
    await s.close();
    // The account exists, unconfirmed, with a password nobody chose.
    const c = db(); await c.connect();
    const { rows } = await c.query(`select email_confirmed_at, raw_user_meta_data ->> 'password_pending' as pending,
      length(encrypted_password) > 0 as has_pw from auth.users where email = $1`, [victim.email]);
    await c.end();
    assert.deepEqual(rows[0], { email_confirmed_at: null, pending: "true", has_pw: true });
    for (const guess of ["blue kettle 42", "password123", "ping-test-2026"]) {
      assert.equal(await canSignIn(browser, BASE, victim.email, guess), false, `no way in with "${guess}"`);
    }
    // The real owner signs up later, confirms from their own inbox and chooses a password.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/signup`);
    await fillSignup(page, { name: victim.name, email: victim.email });
    await page.getByTestId("check-email").waitFor();
    await openLink(page, await mailFor(victim.email, "signup"));
    await page.waitForURL((u) => u.pathname === "/auth/confirmed");
    await page.getByRole("link", { name: "Choose my password" }).click();
    // The stranger's name came first and is shown for checking: the owner puts theirs.
    assert.equal(await page.getByLabel("Your name").inputValue(), "Stranger");
    await firstPassword(page, { password: "harbour lamp 77", name: victim.name, phone: "07700 900777" });
    await page.waitForURL(`${BASE}/account`);
    await ctx.close();
    assert.ok(await canSignIn(browser, BASE, victim.email, "harbour lamp 77"), "the owner's password opens it");
    const c2 = db(); await c2.connect();
    const { rows: p } = await c2.query(`select p.full_name, p.phone, u.raw_user_meta_data ->> 'consented_at' is not null as consented
      from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [victim.email]);
    await c2.end();
    assert.deepEqual(p[0], { full_name: "Vic Test", phone: "07700 900777", consented: true });
  });

  await check("an account a stranger registered the old way, with a password they know, is closed to them on confirming (#60)", async () => {
    // Made as the old sign-up form made accounts: unconfirmed, the stranger's own password,
    // their phone number waiting in the metadata, and no password_pending flag.
    const email = `old.${Date.now()}@ping.test`;
    const c = db(); await c.connect();
    await c.query(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1,
        extensions.crypt('stranger knows this', extensions.gen_salt('bf')), null,
        '{"provider":"email"}', '{"full_name":"Old Stranger","phone":"07700 900999"}', '', '', '', '')`, [email]);
    await c.end();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/signup`);
    await fillSignup(page, { name: "Real Owner", email });
    await page.getByTestId("check-email").waitFor();
    await page.getByRole("button", { name: "Send it again" }).click(); // the owner asks again: a link to their inbox
    await openLink(page, await mailFor(email, "signup"));
    // The moment the link is used, the stranger's password stops working, before any choice.
    assert.equal(await canSignIn(browser, BASE, email, "stranger knows this"), false, "the old password is gone");
    await continueAfterConfirm(page, email, "river stone 31");
    await page.waitForURL(`${BASE}/account`);
    await ctx.close();
    const c2 = db(); await c2.connect();
    const { rows } = await c2.query(`select p.phone from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [email]);
    await c2.end();
    assert.equal(rows[0].phone, null, "the stranger's phone number never reaches the owner's profile");
    assert.ok(await canSignIn(browser, BASE, email, "river stone 31"));
  });

  await check("gives the same answer for an address that already has an account", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/signup`);
    await fillSignup(page, { name: "Anna Again", email: "anna.customer@ping.test" });
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
    // The link is built from the Site URL alone (F3); where they were going is kept with the account.
    assert.match(link, /\/auth\/confirm\?flow=signup&token_hash=[0-9a-f]+&type=email$/);
    const seen = await pathsVisited(page, async () => {
      await openLink(page, link);
      await continueAfterConfirm(page, owen.email);
      await page.waitForLoadState("networkidle");
    });
    // Sent on to the application. (Until Track B's /work/apply page is merged, main's
    // cleaner-only /work layout then bounces a customer to /account.)
    // The password step's action redirects there in the same response (as sign-in does,
    // below), so the browser's address is the proof when there's no separate request.
    const landed = new URL(page.url()).pathname === "/work/apply";
    assert.ok(landed || seen.includes("/work/apply"), `expected to land on /work/apply, saw ${seen.join(", ")} (at ${page.url()})`);
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
    // Now that /work/apply is a real page for customers (#17), the sign-in action's redirect
    // renders it in the same response, so there's no separate request for it: the browser's
    // address is the proof. Without the page, the chain of redirects requests it instead.
    const landed = new URL(page.url()).pathname === "/work/apply";
    assert.ok(landed || seen.includes("/work/apply"), `expected to land on /work/apply, saw ${seen.join(", ")} (at ${page.url()})`);
    if (landed) await page.getByRole("button", { name: "Start my application" }).waitFor();
    await ctx.close();
  });

  await check("a ?next= pointing off Ping is ignored; with confirmation off, sign-up signs straight in", async () => {
    await setConfirm(false);
    try {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${BASE}/signup?next=${encodeURIComponent("https://evil.example/account")}`);
      const ruth = { name: "Ruth Test", email: `ruth.${Date.now()}@ping.test` };
      await fillSignup(page, ruth);
      // Confirmation is off in this check, so sign-up signs straight in.
      await page.waitForURL(`${BASE}/account`);
      const c = db(); await c.connect();
      const { rows } = await c.query(`select u.raw_user_meta_data ->> 'next' as next from auth.users u where u.email = $1`, [ruth.email]);
      await c.end();
      assert.deepEqual(rows[0], { next: null });
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
    // A hand-built reset cookie opens nothing: unsigned, badly signed, or the old flag.
    const anna = "00000000-0000-4000-a000-000000000002";
    const exp = Date.now() + 14 * 60_000;
    for (const value of [`${anna}.${exp}`, `${anna}.${exp}.forged-signature`, "1"]) {
      await ctx.addCookies([{ name: "ping-reset", value, url: `${BASE}/reset-password` }]);
      await page.goto(`${BASE}/reset-password`);
      await page.getByTestId("reset-expired").waitFor();
      assert.equal(await page.getByLabel("New password").count(), 0);
    }
    await ctx.close();
  });

  await check("a reset pass only works for the session that used the reset link (final check F1)", async () => {
    const request = async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(`${BASE}/forgot-password`);
      await page.getByLabel("Email").fill(nia.email);
      await page.getByRole("button", { name: "Send me a reset link" }).click();
      await page.getByTestId("reset-sent").waitFor();
      await openLink(page, await mailFor(nia.email, "recovery"));
      await page.waitForURL(`${BASE}/reset-password`);
      await page.getByLabel("New password").waitFor(); // a genuine reset opens the form
      return page;
    };
    const a = await browser.newContext();
    const b = await browser.newContext();
    const pageA = await request(a);
    const pageB = await request(b);
    const passA = (await a.cookies()).find((k) => k.name === "ping-reset");
    assert.ok(passA?.httpOnly, "the reset pass is httpOnly");
    // B's session, with A's (genuinely signed) pass: refused.
    await b.addCookies([{ name: "ping-reset", value: passA.value, url: `${BASE}/reset-password` }]);
    await pageB.reload();
    await pageB.getByTestId("reset-expired").waitFor();
    // A still works; signing out clears its pass.
    await pageA.reload();
    await pageA.getByLabel("New password").waitFor();
    await pageA.request.post(`${BASE}/logout`, { maxRedirects: 0 });
    assert.ok(!(await a.cookies()).some((k) => k.name === "ping-reset"), "signing out clears the reset pass");
    await a.close();
    await b.close();
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
