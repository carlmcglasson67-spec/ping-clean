// The Team section (#60): add an admin and remove them again, from the console, with a
// reason and a second press. Loaded by admin.flows.mjs, signed in as the seeded admin (Jo).
import assert from "node:assert/strict";

const BEN = "00000000-0000-4000-a000-000000000003";

export default async function teamFlows({ page, BASE, check, dir, sql, settle, shoot }) {
  console.log("e2e: admin console, Team");
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
    await page.getByLabel("Why").fill("Testing the cleaner rule.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Yes, make them an admin" }).click();
    await page.getByText("That's a cleaner's account.").waitFor();
    const [t] = await sql(`select role from public.profiles where id = '00000000-0000-4000-a000-000000000004'`);
    assert.equal(t.role, "cleaner");
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  await check("adds a confirmed customer after a second press that says what they'll see", async () => {
    await page.getByRole("button", { name: "Add an admin" }).click();
    await page.getByLabel("Their email").fill("ben.customer@ping.test");
    await page.getByLabel("Why").fill("Ben is helping in the office this week.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByText("will see every customer’s address").waitFor();
    await shoot(page, dir, "admin-team-confirm");
    await page.getByRole("button", { name: "Yes, make them an admin" }).click();
    await page.getByRole("status").filter({ hasText: "Ben Test is now an admin." }).waitFor();
    await page.locator("li").filter({ hasText: "ben.customer@ping.test" }).waitFor();
    await page.getByText("Ben Test made an admin").waitFor();
    const [b] = await sql(`select role from public.profiles where id = $1`, [BEN]);
    assert.equal(b.role, "admin");
  });

  await check("removes them again, with a reason, and the log says who did it", async () => {
    const ben = page.locator("li").filter({ hasText: "ben.customer@ping.test" });
    await ben.getByRole("button", { name: "Remove admin" }).click();
    await page.getByLabel("Why").fill("The week is over.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Yes, remove them" }).click();
    await page.getByRole("status").filter({ hasText: "Ben Test is no longer an admin." }).waitFor();
    const [b] = await sql(`select role from public.profiles where id = $1`, [BEN]);
    assert.equal(b.role, "customer");
    const log = await sql(`select action, detail ->> 'reason' as reason from public.audit_log
      where entity_id = $1 and action in ('make_admin', 'remove_admin') order by id`, [BEN]);
    assert.deepEqual(log.map((r) => r.action), ["make_admin", "remove_admin"]);
    assert.equal(log[1].reason, "The week is over.");
  });
}
