// Register interest (signed off by Carl, 7 Nov 2026): only the server can add, nobody reads
// the table directly, the same reply every time, retention from settings, the nightly
// purge, and an audit line for every admin read, export, mark and delete.
import { afterAll, describe, expect, it } from "vitest";
import { as, CHECK, DENIED, pool, setupThen, U, type Query } from "./helpers";

afterAll(() => pool.end());

const REG = `select public.register_interest($1, $2, $3, $4, $5, $6) as reply`;
const USERS = ["anna", "ben", "tara", "alex", "sam", "admin"] as const;
const NOT_ADMIN = ["anon", "anna", "ben", "tara", "alex", "sam"] as const;

type Reg = { postcode: string; email: string | null; phone: string | null; notify: boolean | null; source: string; version: string };
const reg = (over: Partial<Reg> = {}): unknown[] => {
  const r: Reg = { postcode: "ca25 5ab", email: "Jo.Bloggs@Example.com ", phone: null, notify: true,
    source: "instant_price", version: "draft-2026-11", ...over };
  return [r.postcode, r.email, r.phone, r.notify, r.source, r.version];
};

/** As the Server Action does: the service role (lib/db/admin.ts). */
async function server<T>(fn: (q: Query) => Promise<T>, setup?: (su: Query) => Promise<void>): Promise<T> {
  return as("superuser", async (q) => {
    if (setup) await setup(q);
    await q.rows(`set local role service_role`);
    const out = await fn(q);
    await q.rows(`reset role`);
    return out;
  });
}
const register = async (q: Query, over: Partial<Reg> = {}) => (await q.rows<{ reply: string }>(REG, reg(over)))[0]!.reply;
/** As the superuser: register through the function (setup for admin tests). */
const seedReg = (su: Query, over: Partial<Reg> = {}) => su.rows(REG, reg(over));

/** Everything in the table, read as the superuser (nobody else can). */
const all = (su: Query) =>
  su.rows<{ postcode: string; postcode_district: string; email: string | null; phone: string | null; source: string;
            kind: string; months: number }>(
    `select postcode, postcode_district, email, phone, source, kind,
            round(extract(epoch from delete_after - registered_at) / 86400 / 30.4)::int as months
       from public.interest_signups order by registered_at, email`);

/** Run as a role: null for anon, else a user id, after superuser setup. */
const asWho = <T>(who: (typeof NOT_ADMIN)[number] | "admin", setup: (su: Query) => Promise<void>, fn: (q: Query) => Promise<T>) =>
  setupThen(setup, who === "anon" ? null : U[who], async (q) => {
    if (who === "anon") await q.rows(`set local role anon`);
    return fn(q);
  });

describe("register_interest: only the server can call it (review BLOCK 1)", () => {
  it("is refused to anon and every signed-in role, so nobody can skip the honeypot, Turnstile or consent version", async () => {
    expect(await as("anon", (q) => q.attempt(REG, reg({ version: "v-attacker-chosen" })))).toBe(DENIED);
    for (const who of USERS) {
      expect({ who, code: await as(who, (q) => q.attempt(REG, reg())) }).toEqual({ who, code: DENIED });
    }
  });

  it("works for the server, normalising postcode and email, and keeps it for Carl's 6 months", async () => {
    const rows = await server(async (q) => {
      expect(await register(q)).toBe("thanks");
      await q.rows(`reset role`);
      return all(q);
    });
    expect(rows).toEqual([{ postcode: "CA25 5AB", postcode_district: "CA25", email: "jo.bloggs@example.com", phone: null,
      source: "instant_price", kind: "customer", months: 6 }]);
  });

  it("takes a UK mobile instead of an email, in any common format", async () => {
    for (const phone of ["07700 900321", "+44 7700 900321", "447700900321", "(07700) 900-321"]) {
      const rows = await server(async (q) => {
        await register(q, { email: null, phone, source: "holding_page" });
        await q.rows(`reset role`);
        return all(q);
      });
      expect({ phone, rows: rows.map((r) => [r.phone, r.email, r.source]) }).toEqual({ phone, rows: [["+447700900321", null, "holding_page"]] });
    }
  });

  it("stores nothing when the box isn't ticked, and still says thanks", async () => {
    for (const notify of [false, null]) {
      const r = await server(async (q) => {
        const reply = await register(q, { notify });
        await q.rows(`reset role`);
        return { reply, n: await q.count("public.interest_signups") };
      });
      expect({ notify, ...r }).toEqual({ notify, reply: "thanks", n: 0 });
    }
  });

  it("gives the same reply to someone already on the list, and updates their row instead of adding one", async () => {
    const r = await server(async (q) => {
      const first = await register(q, { postcode: "CA25 5AB" });
      const again = await register(q, { postcode: "CA25 6ZZ", email: "JO.BLOGGS@example.com", source: "holding_page" });
      const otherArea = await register(q, { postcode: "CA26 1AA" });
      await q.rows(`reset role`);
      return { first, again, otherArea, rows: (await all(q)).map((x) => `${x.postcode} ${x.source}`) };
    });
    expect(r).toEqual({ first: "thanks", again: "thanks", otherArea: "thanks", rows: ["CA25 6ZZ holding_page", "CA26 1AA instant_price"] });
  });

  it("renews consent and the retention date on re-registering, but never clears 'told' (review 2)", async () => {
    const r = await server(async (q) => {
      await register(q);
      await q.rows(`reset role`);
      return q.rows<{ notified: boolean; months: number }>(
        `select notified_at is not null as notified,
                round(extract(epoch from delete_after - now()) / 86400 / 30.4)::int as months from public.interest_signups`);
    }, async (su) => {
      await seedReg(su);
      await su.rows(`update public.interest_signups set notified_at = now() - interval '3 months',
                       registered_at = now() - interval '5 months', delete_after = now() + interval '1 month'`);
    });
    expect(r).toEqual([{ notified: true, months: 6 }]);
  });

  it("never re-subscribes someone who opted out: says thanks and changes nothing (review 2)", async () => {
    const r = await server(async (q) => {
      const before = (await q.rows<{ row: string }>(`select row_to_json(i)::text as row from public.interest_signups i`))[0]!.row;
      const reply = await register(q, { source: "holding_page", version: "draft-2027-01" });
      await q.rows(`reset role`);
      const after = (await q.rows<{ row: string }>(`select row_to_json(i)::text as row from public.interest_signups i`))[0]!.row;
      return { reply, same: before === after };
    }, async (su) => {
      await seedReg(su);
      await su.rows(`update public.interest_signups set unsubscribed_at = now() - interval '1 day'`);
      await su.rows(`grant select on public.interest_signups to service_role`); // only so the test can compare
    });
    expect(r).toEqual({ reply: "thanks", same: true });
  });

  it("never re-enrols an opted-out contact from another district, by email or by mobile (final check A)", async () => {
    for (const contact of [{ email: "jo.bloggs@example.com", phone: null }, { email: null, phone: "07700 900321" }]) {
      const r = await server(async (q) => {
        const reply = await register(q, { ...contact, postcode: "LA9 4AA" }); // a different district
        const again = await register(q, { ...contact, email: contact.email?.toUpperCase() ?? null, postcode: "CA26 1AA" });
        await q.rows(`reset role`);
        return { reply, again, rows: await q.count("public.interest_signups") };
      }, async (su) => {
        await seedReg(su, contact);
        await su.rows(`update public.interest_signups set unsubscribed_at = now() - interval '1 day'`);
      });
      expect({ contact, ...r }).toEqual({ contact, reply: "thanks", again: "thanks", rows: 1 });
    }
  });

  it("keeps an opted-out contact off the list after the purge deletes their row, via a hash-only suppression list (final check A)", async () => {
    const r = await server(async (q) => {
      const reply = await register(q, { postcode: "CA25 5AB" });
      const other = await register(q, { email: "someone.else@example.com" });
      await q.rows(`reset role`);
      const left = (await q.rows<{ email: string }>(`select email from public.interest_signups`)).map((x) => x.email);
      const supp = await q.rows<{ cols: string[]; n: number; len: number }>(
        `select (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
                  where table_schema = 'private' and table_name = 'interest_suppressions') as cols,
                count(*)::int as n, max(octet_length(contact_hash))::int as len from private.interest_suppressions`);
      return { reply, other, left, supp: supp[0] };
    }, async (su) => {
      await seedReg(su);
      await seedReg(su, { email: null, phone: "07700900321" }); // expires normally, never opted out
      await su.rows(`update public.interest_signups set unsubscribed_at = now() - interval '40 days' where email is not null`);
      await su.rows(`update public.interest_signups set delete_after = now() - interval '1 day' where phone is not null`);
      expect((await su.rows<{ n: number }>(`select private.purge_interest() as n`))[0]!.n).toBe(2);
      expect(await su.count("public.interest_signups")).toBe(0);
    });
    // Only the opted-out contact is suppressed; one 32-byte hash, nothing else stored.
    expect(r).toEqual({ reply: "thanks", other: "thanks", left: ["someone.else@example.com"],
      supp: { cols: ["contact_hash"], n: 1, len: 32 } });
  });

  it("matches opt-outs on a canonical form, so gmail dots, +tags and googlemail can't slip past (last check)", async () => {
    const variants = ["jobloggs@gmail.com", "jo.bloggs+ping@gmail.com", "Jo.Bloggs@googlemail.com", "j.o.b.l.o.g.g.s+x@googlemail.com"];
    for (const via of ["unsubscribed row", "suppression list"] as const) {
      const r = await server(async (q) => {
        for (const email of variants) await register(q, { email, postcode: "LA9 4AA" });
        await register(q, { email: "jo+news@example.com" });   // + removed elsewhere too: blocked
        await register(q, { email: "j.o@example.com" });       // dots matter outside gmail: a different person
        await q.rows(`reset role`);
        return (await q.rows<{ email: string }>(`select email from public.interest_signups where unsubscribed_at is null order by email`)).map((x) => x.email);
      }, async (su) => {
        await seedReg(su, { email: "jo.bloggs@gmail.com" });
        await seedReg(su, { email: "jo@example.com" });
        await su.rows(`update public.interest_signups set unsubscribed_at = now() - interval '40 days'`);
        if (via === "suppression list") {
          await su.rows(`select private.purge_interest()`);
          expect(await su.count("public.interest_signups")).toBe(0);
        }
      });
      expect({ via, stored: r }).toEqual({ via, stored: ["j.o@example.com"] }); // stored as typed
    }
  });

  it("doesn't let one +tag-only address's opt-out block another's (sign-off item 1)", async () => {
    const r = await server(async (q) => {
      for (const email of ["+zzz@example.com", "+@example.com", "+abc+more@example.com"]) await register(q, { email });
      await register(q, { email: "+abc@example.com", postcode: "LA9 4AA" }); // the opted-out one itself: still blocked
      await q.rows(`reset role`);
      return (await q.rows<{ email: string }>(`select email from public.interest_signups where unsubscribed_at is null order by email`)).map((x) => x.email);
    }, async (su) => {
      await seedReg(su, { email: "+abc@example.com" });
      await su.rows(`update public.interest_signups set unsubscribed_at = now() - interval '40 days'`);
      await su.rows(`select private.purge_interest()`);
    });
    // "+abc+more" canonicalises to "+abc+more" (nothing left before the first +), not "+abc": a different address.
    expect(r).toEqual(["+@example.com", "+abc+more@example.com", "+zzz@example.com"]);
  });

  it("treats a trailing dot on the domain as the same address (sign-off item 2)", async () => {
    const r = await server(async (q) => {
      await register(q, { email: "J.O@Gmail.com." });
      await q.rows(`reset role`);
      return q.rows(`select email from public.interest_signups`);
    }, async (su) => {
      await seedReg(su, { email: "jo@gmail.com" });
      await su.rows(`update public.interest_signups set unsubscribed_at = now()`);
    });
    expect(r).toEqual([{ email: "jo@gmail.com" }]); // only the opted-out row: nothing new stored
    expect(await server(async (q) => { await register(q, { email: "Jo@Example.com." }); await q.rows(`reset role`);
      return q.rows(`select email from public.interest_signups`); })).toEqual([{ email: "jo@example.com" }]);
  });

  it("tidies stored trailing-dot emails safely: merges duplicates, keeps opt-outs, never aborts (#31 review)", async () => {
    const r = await as("superuser", async (q) => {
      // Rows as they could have been stored before the fix (the old check allowed a trailing dot).
      await q.rows(`alter table public.interest_signups drop constraint interest_signups_email_check`);
      const add = (email: string, postcode: string, unsub = false) => q.rows(
        `insert into public.interest_signups (postcode, email, consent_text_version, source, delete_after, unsubscribed_at)
         values ($1, $2, 'v1', 'holding_page', now() + interval '6 months', ${unsub ? "now() - interval '1 day'" : "null"})`, [postcode, email]);
      await add("a@example.com.", "CA25 5AB"); await add("a@example.com", "CA25 6ZZ");            // 1. dotted + clean, same district
      await add("b@example.com.", "CA25 5AB", true); await add("b@example.com", "CA25 6ZZ");      // 2. dotted unsubscribed + clean
      await add("c@example.com.", "CA25 5AB"); await add("c@example.com..", "CA25 6ZZ");          // 3. x. and x.. in one district
      await add("d@example.com.", "CA25 5AB");                                                     // a lone dotted row
      await add("e@example.com.", "CA25 5AB"); await add("e@example.com", "LA9 4AA");             // different districts
      const groups = (await q.rows<{ n: number }>(`select private.tidy_trailing_dot_emails() as n`))[0]!.n;
      const rows = await q.rows<{ email: string; district: string; unsub: boolean }>(
        `select email, postcode_district as district, unsubscribed_at is not null as unsub from public.interest_signups order by email, district`);
      // The real check goes back on and holds for every row left.
      const check = await q.attempt(`alter table public.interest_signups add constraint interest_signups_email_check
                                       check (private.normalise_email(email) is not distinct from email)`);
      await q.rows(`set local role service_role`);
      await register(q, { email: "b@example.com", postcode: "LA9 4AA" }); // the opt-out holds, in another district too
      await q.rows(`reset role`);
      return { groups, rows, check, bRows: await q.count(`public.interest_signups where email = 'b@example.com'`),
               hashes: await q.count(`private.interest_suppressions`) };
    });
    expect(r.groups).toBe(5); // a, b, c, d and e in CA25; e in LA9 had no dot
    expect(r.rows).toEqual([
      { email: "a@example.com", district: "CA25", unsub: false },
      { email: "b@example.com", district: "CA25", unsub: true },
      { email: "c@example.com", district: "CA25", unsub: false },
      { email: "d@example.com", district: "CA25", unsub: false },
      { email: "e@example.com", district: "CA25", unsub: false },
      { email: "e@example.com", district: "LA9", unsub: false },
    ]);
    expect(r).toMatchObject({ check: "ok", bRows: 1, hashes: 1 });
  });

  it("keeps every contact an admin deletes on request on the suppression list, opted out or not (last check 1)", async () => {
    const r = await setupThen(async (su) => {
      await seedReg(su);                                                  // still subscribed
      await seedReg(su, { email: null, phone: "07700 900321" });
      await su.rows(`update public.interest_signups set unsubscribed_at = now() where phone is not null`); // opted out
    }, U.admin, async (q) => {
      const ids = (await q.rows<{ id: string }>(`select id from public.admin_list_interest()`)).map((x) => x.id);
      const deleted = (await q.rows<{ n: number }>(`select public.admin_delete_interest($1::uuid[]) as n`, [ids]))[0]!.n;
      await q.rows(`reset role`);
      const hashes = await q.count("private.interest_suppressions");
      await q.rows(`set local role service_role`);
      const replies = [await register(q), await register(q, { email: null, phone: "+447700900321", postcode: "LA9 4AA" })];
      await q.rows(`reset role`);
      return { deleted, hashes, replies, left: await q.count("public.interest_signups") };
    });
    expect(r).toEqual({ deleted: 2, hashes: 2, replies: ["thanks", "thanks"], left: 0 });
  });

  it("lets nobody read or write the suppression list directly", async () => {
    for (const who of [...NOT_ADMIN, "admin"] as const) {
      const r = await asWho(who, async () => {}, async (q) => ({
        read: await q.attempt(`select * from private.interest_suppressions`),
        write: await q.attempt(`insert into private.interest_suppressions values (sha256('x'))`),
        check: await q.attempt(`select private.interest_opted_out('a@b.co', null)`),
      }));
      expect({ who, ...r }).toEqual({ who, read: DENIED, write: DENIED, check: DENIED });
    }
    expect(await server((q) => q.attempt(`select * from private.interest_suppressions`))).toBe(DENIED);
  });

  it.each([
    ["no postcode", { postcode: "" }, "PC030"],
    ["not a postcode", { postcode: "Workington" }, "PC030"],
    ["a made-up postcode area", { postcode: "ZZ9 9ZZ" }, "PC030"],
    ["a non-geographic area", { postcode: "BX1 1LT" }, "PC030"],
    ["a link in the postcode", { postcode: "https://x.example" }, "PC030"],
    ["neither contact", { email: null, phone: null }, "PC031"],
    ["blank contacts", { email: "  ", phone: "" }, "PC031"],
    ["both contacts", { email: "jo@example.com", phone: "07700900321" }, "PC031"],
    ["not an email", { email: "jo at example" }, "PC031"],
    ["two @", { email: "jo@@example.com" }, "PC031"],
    ["an invisible character", { email: "jo​@example.com" }, "PC031"],
    ["a right-to-left override", { email: "jo‮@example.com" }, "PC031"],
    ["an accented letter", { email: "jö@example.com" }, "PC031"],
    ["too long an email", { email: `${"a".repeat(250)}@example.com` }, "PC031"],
    ["a landline", { email: null, phone: "01946 123456" }, "PC031"],
    ["too short a mobile", { email: null, phone: "07700 9003" }, "PC031"],
    ["an unknown source", { source: "facebook" }, "PC033"],
    ["a made-up consent version", { version: "<script>" }, "PC033"],
  ])("refuses %s", async (_why, over, code) => {
    expect(await server((q) => q.attempt(REG, reg(over as Partial<Reg>)))).toBe(code);
  });

  it("accepts real postcode areas, one and two letters", async () => {
    for (const postcode of ["CA14 3XX", "B1 1AA", "LA9 4AA", "EC1A 1BB", "W1A 0AX", "BT1 5GS"]) {
      expect({ postcode, code: await server((q) => q.attempt(REG, reg({ postcode }))) }).toEqual({ postcode, code: "ok" });
    }
  });

  it("refuses while the retention period isn't set, like booking without prices", async () => {
    expect(await server((q) => q.attempt(REG, reg()),
      async (su) => { await su.rows(`update public.settings set interest_retention_months = null`); })).toBe("PC032");
  });

  it("tells anyone the retention period, for the consent wording", async () => {
    for (const who of ["anon", ...USERS] as const) {
      const [r] = await as(who, (q) => q.rows<{ m: number }>(`select public.interest_retention_months() as m`));
      expect({ who, m: r!.m }).toEqual({ who, m: 6 });
    }
  });

  it("only takes kinds that exist (customers for now), and the table re-checks every value", async () => {
    const ins = (cols: string) => `insert into public.interest_signups (kind, postcode, email, consent_text_version, source, delete_after) values (${cols})`;
    expect(await as("superuser", (q) => q.attempt(ins(`'cleaner', 'CA25 5AB', 'x@example.com', 'v1', 'holding_page', now()`)))).toBe(CHECK);
    expect(await as("superuser", (q) => q.attempt(ins(`'customer', 'ZZ9 9ZZ', 'x@example.com', 'v1', 'holding_page', now()`)))).toBe(CHECK);
    expect(await as("superuser", (q) => q.attempt(ins(`'customer', 'CA25 5AB', 'X@example.com', 'v1', 'holding_page', now()`)))).toBe(CHECK);
  });
});

describe("nobody touches the table directly, admins included (review 3)", () => {
  const seed = async (su: Query) => { await seedReg(su); };

  it("refuses every direct read and write to every role", async () => {
    const insert = `insert into public.interest_signups (postcode, email, consent_text_version, source, delete_after)
                    values ('CA25 5AB', 'x@example.com', 'v1', 'holding_page', now() + interval '1 year')`;
    for (const who of [...NOT_ADMIN, "admin"] as const) {
      const r = await asWho(who, seed, async (q) => ({
        read: await q.attempt(`select * from public.interest_signups`),
        insert: await q.attempt(insert),
        mark: await q.attempt(`update public.interest_signups set notified_at = now()`),
        del: await q.attempt(`delete from public.interest_signups`),
      }));
      expect({ who, ...r }).toEqual({ who, read: DENIED, insert: DENIED, mark: DENIED, del: DENIED });
    }
  });

  it("refuses non-admins every admin function and the purge", async () => {
    const id = "00000000-0000-4000-a000-0000000000ff";
    for (const who of NOT_ADMIN) {
      const r = await asWho(who, seed, async (q) => ({
        counts: await q.attempt(`select * from public.admin_interest_counts()`),
        list: await q.attempt(`select * from public.admin_list_interest()`),
        exp: await q.attempt(`select * from public.admin_export_interest()`),
        mark: await q.attempt(`select public.admin_mark_interest_notified(array['${id}']::uuid[])`),
        del: await q.attempt(`select public.admin_delete_interest(array['${id}']::uuid[])`),
        purge: await q.attempt(`select private.purge_interest()`),
        retention: await q.attempt(`update public.settings set interest_retention_months = 24`),
      }));
      expect({ who, ...r }).toEqual({ who, counts: DENIED, list: DENIED, exp: DENIED, mark: DENIED, del: DENIED, purge: DENIED,
        retention: who === "anon" ? DENIED : "no-rows" });
    }
  });

  it("lets an admin see counts and a masked list, each read audited without contacts", async () => {
    const r = await setupThen(async (su) => {
      await seedReg(su);
      await seedReg(su, { email: "sam@example.com", postcode: "CA25 7QQ" });
      await seedReg(su, { email: null, phone: "07700900321", postcode: "LA9 4AA" });
    }, U.admin, async (q) => ({
      counts: await q.rows(`select postcode_district, signups::int, not_yet_notified::int from public.admin_interest_counts() order by 1`),
      list: await q.rows(`select postcode_district, contact_type, contact_masked from public.admin_list_interest() order by contact_masked`),
      ca25: await q.count(`public.admin_list_interest('ca25')`),
      audit: await q.rows<{ action: string; actor: string; detail: unknown }>(
        `select action, actor_id::text as actor, detail from public.audit_log where entity = 'interest_signups' order by id`),
    }));
    expect(r.counts).toEqual([
      { postcode_district: "CA25", signups: 2, not_yet_notified: 2 },
      { postcode_district: "LA9", signups: 1, not_yet_notified: 1 },
    ]);
    expect(r.list).toEqual([
      { postcode_district: "CA25", contact_type: "email", contact_masked: "j•••@example.com" },
      { postcode_district: "CA25", contact_type: "email", contact_masked: "s•••@example.com" },
      { postcode_district: "LA9", contact_type: "phone", contact_masked: "•••321" },
    ]);
    expect(r.ca25).toBe(2);
    expect(r.audit).toEqual([
      { action: "view_counts", actor: U.admin, detail: { districts: 2 } },
      { action: "view_list", actor: U.admin, detail: { district: "all", rows: 3 } },
      { action: "view_list", actor: U.admin, detail: { district: "CA25", rows: 2 } },
    ]);
  });

  it("lets an admin mark people as told and undo it, and delete on request, each change audited (review 5)", async () => {
    const r = await setupThen(async (su) => {
      await seedReg(su);
      await seedReg(su, { email: "sam@example.com", postcode: "CA25 7QQ" });
      await seedReg(su, { email: null, phone: "07700900321", postcode: "LA9 4AA" });
    }, U.admin, async (q) => {
      const ids = async (d: string) => (await q.rows<{ id: string }>(`select id from public.admin_list_interest($1)`, [d])).map((x) => x.id);
      const ca25 = await ids("CA25");
      const la9 = await ids("LA9");
      const marked = (await q.rows<{ n: number }>(`select public.admin_mark_interest_notified($1::uuid[]) as n`, [ca25]))[0]!.n;
      const markedAgain = (await q.rows<{ n: number }>(`select public.admin_mark_interest_notified($1::uuid[]) as n`, [ca25]))[0]!.n;
      const undone = (await q.rows<{ n: number }>(`select public.admin_mark_interest_notified($1::uuid[], false) as n`, [ca25.slice(0, 1)]))[0]!.n;
      const deleted = (await q.rows<{ n: number }>(`select public.admin_delete_interest($1::uuid[]) as n`, [la9]))[0]!.n;
      const after = await q.rows(`select postcode_district, signups::int, not_yet_notified::int from public.admin_interest_counts() order by 1`);
      const audit = await q.rows<{ action: string; actor: string; detail: Record<string, unknown> }>(
        `select action, actor_id::text as actor, detail from public.audit_log where entity = 'interest_signups'
           and action in ('update', 'delete') order by id`);
      return { marked, markedAgain, undone, deleted, after, audit };
    });
    expect(r).toMatchObject({ marked: 2, markedAgain: 0, undone: 1, deleted: 1,
      after: [{ postcode_district: "CA25", signups: 2, not_yet_notified: 1 }] });
    expect(r.audit.map((a) => [a.action, a.actor])).toEqual([["update", U.admin], ["update", U.admin], ["update", U.admin], ["delete", U.admin]]);
    const logged = JSON.stringify(r.audit);
    for (const secret of ["jo.bloggs", "sam@example", "7700900321", "CA25 5AB", "LA9 4AA"]) expect(logged).not.toContain(secret);
    expect(r.audit[3]!.detail.phone).toBe("changed"); // that it went, not what it was
  });

  it("refuses 'mark' with neither told nor not told, rather than quietly changing nothing (final check note 1)", async () => {
    const r = await setupThen(async (su) => { await seedReg(su); }, U.admin, async (q) => {
      const ids = (await q.rows<{ id: string }>(`select id from public.admin_list_interest()`)).map((x) => x.id);
      return q.attempt(`select public.admin_mark_interest_notified($1::uuid[], null)`, [ids]);
    });
    expect(r).toBe("22004");
  });

  it("lets an admin change the retention period", async () => {
    expect(await as("admin", (q) => q.attempt(`update public.settings set interest_retention_months = 12`))).toBe("ok");
    expect(await as("admin", (q) => q.attempt(`update public.settings set interest_retention_months = 60`))).toBe(CHECK);
  });
});

describe("admin export", () => {
  const seed = async (su: Query) => {
    await seedReg(su);
    await seedReg(su, { email: null, phone: "07700 900321", postcode: "CA26 1AA" });
    await seedReg(su, { email: "gone@example.com" });
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
        await seedReg(su, { email });
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

  it("applies a lowered retention setting to rows already stored (review 7)", async () => {
    const left = await setupThen(async (su) => {
      await seedReg(su, { email: "old@example.com" });
      await seedReg(su, { email: "new@example.com" });
      await su.rows(`update public.interest_signups set registered_at = now() - interval '4 months' where email = 'old@example.com'`);
      await su.rows(`update public.settings set interest_retention_months = 3`);
    }, null, async (su) => {
      await su.rows(`select private.purge_interest()`);
      return (await su.rows<{ email: string }>(`select email from public.interest_signups`)).map((x) => x.email);
    });
    expect(left).toEqual(["new@example.com"]);
  });

  it("doesn't switch the audit trigger off: admin deletions straight afterwards are still audited (review 9)", async () => {
    const r = await setupThen(async (su) => {
      await seedReg(su);
      await su.rows(`select private.purge_interest()`);
    }, U.admin, async (q) => {
      const ids = (await q.rows<{ id: string }>(`select id from public.admin_list_interest()`)).map((x) => x.id);
      await q.rows(`select public.admin_delete_interest($1::uuid[])`, [ids]);
      return q.count(`public.audit_log where entity = 'interest_signups' and action = 'delete'`);
    });
    expect(r).toBe(1);
    const triggers = await as("superuser", (q) => q.rows<{ tgenabled: string }>(
      `select tgenabled from pg_trigger where tgrelid = 'public.interest_signups'::regclass and not tgisinternal`));
    expect(triggers.map((t) => t.tgenabled)).toEqual(["O", "O"]);
  });
});
