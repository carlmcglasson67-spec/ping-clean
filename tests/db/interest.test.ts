// Register interest (signed off by Carl, 7 Nov 2026): who can add, who can read, the
// same reply every time, retention from settings, the nightly purge and the export audit.
import { afterAll, describe, expect, it } from "vitest";
import { as, CHECK, DENIED, pool, setupThen, U, type Query } from "./helpers";

afterAll(() => pool.end());

const REG = `select public.register_interest($1, $2, $3, $4, $5, $6) as reply`;
const ROLES = ["anon", "anna", "ben", "tara", "alex", "sam", "admin"] as const;
const NOT_ADMIN = ["anon", "anna", "ben", "tara", "alex", "sam"] as const;

type Reg = { postcode: string; email: string | null; phone: string | null; notify: boolean | null; source: string; version: string };
const reg = (over: Partial<Reg> = {}): unknown[] => {
  const r: Reg = { postcode: "ca25 5ab", email: "Jo.Bloggs@Example.com ", phone: null, notify: true,
    source: "instant_price", version: "draft-2026-11", ...over };
  return [r.postcode, r.email, r.phone, r.notify, r.source, r.version];
};
const register = async (q: Query, over: Partial<Reg> = {}) => (await q.rows<{ reply: string }>(REG, reg(over)))[0]!.reply;

/** Everything in the table, read as the superuser (nobody else can). */
const all = (su: Query) =>
  su.rows<{ postcode: string; postcode_district: string; email: string | null; phone: string | null; source: string;
            kind: string; months: number }>(
    `select postcode, postcode_district, email, phone, source, kind,
            round(extract(epoch from delete_after - registered_at) / 86400 / 30.4)::int as months
       from public.interest_signups order by registered_at`);

describe("register_interest: anyone can add, with the box ticked", () => {
  it("lets every role register, normalising postcode and email, and keeps it for Carl's 6 months", async () => {
    for (const who of ROLES) {
      const reply = await as(who, (q) => register(q));
      expect({ who, reply }).toEqual({ who, reply: "thanks" });
    }
    const rows = await as("anon", async (q) => {
      await register(q);
      await q.rows(`reset role`);
      return all(q);
    });
    expect(rows).toEqual([{ postcode: "CA25 5AB", postcode_district: "CA25", email: "jo.bloggs@example.com", phone: null,
      source: "instant_price", kind: "customer", months: 6 }]);
  });

  it("takes a UK mobile instead of an email, in any common format", async () => {
    for (const phone of ["07700 900321", "+44 7700 900321", "447700900321", "(07700) 900-321"]) {
      const rows = await as("anon", async (q) => {
        await register(q, { email: null, phone, source: "holding_page" });
        await q.rows(`reset role`);
        return all(q);
      });
      expect({ phone, rows: rows.map((r) => [r.phone, r.email, r.source]) }).toEqual({ phone, rows: [["+447700900321", null, "holding_page"]] });
    }
  });

  it("stores nothing when the box isn't ticked, and still says thanks", async () => {
    for (const notify of [false, null]) {
      const r = await as("anon", async (q) => {
        const reply = await register(q, { notify });
        await q.rows(`reset role`);
        return { reply, n: await q.count("public.interest_signups") };
      });
      expect({ notify, ...r }).toEqual({ notify, reply: "thanks", n: 0 });
    }
  });

  it("gives the same reply to someone already on the list, and updates their row instead of adding one", async () => {
    const r = await as("anon", async (q) => {
      const first = await register(q, { postcode: "CA25 5AB" });
      const again = await register(q, { postcode: "CA25 6ZZ", email: "JO.BLOGGS@example.com", source: "holding_page" });
      const otherArea = await register(q, { postcode: "CA26 1AA" });
      await q.rows(`reset role`);
      return { first, again, otherArea, rows: (await all(q)).map((x) => `${x.postcode} ${x.source}`) };
    });
    expect(r).toEqual({ first: "thanks", again: "thanks", otherArea: "thanks", rows: ["CA25 6ZZ holding_page", "CA26 1AA instant_price"] });
  });

  it("registering again puts someone back on the list with a fresh retention date", async () => {
    const r = await setupThen(async (su) => {
      await su.rows(REG, reg());
      await su.rows(`update public.interest_signups set notified_at = now() - interval '3 months',
                       unsubscribed_at = now() - interval '1 day', registered_at = now() - interval '5 months',
                       delete_after = now() + interval '1 month'`);
    }, null, async (q) => {
      await q.rows(`set local role anon`);
      await register(q);
      await q.rows(`reset role`);
      return q.rows<{ notified: boolean; unsub: boolean; months: number }>(
        `select notified_at is not null as notified, unsubscribed_at is not null as unsub,
                round(extract(epoch from delete_after - now()) / 86400 / 30.4)::int as months from public.interest_signups`);
    });
    expect(r).toEqual([{ notified: false, unsub: false, months: 6 }]);
  });

  it.each([
    ["no postcode", { postcode: "" }, "PC030"],
    ["not a postcode", { postcode: "Workington" }, "PC030"],
    ["a link in the postcode", { postcode: "https://x.example" }, "PC030"],
    ["neither contact", { email: null, phone: null }, "PC031"],
    ["blank contacts", { email: "  ", phone: "" }, "PC031"],
    ["both contacts", { email: "jo@example.com", phone: "07700900321" }, "PC031"],
    ["not an email", { email: "jo at example" }, "PC031"],
    ["two @", { email: "jo@@example.com" }, "PC031"],
    ["too long an email", { email: `${"a".repeat(250)}@example.com` }, "PC031"],
    ["a landline", { email: null, phone: "01946 123456" }, "PC031"],
    ["too short a mobile", { email: null, phone: "07700 9003" }, "PC031"],
    ["an unknown source", { source: "facebook" }, "PC033"],
    ["a made-up consent version", { version: "<script>" }, "PC033"],
  ])("refuses %s", async (_why, over, code) => {
    expect(await as("anon", (q) => q.attempt(REG, reg(over as Partial<Reg>)))).toBe(code);
  });

  it("refuses while the retention period isn't set, like booking without prices", async () => {
    expect(await setupThen(async (su) => { await su.rows(`update public.settings set interest_retention_months = null`); },
      null, async (q) => { await q.rows(`set local role anon`); return q.attempt(REG, reg()); })).toBe("PC032");
  });

  it("tells anyone the retention period, for the consent wording", async () => {
    for (const who of ROLES) {
      const [r] = await as(who, (q) => q.rows<{ m: number }>(`select public.interest_retention_months() as m`));
      expect({ who, m: r!.m }).toEqual({ who, m: 6 });
    }
  });

  it("only takes kinds that exist (customers for now)", async () => {
    expect(await as("superuser", (q) => q.attempt(
      `insert into public.interest_signups (kind, postcode, email, consent_text_version, source, delete_after)
       values ('cleaner', 'CA25 5AB', 'x@example.com', 'v1', 'holding_page', now())`))).toBe(CHECK);
  });
});

describe("nobody but an admin can see or change the list", () => {
  /** A row Jo added, then the test runs as `who`. */
  const withRow = <T>(who: string | null, fn: (q: Query) => Promise<T>) =>
    setupThen(async (su) => { await su.rows(REG, reg()); }, who, fn);

  it("hides every row from anon, customers and cleaners, even the person who added it", async () => {
    for (const who of NOT_ADMIN) {
      const r = await withRow(who === "anon" ? null : U[who], async (q) => {
        if (who === "anon") await q.rows(`set local role anon`);
        const read = await q.attempt(`select * from public.interest_signups`);
        return { read, n: read === "ok" ? await q.count("public.interest_signups") : 0 };
      });
      expect({ who, n: r.n }).toEqual({ who, n: 0 });
    }
  });

  it("refuses direct inserts, updates and deletes from everyone but the function (and admin marking/deleting)", async () => {
    const insert = `insert into public.interest_signups (postcode, email, consent_text_version, source, delete_after)
                    values ('CA25 5AB', 'x@example.com', 'v1', 'holding_page', now() + interval '1 year')`;
    for (const who of [...NOT_ADMIN, "admin"] as const) {
      const r = await withRow(who === "anon" ? null : U[who], async (q) => {
        if (who === "anon") await q.rows(`set local role anon`);
        return {
          insert: await q.attempt(insert),
          email: await q.attempt(`update public.interest_signups set email = 'evil@example.com'`),
          retention: await q.attempt(`update public.interest_signups set delete_after = now() + interval '10 years'`),
        };
      });
      expect({ who, ...r }).toEqual({ who, insert: DENIED, email: DENIED, retention: DENIED });
    }
  });

  it("refuses non-admins the counts and the export, and lets them mark or delete nothing", async () => {
    for (const who of NOT_ADMIN) {
      const r = await withRow(who === "anon" ? null : U[who], async (q) => {
        if (who === "anon") await q.rows(`set local role anon`);
        return {
          counts: await q.attempt(`select * from public.admin_interest_counts()`),
          exp: await q.attempt(`select * from public.admin_export_interest()`),
          mark: await q.attempt(`update public.interest_signups set notified_at = now()`),
          del: await q.attempt(`delete from public.interest_signups`),
          purge: await q.attempt(`select private.purge_interest()`),
          retention: await q.attempt(`update public.settings set interest_retention_months = 24`),
        };
      });
      const marked = who === "anon" ? DENIED : "no-rows"; // RLS: they see no rows to touch
      expect({ who, ...r }).toEqual({ who, counts: DENIED, exp: DENIED, mark: marked, del: marked, purge: DENIED,
        retention: who === "anon" ? DENIED : "no-rows" });
    }
  });

  it("lets an admin read the list, see counts by district, mark people as told and delete on request (audited, without contacts)", async () => {
    const r = await setupThen(async (su) => {
      await su.rows(REG, reg());
      await su.rows(REG, reg({ email: "sam@example.com", postcode: "CA25 7QQ" }));
      await su.rows(REG, reg({ email: null, phone: "07700900321", postcode: "LA9 4AA" }));
    }, U.admin, async (q) => {
      const n = await q.count("public.interest_signups");
      const counts = await q.rows(`select postcode_district, signups::int, not_yet_notified::int from public.admin_interest_counts() order by 1`);
      const mark = await q.attempt(`update public.interest_signups set notified_at = now() where postcode_district = 'CA25'`);
      const del = await q.attempt(`delete from public.interest_signups where postcode_district = 'LA9'`);
      const after = await q.rows(`select postcode_district, signups::int, not_yet_notified::int from public.admin_interest_counts() order by 1`);
      const audit = await q.rows<{ action: string; actor: string; detail: Record<string, unknown> }>(
        `select action, actor_id::text as actor, detail from public.audit_log where entity = 'interest_signups' order by id`);
      return { n, counts, mark, del, after, audit };
    });
    expect(r.n).toBe(3);
    expect(r.counts).toEqual([
      { postcode_district: "CA25", signups: 2, not_yet_notified: 2 },
      { postcode_district: "LA9", signups: 1, not_yet_notified: 1 },
    ]);
    expect(r).toMatchObject({ mark: "ok", del: "ok", after: [{ postcode_district: "CA25", signups: 2, not_yet_notified: 0 }] });
    expect(r.audit.map((a) => [a.action, a.actor])).toEqual([["update", U.admin], ["update", U.admin], ["delete", U.admin]]);
    const logged = JSON.stringify(r.audit);
    for (const secret of ["jo.bloggs", "sam@example", "7700900321", "CA25 5AB", "LA9 4AA"]) expect(logged).not.toContain(secret);
    expect(r.audit[2]!.detail.email).toBe("changed"); // that it went, not what it was
  });

  it("lets an admin change the retention period", async () => {
    expect(await as("admin", (q) => q.attempt(`update public.settings set interest_retention_months = 12`))).toBe("ok");
    expect(await as("admin", (q) => q.attempt(`update public.settings set interest_retention_months = 60`))).toBe(CHECK);
  });
});

describe("admin export", () => {
  const seed = async (su: Query) => {
    await su.rows(REG, reg());
    await su.rows(REG, reg({ email: null, phone: "07700 900321", postcode: "CA26 1AA" }));
    await su.rows(REG, reg({ email: "gone@example.com" }));
    await su.rows(`update public.interest_signups set unsubscribed_at = now() where email = 'gone@example.com'`);
  };

  it("exports one district or all, leaves out anyone who unsubscribed, and writes an audit row with the count only", async () => {
    const r = await setupThen(seed, U.admin, async (q) => {
      const ca25 = await q.rows(`select postcode, email, phone from public.admin_export_interest('ca25')`);
      const every = await q.rows(`select postcode, email, phone from public.admin_export_interest()`);
      const audit = await q.rows<{ action: string; actor: string; detail: unknown }>(
        `select action, actor_id::text as actor, detail from public.audit_log where entity = 'interest_signups' and action = 'export' order by id`);
      return { ca25, every, audit };
    });
    expect(r.ca25).toEqual([{ postcode: "CA25 5AB", email: "jo.bloggs@example.com", phone: null }]);
    expect(r.every).toEqual([
      { postcode: "CA25 5AB", email: "jo.bloggs@example.com", phone: null },
      { postcode: "CA26 1AA", email: null, phone: "+447700900321" },
    ]);
    expect(r.audit).toEqual([
      { action: "export", actor: U.admin, detail: { district: "CA25", rows: 1 } },
      { action: "export", actor: U.admin, detail: { district: "all", rows: 2 } },
    ]);
  });
});

describe("nightly purge", () => {
  it("deletes exactly the rows past their date and those unsubscribed over 30 days ago, with one audit row", async () => {
    const r = await setupThen(async (su) => {
      for (const email of ["keep@example.com", "expired@example.com", "unsub-old@example.com", "unsub-new@example.com", "edge@example.com"]) {
        await su.rows(REG, reg({ email }));
      }
      await su.rows(`update public.interest_signups set delete_after = now() - interval '1 minute' where email = 'expired@example.com'`);
      await su.rows(`update public.interest_signups set delete_after = now() + interval '1 minute' where email = 'edge@example.com'`);
      await su.rows(`update public.interest_signups set unsubscribed_at = now() - interval '31 days' where email = 'unsub-old@example.com'`);
      await su.rows(`update public.interest_signups set unsubscribed_at = now() - interval '29 days' where email = 'unsub-new@example.com'`);
    }, null, async (su) => {
      const n = (await su.rows<{ n: number }>(`select private.purge_interest() as n`))[0]!.n;
      const left = (await su.rows<{ email: string }>(`select email from public.interest_signups order by email`)).map((x) => x.email);
      const audit = await su.rows(`select actor_label, action, detail from public.audit_log where entity = 'interest_signups'`);
      const again = (await su.rows<{ n: number }>(`select private.purge_interest() as n`))[0]!.n;
      const auditAfter = await su.count(`public.audit_log where entity = 'interest_signups'`);
      return { n, left, audit, again, auditAfter };
    });
    expect(r).toEqual({
      n: 2,
      left: ["edge@example.com", "keep@example.com", "unsub-new@example.com"],
      audit: [{ actor_label: "cron:purge-interest", action: "purge", detail: { rows: 2 } }],
      again: 0,
      auditAfter: 1, // nothing to purge: no new entry
    });
  });

  it("leaves the per-row audit on for admin deletions afterwards", async () => {
    const n = await setupThen(async (su) => {
      await su.rows(REG, reg());
      await su.rows(`select private.purge_interest()`);
    }, U.admin, async (q) => {
      await q.rows(`delete from public.interest_signups`);
      return q.count(`public.audit_log where entity = 'interest_signups' and action = 'delete'`);
    });
    expect(n).toBe(1);
  });
});
