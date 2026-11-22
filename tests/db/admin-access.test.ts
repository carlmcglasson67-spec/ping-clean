// Making and removing admins from the console (admin_add_admin / admin_remove_admin, #60):
// who may, which accounts, never yourself, never the last one, and the record of changes.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, IDS, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const ADD = `select * from public.admin_add_admin($1, $2)`;
const REMOVE = `select * from public.admin_remove_admin($1, $2)`;
const WHY = "Runs the office with Carl.";
const su = (q: Query) => q.rows(`reset role`);
const role = async (q: Query, id: string) => (await q.rows<{ role: string }>(`select role::text from public.profiles where id = $1`, [id]))[0]!.role;
/** Ben's block is still on offer in the seed: end it, so Ben has no cleans booked. */
const freeBen = (q: Query) => q.rows(`update public.series set status = 'ended' where id = $1`, [IDS.benSeries]);

describe("admin_add_admin and admin_remove_admin", () => {
  it("are for admins only", async () => {
    const r = await as("superuser", async (q) => {
      await freeBen(q);
      const out: Record<string, string> = {};
      for (const who of ["anna", "tara"] as const) {
        await q.actAs(U[who]);
        out[`${who}-add`] = await q.attempt(ADD, ["ben.customer@ping.test", WHY]);
        out[`${who}-remove`] = await q.attempt(REMOVE, [U.admin, WHY]);
      }
      await su(q);
      return { out, ben: await role(q, U.ben), jo: await role(q, U.admin) };
    });
    expect(r).toEqual({ out: { "anna-add": DENIED, "anna-remove": DENIED, "tara-add": DENIED, "tara-remove": DENIED }, ben: "customer", jo: "admin" });
    expect(await as("anon", (q) => q.attempt(ADD, ["ben.customer@ping.test", WHY]))).toBe(DENIED);
    expect(await as("anon", (q) => q.attempt(REMOVE, [U.admin, WHY]))).toBe(DENIED);
  });

  it("adds a confirmed customer, whatever the case of the email, and records who and why outside the audit log", async () => {
    const r = await as("superuser", async (q) => {
      await freeBen(q);
      await q.actAs(U.admin);
      const rows = await q.rows<{ id: string; email: string; full_name: string }>(ADD, ["  Ben.Customer@PING.test ", WHY]);
      const seen = await q.rows<{ made_admin: boolean; reason: string; actor_id: string }>(
        `select made_admin, reason, actor_id from public.team_changes where profile_id = $1`, [U.ben]);
      await su(q);
      const roleLog = await q.rows<{ actor_id: string; to: string; reason: string | null }>(
        `select actor_id, detail -> 'role' ->> 'to' as to, detail ->> 'reason' as reason from public.audit_log
          where entity = 'profiles' and entity_id = $1`, [U.ben]);
      return { rows, ben: await role(q, U.ben), seen, roleLog };
    });
    expect(r.rows).toEqual([{ id: U.ben, email: "ben.customer@ping.test", full_name: "Ben Test" }]);
    expect(r.ben).toBe("admin");
    expect(r.seen).toEqual([{ made_admin: true, reason: WHY, actor_id: U.admin }]); // an admin can read it
    expect(r.roleLog).toEqual([{ actor_id: U.admin, to: "admin", reason: null }]); // no free text in the audit log
  });

  it("refuses unknown, unconfirmed, deleted and banned addresses, cleaners, admins, and customers with cleans booked", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update auth.users set email_confirmed_at = null where id = $1`, [U.anna]);
      await q.actAs(U.admin);
      const out: Record<string, string> = {
        unknown: await q.attempt(ADD, ["nobody@ping.test", WHY]),
        unconfirmed: await q.attempt(ADD, ["anna.customer@ping.test", WHY]),
        booked: await q.attempt(ADD, ["ben.customer@ping.test", WHY]), // Ben's block is still on offer
        cleaner: await q.attempt(ADD, ["tara.cleaner@ping.test", WHY]),
        applicant: await q.attempt(ADD, ["sam.applicant@ping.test", WHY]),
        already: await q.attempt(ADD, ["admin@ping.test", WHY]),
        noEmail: await q.attempt(ADD, ["  ", WHY]),
        notAdmin: await q.attempt(REMOVE, [U.ben, WHY]),
      };
      await su(q);
      await freeBen(q);
      await q.rows(`update auth.users set deleted_at = now() where id = $1`, [U.ben]);
      await q.actAs(U.admin);
      out.deleted = await q.attempt(ADD, ["ben.customer@ping.test", WHY]);
      await su(q);
      await q.rows(`update auth.users set deleted_at = null, banned_until = now() + interval '1 day' where id = $1`, [U.ben]);
      await q.actAs(U.admin);
      out.banned = await q.attempt(ADD, ["ben.customer@ping.test", WHY]);
      await su(q);
      return { out, anna: await role(q, U.anna), ben: await role(q, U.ben), tara: await role(q, U.tara) };
    });
    expect(r.out).toEqual({
      unknown: "PC060", unconfirmed: "PC060", booked: "PC065", cleaner: "PC061", applicant: "PC061",
      already: "PC062", noEmail: "PC066", notAdmin: "PC062", deleted: "PC060", banned: "PC060",
    });
    expect([r.anna, r.ben, r.tara]).toEqual(["customer", "customer", "cleaner"]);
  });

  it("needs a reason", async () => {
    const r = await as("superuser", async (q) => {
      await freeBen(q);
      await q.actAs(U.admin);
      return [
        await q.attempt(ADD, ["ben.customer@ping.test", ""]),
        await q.attempt(ADD, ["ben.customer@ping.test", "ok"]),
        await q.attempt(ADD, ["ben.customer@ping.test", "x".repeat(301)]),
        await q.attempt(REMOVE, [U.admin, " "]),
      ];
    });
    expect(r).toEqual(["22023", "22023", "22023", "22023"]);
  });

  it("removes another admin by id, but never yourself; and the last admin is refused", async () => {
    const r = await as("superuser", async (q) => {
      await freeBen(q);
      await q.actAs(U.admin);
      const self = await q.attempt(REMOVE, [U.admin, "Stepping back from the office."]);
      await q.rows(ADD, ["ben.customer@ping.test", WHY]);
      const removeBen = await q.attempt(REMOVE, [U.ben, "Ben has left the office."]);
      await su(q);
      const ben = await role(q, U.ben);
      const changes = (await q.rows<{ n: number }>(`select count(*)::int as n from public.team_changes where profile_id = $1`, [U.ben]))[0]!.n;
      // The last-admin rule: Jo is the only admin, and is asked to remove Ben, who isn't one
      // any more; and, as the database sees it during a race, the only other admin.
      await q.rows(`update public.profiles set role = 'admin' where id = $1`, [U.ben]);
      await q.rows(`update public.profiles set role = 'customer' where id = $1`, [U.admin]);
      await q.actAs(U.ben);
      const last = await q.attempt(REMOVE, [U.ben, "Testing the last-admin rule."]);
      await su(q);
      return { self, removeBen, ben, changes, last };
    });
    expect(r).toEqual({ self: "PC063", removeBen: "ok", ben: "customer", changes: 2, last: "PC063" });
  });

  it("two admins removing each other at the same moment: one goes, the other is refused", async () => {
    // Real concurrency: two connections. Ben is made an admin and committed first.
    // This test commits, so it puts everything back afterwards, the audit log included,
    // for the test files that run after it.
    const { rows: mark } = await pool.query(`select coalesce(max(id), 0) as id from public.audit_log`);
    const setup = await pool.connect();
    try {
      await setup.query(`update public.series set status = 'ended' where id = $1`, [IDS.benSeries]);
      await setup.query(`update public.profiles set role = 'admin' where id = $1`, [U.ben]);
    } finally {
      setup.release();
    }
    const a = await pool.connect();
    const b = await pool.connect();
    const asUser = async (c: typeof a, id: string) => {
      await c.query("begin");
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: "authenticated" })]);
      await c.query(`set local role authenticated`);
    };
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
    try {
      await asUser(a, U.admin);
      await asUser(b, U.ben);
      const first = await code(a.query(REMOVE, [U.ben, "Removing Ben at the same moment."]));
      const second = code(b.query(REMOVE, [U.admin, "Removing Jo at the same moment."])); // waits for a's lock
      await new Promise((res) => setTimeout(res, 200));
      await a.query("commit");
      const secondCode = await second;
      await b.query("rollback");
      expect(first).toBe("ok");
      expect(secondCode).toBe("42501"); // Ben was removed while waiting: asked again after the lock
      const { rows } = await pool.query(`select count(*)::int as n from public.profiles where role = 'admin'`);
      expect(rows[0].n).toBe(1);
    } finally {
      a.release();
      b.release();
      const tidy = await pool.connect();
      await tidy.query(`update public.profiles set role = 'customer' where id = $1`, [U.ben]);
      await tidy.query(`update public.series set status = 'offering' where id = $1`, [IDS.benSeries]);
      await tidy.query(`delete from public.team_changes`);
      await tidy.query(`delete from public.audit_log where id > $1`, [mark[0].id]);
      tidy.release();
    }
  });
});
