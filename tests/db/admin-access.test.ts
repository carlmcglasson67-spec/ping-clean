// Making and removing admins from the console (admin_set_admin, #60): who may, which
// accounts, never yourself, never the last one, and the audit trail.
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, pool, U, type Query } from "./helpers";

afterAll(() => pool.end());

const SET = `select * from public.admin_set_admin($1, $2, $3)`;
const WHY = "Michelle runs the office with Carl.";
const su = (q: Query) => q.rows(`reset role`);
const role = async (q: Query, id: string) => (await q.rows<{ role: string }>(`select role::text from public.profiles where id = $1`, [id]))[0]!.role;

describe("admin_set_admin", () => {
  it("is for admins only", async () => {
    const r = await as("superuser", async (q) => {
      const out: Record<string, string> = {};
      for (const who of ["anna", "tara"] as const) {
        await q.actAs(U[who]);
        out[who] = await q.attempt(SET, ["ben.customer@ping.test", true, WHY]);
      }
      await su(q);
      return { out, ben: await role(q, U.ben) };
    });
    expect(r).toEqual({ out: { anna: DENIED, tara: DENIED }, ben: "customer" });
    expect(await as("anon", (q) => q.attempt(SET, ["ben.customer@ping.test", true, WHY]))).toBe(DENIED);
  });

  it("makes a confirmed customer an admin, whatever the case of the email, and logs who and why", async () => {
    const r = await as("superuser", async (q) => {
      await q.actAs(U.admin);
      const rows = await q.rows<{ email: string; full_name: string }>(SET, ["  Ben.Customer@PING.test ", true, WHY]);
      await su(q);
      const log = await q.rows<{ action: string; actor_id: string; reason: string }>(
        `select action, actor_id, detail ->> 'reason' as reason from public.audit_log
          where entity = 'profiles' and entity_id = $1 and action = 'make_admin'`, [U.ben]);
      const roleLog = await q.rows<{ actor_id: string; to: string }>(
        `select actor_id, detail -> 'role' ->> 'to' as to from public.audit_log
          where entity = 'profiles' and entity_id = $1 and action = 'update'`, [U.ben]);
      return { rows, ben: await role(q, U.ben), log, roleLog };
    });
    expect(r.rows).toEqual([{ email: "ben.customer@ping.test", full_name: "Ben Test" }]);
    expect(r.ben).toBe("admin");
    expect(r.log).toEqual([{ action: "make_admin", actor_id: U.admin, reason: WHY }]);
    expect(r.roleLog).toEqual([{ actor_id: U.admin, to: "admin" }]);
  });

  it("refuses an unknown or unconfirmed address, a cleaner, and someone already an admin", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update auth.users set email_confirmed_at = null where id = $1`, [U.anna]);
      await q.actAs(U.admin);
      const out = {
        unknown: await q.attempt(SET, ["nobody@ping.test", true, WHY]),
        unconfirmed: await q.attempt(SET, ["anna.customer@ping.test", true, WHY]),
        cleaner: await q.attempt(SET, ["tara.cleaner@ping.test", true, WHY]),
        applicant: await q.attempt(SET, ["sam.applicant@ping.test", true, WHY]),
        already: await q.attempt(SET, ["admin@ping.test", true, WHY]),
        notAdmin: await q.attempt(SET, ["ben.customer@ping.test", false, WHY]),
      };
      await su(q);
      return { out, anna: await role(q, U.anna), tara: await role(q, U.tara) };
    });
    // sam is an applicant: still a cleaner's account, so PC061 like tara.
    expect(r.out).toEqual({ unknown: "PC060", unconfirmed: "PC060", cleaner: "PC061", applicant: "PC061", already: "PC062", notAdmin: "PC062" });
    expect(r.anna).toBe("customer");
    expect(r.tara).toBe("cleaner");
  });

  it("needs a reason and an email", async () => {
    const r = await as("superuser", async (q) => {
      await q.actAs(U.admin);
      return [
        await q.attempt(SET, ["ben.customer@ping.test", true, ""]),
        await q.attempt(SET, ["ben.customer@ping.test", true, "ok"]),
        await q.attempt(SET, ["ben.customer@ping.test", true, "x".repeat(301)]),
        await q.attempt(SET, ["", true, WHY]),
      ];
    });
    expect(r).toEqual(["22023", "22023", "22023", "22023"]);
  });

  it("removes another admin, but never yourself and never the last one", async () => {
    const r = await as("superuser", async (q) => {
      await q.actAs(U.admin);
      const self = await q.attempt(SET, ["admin@ping.test", false, "Stepping back from the office."]);
      await q.rows(SET, ["ben.customer@ping.test", true, WHY]);
      const removeBen = await q.attempt(SET, ["ben.customer@ping.test", false, "Ben has left the office."]);
      await su(q);
      const ben = await role(q, U.ben);
      // Jo alone again: Ben can't be used to remove her, and she can't remove herself.
      await q.rows(`update public.profiles set role = 'admin' where id = $1`, [U.ben]);
      await q.actAs(U.ben);
      const removeJo = await q.attempt(SET, ["admin@ping.test", false, "Testing the last-admin rule."]);
      await su(q);
      await q.rows(`update public.profiles set role = 'customer' where id = $1`, [U.admin]);
      await q.actAs(U.ben);
      const last = await q.attempt(SET, ["ben.customer@ping.test", false, "Testing the last-admin rule."]);
      await su(q);
      return { self, removeBen, ben, removeJo, last, benAfter: await role(q, U.ben) };
    });
    expect(r).toEqual({ self: "PC063", removeBen: "ok", ben: "customer", removeJo: "ok", last: "PC063", benAfter: "admin" });
  });

  it("can't be called to remove the last admin even by another route", async () => {
    // With Jo the only admin, removing her is refused as the last one (from a second admin
    // who is then demoted first would be the race; the lock makes them queue).
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.profiles set role = 'admin' where id = $1`, [U.ben]);
      await q.actAs(U.ben);
      await q.rows(SET, ["admin@ping.test", false, "Jo is moving on."]);
      await su(q);
      return { jo: await role(q, U.admin), ben: await role(q, U.ben), admins: (await q.rows<{ n: number }>(`select count(*)::int as n from public.profiles where role = 'admin'`))[0]!.n };
    });
    expect(r).toEqual({ jo: "customer", ben: "admin", admins: 1 });
  });
});
