// Invite and email-change links, end to end against the fake Supabase (issue #21, notes 1–3).
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

export async function authLinkFlows({ browser, BASE, check, shots }) {
  const stamp = Date.now();
  const ola = { email: `ola.${stamp}@ping.test`, password: "red bicycle 58" };
  const olaNew = `ola.new.${stamp}@ping.test`;

  console.log("e2e: invite and email-change links");

  await check("an invite link says it's an invitation, then the invitee chooses a password and can sign in with it", async () => {
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

    await page.waitForURL((u) => u.pathname === "/reset-password" && u.searchParams.get("invited") === "1");
    await page.getByRole("heading", { name: "Choose your password" }).waitFor();
    if (shots) await page.screenshot({ path: `${shots}/invite-password-1440.png`, fullPage: true });
    await page.getByLabel("Your password").fill(ola.password);
    await page.getByRole("button", { name: "Save my password" }).click();
    await page.waitForURL(`${BASE}/account`);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${BASE}/login`);
    await page.getByLabel("Email").fill(ola.email);
    await page.getByLabel("Password").fill(ola.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${BASE}/account`);
    await ctx.close();
  });

  await check("an invite without its pass can't set a password: the page says the link has run out", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/reset-password?invited=1`);
    await page.getByTestId("reset-expired").waitFor();
    await page.getByText("Invitation links work once").waitFor();
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
