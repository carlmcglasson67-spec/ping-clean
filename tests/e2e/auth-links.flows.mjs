// Invite and email-change links, end to end against the fake Supabase (issue #21, notes 1–3,
// and the security review of them: S1 invites replace any password, S2 code links can't
// pose as invites, S3 sign-up and invite links swapped by type).
// The fake's test-only controls stand in for the admin invite and supabase.auth.updateUser({ email }).
import assert from "node:assert/strict";
import pg from "pg";

const FAKE = "http://127.0.0.1:54321";

async function mailFor(email, type) {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${FAKE}/__test/mail?email=${encodeURIComponent(email)}&type=${type}`);
    if (r.ok) return (await r.json()).link;
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error(`no ${type} email for ${email}`);
}
const post = (path, body) => fetch(`${FAKE}${path}`, { method: "POST", body: JSON.stringify(body) });
const masked = (email) => `${email[0]}•••${email.slice(email.lastIndexOf("@"))}`;

async function profileEmail(email) {
  const c = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await c.connect();
  try {
    const { rows } = await c.query(`select p.email from public.profiles p join auth.users u on u.id = p.id where u.email = $1 or u.email_change = $1`, [email]);
    return rows[0]?.email;
  } finally {
    await c.end();
  }
}

/** The account as the database has it: password still to choose, terms version, profile name. */
async function account(email) {
  const c = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await c.connect();
  try {
    const { rows } = await c.query(
      `select u.raw_user_meta_data -> 'password_pending' as pending, u.raw_user_meta_data ->> 'terms_version' as terms, p.full_name
         from auth.users u join public.profiles p on p.id = u.id where u.email = $1`, [email]);
    return rows[0];
  } finally {
    await c.end();
  }
}
/** The first-password step (#60), as tests/e2e/auth.flows.mjs fills it in. */
async function firstPassword(page, { name, password }) {
  if (name !== undefined) await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Choose a password").fill(password);
  await page.getByLabel(/terms of use/).check();
  await page.getByLabel(/privacy notice/).check();
  await page.getByRole("button", { name: "Save and continue" }).click();
}
/** Signs in with email and password in a fresh browser; true if it got past /login. */
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

export async function authLinkFlows({ browser, BASE, check, shots }) {
  const stamp = Date.now();
  const ola = { email: `ola.${stamp}@ping.test`, password: "red bicycle 58" };
  const olaNew = `ola.new.${stamp}@ping.test`;

  console.log("e2e: invite and email-change links");

  await check("an invite link says it's an invitation, then the invitee gives their details, chooses a password and can sign in with it", async () => {
    assert.equal((await post("/__test/invite", { email: ola.email })).status, 200);
    const link = await mailFor(ola.email, "invite");
    assert.match(link, /\/auth\/confirm\?token_hash=[0-9a-f]+&type=invite$/);

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(link);
    await page.getByRole("heading", { name: "Accept your invitation" }).waitFor();
    assert.equal(await page.getByText(/just created a Ping account/).count(), 0, "not the sign-up wording");
    if (shots) await page.screenshot({ path: `${shots}/confirm-invite-1440.png`, fullPage: true });
    await page.getByRole("button", { name: "Accept and choose a password" }).click();

    // The same first-password step as a new sign-up (review S1), worded as an invitation.
    await page.waitForURL((u) => u.pathname === "/auth/confirmed" && u.searchParams.get("first") === "1" && u.searchParams.get("invited") === "1");
    await page.getByText("Invitation accepted").waitFor();
    await page.getByText(masked(ola.email)).waitFor();
    await page.getByRole("link", { name: "Choose my password" }).click();
    await page.waitForURL((u) => u.pathname === "/reset-password" && u.searchParams.get("first") === "1");
    await page.getByRole("heading", { name: "Choose your password" }).waitFor();
    await page.getByText("Welcome to Ping").waitFor();
    if (shots) await page.screenshot({ path: `${shots}/invite-password-1440.png`, fullPage: true });
    await firstPassword(page, { name: "Ola Test", password: ola.password });
    await page.waitForURL(`${BASE}/account`);
    assert.deepEqual(await account(ola.email), { pending: null, terms: "draft-2026-11", full_name: "Ola Test" });
    await ctx.close();
    assert.equal(await canSignIn(browser, BASE, ola.email, ola.password), true);
  });

  await check("re-inviting an unconfirmed account replaces whatever password it held (review S1)", async () => {
    const email = `held.${stamp}@ping.test`;
    // An account made before #60, holding a password a stranger chose, never confirmed.
    const c = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
    await c.connect();
    await c.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
       values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1,
               extensions.crypt('stranger pass 99', extensions.gen_salt('bf')), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '')`, [email]);
    await c.end();
    assert.equal((await post("/__test/invite", { email })).status, 200);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(await mailFor(email, "invite"));
    await page.getByRole("button", { name: "Accept and choose a password" }).click();
    await page.waitForURL((u) => u.pathname === "/auth/confirmed" && u.searchParams.get("first") === "1");
    await ctx.close();
    assert.equal((await account(email)).pending, true, "waiting for the owner's own password");
    assert.equal(await canSignIn(browser, BASE, email, "stranger pass 99"), false, "the stranger's password is gone");
  });

  await check("sign-up and invite links swapped by type both end at the first-password step; invited or not comes from the account (review S3)", async () => {
    // An invite link edited to type=signup: still the invitation's first-password step.
    const invitee = `swap.invite.${stamp}@ping.test`;
    await post("/__test/invite", { email: invitee });
    const inviteLink = (await mailFor(invitee, "invite")).replace("type=invite", "type=signup");
    let ctx = await browser.newContext();
    let page = await ctx.newPage();
    await page.goto(inviteLink);
    await page.getByRole("button", { name: "Confirm my email" }).click();
    await page.waitForURL((u) => u.pathname === "/auth/confirmed" && u.searchParams.get("first") === "1" && u.searchParams.get("invited") === "1");
    await ctx.close();
    assert.equal((await account(invitee)).pending, true);

    // An invite link edited to type=email (GoTrue verifies that too, and it has no
    // flow=signup): the untouched invited account still gets the first-password step.
    const emailed = `swap.email.${stamp}@ping.test`;
    await post("/__test/invite", { email: emailed });
    const emailLink = (await mailFor(emailed, "invite")).replace("type=invite", "type=email");
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await page.goto(emailLink);
    await page.getByRole("button", { name: /Confirm my email|Accept and choose a password/ }).click();
    await page.waitForURL((u) => u.pathname === "/auth/confirmed" && u.searchParams.get("first") === "1");
    await ctx.close();
    assert.equal((await account(emailed)).pending, true, "type=email can't skip the first-password step");

    // A sign-up link edited to type=invite: the sign-up's first-password step, not "invited".
    const joiner = `swap.signup.${stamp}@ping.test`;
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await page.goto(`${BASE}/signup`);
    await page.getByLabel("Your name").fill("Swap Test");
    await page.getByLabel("Email").fill(joiner);
    await page.getByRole("button", { name: "Create my account" }).click();
    const signupLink = (await mailFor(joiner, "signup")).replace("type=email", "type=invite");
    await page.goto(signupLink);
    await page.getByRole("button", { name: "Accept and choose a password" }).click();
    await page.waitForURL((u) => u.pathname === "/auth/confirmed" && u.searchParams.get("first") === "1");
    assert.equal(new URL(page.url()).searchParams.get("invited"), null, "never invited, so not worded as one");
    await page.getByRole("link", { name: "Choose my password" }).click();
    await page.waitForURL((u) => u.pathname === "/reset-password");
    assert.equal(await page.getByText("Welcome to Ping").count(), 0);
    await ctx.close();
    assert.equal((await account(joiner)).pending, true);
  });

  await check("a code link can't claim to be an invite and get a password pass (review S2)", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/auth/confirm?code=abcdefgh12345678&type=invite`);
    await page.getByRole("button", { name: "Accept and choose a password" }).click();
    await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("link") === "expired");
    assert.equal((await ctx.cookies()).some((c) => c.name === "ping-reset"), false, "no reset pass");
    await ctx.close();
  });

  await check("secure email change: the first link says to confirm the other address and changes nothing; the second changes it, profile too", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    // Signed in, as someone changing their address from their account would be.
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Email").fill(ola.email);
    await page.getByLabel("Password").fill(ola.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${BASE}/account`);

    assert.equal((await post("/__test/email-change", { email: ola.email, to: olaNew })).status, 200);
    const oldLink = await mailFor(ola.email, "email_change");
    const newLink = await mailFor(olaNew, "email_change");

    await page.goto(oldLink);
    await page.getByRole("heading", { name: "Confirm your email change" }).waitFor();
    assert.equal(await page.getByText(/just created a Ping account/).count(), 0, "not the sign-up wording");
    if (shots) await page.screenshot({ path: `${shots}/confirm-email-change-1440.png`, fullPage: true });
    await page.getByRole("button", { name: "Confirm the change" }).click();
    await page.waitForURL(`${BASE}/auth/other-address`);
    await page.getByRole("heading", { name: "Now confirm the link sent to your other address" }).waitFor();
    if (shots) {
      await page.screenshot({ path: `${shots}/other-address-1440.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${shots}/other-address-390.png`, fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    assert.equal(await profileEmail(ola.email), ola.email, "nothing changes on the first link");

    await page.goto(newLink);
    await page.getByRole("button", { name: "Confirm the change" }).click();
    await page.waitForURL((u) => u.pathname === "/auth/confirmed" && u.searchParams.get("kind") === "email_change");
    await page.getByRole("heading", { name: "Your email address is changed" }).waitFor();
    await page.getByText(masked(olaNew)).waitFor(); // the profile already shows the new address
    if (shots) await page.screenshot({ path: `${shots}/email-changed-1440.png`, fullPage: true });
    assert.equal(await profileEmail(olaNew), olaNew, "profiles.email follows the login email");
    ola.email = olaNew;
    await ctx.close();
  });

  await check("with secure email change off, the one link changes the address and signs a signed-out browser in", async () => {
    const next = `ola.third.${stamp}@ping.test`;
    assert.equal((await post("/__test/email-change", { email: ola.email, to: next, secure: false })).status, 200);
    const link = await mailFor(next, "email_change");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(link);
    await page.getByRole("button", { name: "Confirm the change" }).click();
    await page.waitForURL((u) => u.pathname === "/auth/confirmed" && u.searchParams.get("kind") === "email_change");
    await page.getByText(masked(next)).waitFor();
    assert.equal(await profileEmail(next), next);
    await ctx.close();
  });
}
