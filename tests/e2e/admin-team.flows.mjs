// The Team section (#60): add an admin and remove them again, from the console, with a
// reason and a second press. Loaded by admin.flows.mjs, signed in as the seeded admin (Jo).
import assert from "node:assert/strict";

const PAT = "00000000-0000-4000-a000-0000000000a7"; // made here: a confirmed account with no cleans

export default async function teamFlows({ page, BASE, check, dir, sql, settle, shoot }) {
  console.log("e2e: admin console, Team");
  await sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', 'pat.office@ping.test',
      extensions.crypt('ping-test-2026', extensions.gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Pat Office"}', '', '', '', '')
    on conflict (id) do nothing`, [PAT]);
  await page.goto(`${BASE}/admin/team`);
  await settle(page);

  await check("lists the admins, marks you, and offers no way to remove yourself", async () => {
    await page.getByRole("heading", { name: "Who runs Ping." }).waitFor();
    const jo = page.locator("li").filter({ hasText: "admin@ping.test" });
    await jo.getByText("You", { exact: true }).waitFor();
    assert.equal(await jo.getByRole("button", { name: "Remove admin" }).count(), 0);
    await shoot(page, dir, "admin-team");
  });

  await check("a cleaner's account is refused in plain words, and nothing changes", async () => {
    await page.getByRole("button", { name: "Add an admin" }).click();
    await page.getByLabel("Their email").fill("tara.cleaner@ping.test");
    await page.getByLabel("What they'll do").fill("Testing the cleaner rule.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Yes, make them an admin" }).click();
    await page.getByText("That's a cleaner's account.").waitFor();
    const [t] = await sql(`select role from public.profiles where id = '00000000-0000-4000-a000-000000000004'`);
    assert.equal(t.role, "cleaner");
    // A customer with cleans booked is refused too: an admin can't manage their own.
    await page.getByLabel("Their email").fill("ben.customer@ping.test");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Yes, make them an admin" }).click();
    await page.getByText("They have cleans booked as a customer").waitFor();
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  await check("adds a confirmed customer after a second press that says what they'll see", async () => {
    await page.getByRole("button", { name: "Add an admin" }).click();
    await page.getByLabel("Their email").fill("pat.office@ping.test");
    await page.getByLabel("What they'll do").fill("Helping in the office this week.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("will see every customer’s address").waitFor();
    await shoot(page, dir, "admin-team-confirm");
    await page.getByRole("button", { name: "Yes, make them an admin" }).click();
    await page.getByRole("status").filter({ hasText: "Pat Office is now an admin." }).waitFor();
    await page.locator("li").filter({ hasText: "pat.office@ping.test" }).waitFor();
    await page.getByText("Pat Office made an admin").waitFor();
    const [b] = await sql(`select role from public.profiles where id = $1`, [PAT]);
    assert.equal(b.role, "admin");
  });

  await check("removes them again, with a reason, and the log says who did it", async () => {
    const ben = page.locator("li").filter({ hasText: "pat.office@ping.test" });
    await ben.getByRole("button", { name: "Remove admin" }).click();
    await page.getByLabel("Why").fill("The week is over.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Yes, remove them" }).click();
    await page.getByRole("status").filter({ hasText: "Pat Office is no longer an admin." }).waitFor();
    const [b] = await sql(`select role from public.profiles where id = $1`, [PAT]);
    assert.equal(b.role, "customer");
    const log = await sql(`select made_admin, reason, actor_id from public.team_changes where profile_id = $1 order by id`, [PAT]);
    assert.deepEqual(log.map((r) => r.made_admin), [true, false]);
    assert.equal(log[1].reason, "The week is over.");
    assert.equal(log[1].actor_id, "00000000-0000-4000-a000-000000000001");
  });
}
