// Track C: admin approvals, end to end. Loaded by admin.flows.mjs, signed in as the seeded admin.
import assert from "node:assert/strict";

const PASSWORD = "ping-test-2026";
const SAM = "00000000-0000-4000-a000-000000000006";
const SAM_DBS = "00000000-0000-4000-d000-000000000003";
const ADMIN = "00000000-0000-4000-a000-000000000001";

export default async function approvalsFlows({ page, BASE, check, dir, browser, signIn, sql, settle, shoot }) {
  console.log("e2e: admin console, approvals (Track C)");
  await check("applicants are listed with what they're waiting on", async () => {
    await page.goto(`${BASE}/admin/approvals`);
    await settle(page);
    const applicants = await page.getByRole("region", { name: /Applicants/ }).innerText();
    assert.match(applicants, /Sam Test/);
    assert.match(applicants, /Waiting on/);
    const team = await page.getByRole("region", { name: /The team/ }).innerText();
    assert.match(team, /Tara Test[\s\S]*Top tier/);
  });

  await check("a cleaner's page shows the four checks, contact and the decision (switched off until C-1)", async () => {
    await page.getByRole("link", { name: /Sam Test/ }).click();
    await page.waitForURL(`${BASE}/admin/approvals/${SAM}`);
    await settle(page);
    const main = await page.locator("main").innerText();
    for (const s of ["Photo ID", "Right to work", "DBS check", "Public liability insurance", "sam.applicant@ping.test", "CA26"]) assert.ok(main.includes(s), `shows ${s}`);
    assert.ok(await page.getByRole("button", { name: "Approve" }).isDisabled(), "approve is switched off until C-1");
  });

  await check("a document opens only through a 10-minute signed link, for admins only", async () => {
    // A document whose file really is in the bucket (uploaded by Track B's applicant flow).
    const [real] = await sql(
      `select d.id from public.cleaner_documents d join storage.objects o on o.bucket_id = 'cleaner-documents' and o.name = d.storage_path limit 1`);
    assert.ok(real, "a real uploaded document exists");
    const res = await page.request.get(`${BASE}/admin/approvals/document/${real.id}`, { maxRedirects: 0 });
    assert.equal(res.status(), 303);
    assert.equal(res.headers()["cache-control"], "private, no-store");
    const to = new URL(res.headers().location);
    assert.match(to.pathname, /\/object\/sign\/cleaner-documents\//);
    const exp = Number(to.searchParams.get("token").split(".")[0]);
    assert.ok(exp - Date.now() / 1000 <= 600 && exp - Date.now() / 1000 > 500, "expires in 10 minutes");

    const other = await browser.newContext();
    const tara = await other.newPage();
    await signIn(tara, "tara.cleaner", PASSWORD);
    await tara.waitForURL((u) => u.pathname === "/work");
    const denied = await tara.request.get(`${BASE}/admin/approvals/document/${real.id}`, { maxRedirects: 0 });
    assert.equal(denied.status(), 404, "a cleaner can't use the admin document link");
    await other.close();
  });

  await check("a missing file gives a designed error, not a broken page", async () => {
    await page.goto(`${BASE}/admin/approvals/document/${SAM_DBS}`); // seeded row, no file uploaded
    await page.waitForURL((u) => u.searchParams.get("view") === "failed");
    await page.getByText("That document didn't open").waitFor();
  });

  const dbsCard = () => page.locator("li").filter({ has: page.getByRole("heading", { name: "DBS check" }) });

  await check("sending a document back needs a real reason", async () => {
    await page.goto(`${BASE}/admin/approvals/${SAM}`);
    await settle(page);
    await dbsCard().getByRole("button", { name: "Send back" }).click();
    await dbsCard().getByLabel(/Why is it going back/).fill("!!!");
    await dbsCard().getByRole("button", { name: "Send it back" }).click();
    await dbsCard().getByText("Say why, in a few words.").waitFor();
    const [d] = await sql(`select status from public.cleaner_documents where id = $1`, [SAM_DBS]);
    assert.equal(d.status, "pending");
  });

  await check("sent back with a reason: the cleaner's reason is stored, and the audit log redacts it", async () => {
    await dbsCard().getByLabel(/Why is it going back/).fill("The certificate is cut off at the bottom");
    await dbsCard().getByRole("button", { name: "Send it back" }).click();
    await dbsCard().getByText("Sent back:").waitFor();
    const [d] = await sql(`select status, rejection_reason, reviewed_by from public.cleaner_documents where id = $1`, [SAM_DBS]);
    assert.deepEqual(d, { status: "rejected", rejection_reason: "The certificate is cut off at the bottom", reviewed_by: ADMIN });
    const [a] = await sql(`select actor_id, detail from public.audit_log where entity = 'cleaner_documents' and entity_id = $1 order by id desc limit 1`, [SAM_DBS]);
    assert.equal(a.actor_id, ADMIN);
    assert.equal(a.detail.rejection_reason, "changed");
  });

  await check("verified: logged against the admin", async () => {
    await dbsCard().getByRole("button", { name: "Verify" }).click();
    await dbsCard().getByText("Verified", { exact: true }).waitFor();
    const [d] = await sql(`select status, rejection_reason from public.cleaner_documents where id = $1`, [SAM_DBS]);
    assert.deepEqual(d, { status: "verified", rejection_reason: null });
  });

  await check("two of the team at once: the second is told, nothing is overwritten", async () => {
    await sql(`update public.cleaner_documents set status = 'pending', reviewed_by = null, reviewed_at = null where id = $1`, [SAM_DBS]);
    await page.reload();
    await settle(page);
    await sql(`update public.cleaner_documents set status = 'verified', reviewed_by = $2, reviewed_at = now() where id = $1`, [SAM_DBS, ADMIN]);
    await dbsCard().getByRole("button", { name: "Send back" }).click();
    await dbsCard().getByLabel(/Why is it going back/).fill("Too blurry to read");
    await dbsCard().getByRole("button", { name: "Send it back" }).click();
    await dbsCard().getByText(/just reviewed that document/).waitFor();
    const [d] = await sql(`select status from public.cleaner_documents where id = $1`, [SAM_DBS]);
    assert.equal(d.status, "verified");
  });

  await check("an out-of-date document is never verified: no button, and the server refuses it too", async () => {
    // In date when the page loads: Verify shows.
    await sql(`update public.cleaner_documents set status = 'pending', reviewed_by = null, reviewed_at = null,
               expires_on = (now() at time zone 'Europe/London')::date + 30 where id = $1`, [SAM_DBS]);
    await page.reload();
    await settle(page);
    // Then its date passes before the admin taps (the browser's view is stale).
    await sql(`update public.cleaner_documents set expires_on = (now() at time zone 'Europe/London')::date - 1 where id = $1`, [SAM_DBS]);
    await dbsCard().getByRole("button", { name: "Verify" }).click();
    await dbsCard().getByText(/out of date, so it can.t be verified/).waitFor();
    let [d] = await sql(`select status from public.cleaner_documents where id = $1`, [SAM_DBS]);
    assert.equal(d.status, "pending", "not verified");
    // Today's date counts as out of date too, and the page offers no Verify at all.
    await sql(`update public.cleaner_documents set expires_on = (now() at time zone 'Europe/London')::date where id = $1`, [SAM_DBS]);
    await page.reload();
    await settle(page);
    assert.equal(await dbsCard().getByRole("button", { name: "Verify" }).count(), 0);
    await dbsCard().getByText("Out of date", { exact: true }).waitFor();
    [d] = await sql(`select status from public.cleaner_documents where id = $1`, [SAM_DBS]);
    assert.equal(d.status, "pending");
  });

  await page.goto(`${BASE}/admin/approvals`);
  await shoot(page, dir, "admin-approvals");
  await page.goto(`${BASE}/admin/approvals/${SAM}`);
  await shoot(page, dir, "admin-approvals-cleaner");
}
