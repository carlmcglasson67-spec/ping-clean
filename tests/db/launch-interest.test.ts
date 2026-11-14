// Launch interest (signed off by Carl, 14 Nov 2026): customers AND would-be cleaners
// register from /launch with a few optional answers. Same promises as register_interest:
// only the server can add, the tick is required, opt-outs stay out, the reply never
// changes, and every admin read is audited without contacts.
import { afterAll, describe, expect, it } from "vitest";
import { as, CHECK, DENIED, pool, setupThen, U, type Query } from "./helpers";

afterAll(() => pool.end());

const REG = `select public.register_launch_interest($1, $2, $3, $4, $5, $6, $7, $8::jsonb) as reply`;
const USERS = ["anna", "ben", "tara", "alex", "sam", "admin"] as const;
const NOT_ADMIN = ["anon", "anna", "ben", "tara", "alex", "sam"] as const;

type Reg = { kind: string | null; name: string | null; postcode: string; email: string | null; phone: string | null;
  notify: boolean | null; version: string | null; answers: unknown };
const reg = (over: Partial<Reg> = {}): unknown[] => {
  const r: Reg = { kind: "customer", name: " Jo ", postcode: "ca25 5ab", email: "Jo.Bloggs@Example.com ", phone: null, notify: true,
    version: "launch-draft-2026-11", answers: { frequency: "weekly", priorities: ["reliable", "proof"], note: "Never turned up.\nTwice." }, ...over };
  return [r.kind, r.name, r.postcode, r.email, r.phone, r.notify, r.version, r.answers === null ? null : JSON.stringify(r.answers)];
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
const seedReg = (su: Query, over: Partial<Reg> = {}) => su.rows(REG, reg(over));

const all = (su: Query) =>
  su.rows<{ kind: string; first_name: string | null; postcode: string; email: string | null; phone: string | null; source: string;
            consent: string; answers: unknown; months: number }>(
    `select kind, first_name, postcode, email, phone, source, consent_text_version as consent, answers,
            round(extract(epoch from delete_after - registered_at) / 86400 / 30.4)::int as months
       from public.interest_signups order by kind, email, phone`);

describe("register_launch_interest: only the server can call it", () => {
  it("is refused to anon and every signed-in role, so nobody can skip the honeypot, Turnstile or consent version", async () => {
    expect(await as("anon", (q) => q.attempt(REG, reg()))).toBe(DENIED);
    for (const who of USERS) {
      expect({ who, code: await as(who, (q) => q.attempt(REG, reg())) }).toEqual({ who, code: DENIED });
    }
  });

  it("stores a customer with their first name and answers, from the launch page, for Carl's 6 months", async () => {
    const rows = await server(async (q) => {
      expect(await register(q)).toBe("thanks");
      await q.rows(`reset role`);
      return all(q);
    });
    expect(rows).toEqual([{ kind: "customer", first_name: "Jo", postcode: "CA25 5AB", email: "jo.bloggs@example.com", phone: null,
      source: "launch_page", consent: "launch-draft-2026-11",
      answers: { frequency: "weekly", priorities: ["reliable", "proof"], note: "Never turned up.\nTwice." }, months: 6 }]);
  });

  it("stores a would-be cleaner by mobile, with no name and no answers", async () => {
    const rows = await server(async (q) => {
      await register(q, { kind: "cleaner", name: null, email: null, phone: "07700 900321", answers: null });
      await q.rows(`reset role`);
      return all(q);
    });
    expect(rows).toMatchObject([{ kind: "cleaner", first_name: null, email: null, phone: "+447700900321", source: "launch_page", answers: {} }]);
  });

  it("lets the same person be on the list as a customer and as a cleaner, one row each", async () => {
    const rows = await server(async (q) => {
      await register(q);
      await register(q, { kind: "cleaner", answers: { drives: "yes" } });
      await register(q, { kind: "cleaner", answers: { drives: "no" } }); // again: updates, never duplicates
      await q.rows(`reset role`);
      return all(q);
    });
    expect(rows.map((r) => [r.kind, r.answers])).toEqual([
      ["cleaner", { drives: "no" }],
      ["customer", { frequency: "weekly", priorities: ["reliable", "proof"], note: "Never turned up.\nTwice." }],
    ]);
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

  it("renews consent, the retention date and the answers on re-registering, but never clears 'told'", async () => {
    const r = await server(async (q) => {
      await register(q);
      await q.rows(`reset role`);
      await q.rows(`update public.interest_signups set notified_at = now(), registered_at = now() - interval '3 months', delete_after = now() + interval '3 months'`);
      await q.rows(`set local role service_role`);
      await register(q, { name: "Joanne", answers: { frequency: "fortnightly" } });
      await q.rows(`reset role`);
      return q.rows<{ first_name: string; answers: unknown; told: boolean; months: number }>(
        `select first_name, answers, notified_at is not null as told,
                round(extract(epoch from delete_after - now()) / 86400 / 30.4)::int as months from public.interest_signups`);
    });
    expect(r).toEqual([{ first_name: "Joanne", answers: { frequency: "fortnightly" }, told: true, months: 6 }]);
  });

  it("never re-enrols someone who opted out, as a customer or as a cleaner, from any district", async () => {
    const r = await server(async (q) => {
      for (const over of [{}, { kind: "cleaner" }, { postcode: "LA9 4AA" }, { email: "jo.bloggs+ping@example.com" }]) {
        expect(await register(q, over)).toBe("thanks");
      }
      await q.rows(`reset role`);
      return q.rows(`select kind, postcode, unsubscribed_at is not null as out from public.interest_signups`);
    }, async (su) => {
      await seedReg(su);
      await su.rows(`update public.interest_signups set unsubscribed_at = now()`);
    });
    expect(r).toEqual([{ kind: "customer", postcode: "CA25 5AB", out: true }]);
  });

  it("refuses what the person can fix with the same codes as register_interest", async () => {
    const codes = await server(async (q) => ({
      postcode: await q.attempt(REG, reg({ postcode: "Workington" })),
      both: await q.attempt(REG, reg({ phone: "07700900321" })),
      neither: await q.attempt(REG, reg({ email: null })),
      email: await q.attempt(REG, reg({ email: "jo@@example.com" })),
      landline: await q.attempt(REG, reg({ email: null, phone: "01946 123456" })),
    }));
    expect(codes).toEqual({ postcode: "PC030", both: "PC031", neither: "PC031", email: "PC031", landline: "PC031" });
  });

  it("refuses a kind that doesn't exist, a bad consent version or a bad name (PC033)", async () => {
    const codes = await server(async (q) => {
      const out: Record<string, string> = {};
      for (const [label, over] of Object.entries<Partial<Reg>>({
        landlord: { kind: "landlord" }, noKind: { kind: null }, version: { version: "Not A Version!" }, noVersion: { version: null },
        digits: { name: "R2D2" }, formula: { name: "=cmd" }, at: { name: "@jo" }, hyphenFirst: { name: "-Jo" }, tag: { name: "<b>Jo" },
        long: { name: "x".repeat(61) }, control: { name: "Jo\u0007" },
      })) out[label] = await q.attempt(REG, reg(over));
      return out;
    });
    expect(new Set(Object.values(codes))).toEqual(new Set(["PC033"]));
  });

  it("accepts real first names, whatever the database's locale", async () => {
    for (const name of ["Jo", "Mary-Anne", "O’Neil", "D'Arcy", "Zoë", "Anne Marie", "Łukasz"]) {
      const stored = await server(async (q) => {
        await register(q, { name });
        await q.rows(`reset role`);
        return (await all(q))[0]!.first_name;
      });
      expect({ name, stored }).toEqual({ name, stored: name });
    }
  });

  it("refuses answers that aren't the small, flat shape the form sends (PC033)", async () => {
    const bad: Record<string, unknown> = {
      array: ["weekly"],
      nested: { frequency: { deep: "weekly" } },
      number: { bedrooms: 3 },
      boolean: { drives: true },
      upperKey: { Frequency: "weekly" },
      longKey: { ["k".repeat(33)]: "weekly" },
      freeTextOption: { frequency: "whenever suits, really" },
      bigList: { priorities: Array.from({ length: 9 }, (_, i) => `p${i}`) },
      emptyList: { priorities: [] },
      listOfNumbers: { priorities: [1, 2] },
      noteNotText: { note: ["a"] },
      emptyNote: { note: "" },
      longNote: { note: "x".repeat(501) },
      controlNote: { note: "bell\u0007" },
      tooManyKeys: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${"abcdefghijklm"[i]}`, "x"])),
    };
    const codes = await server(async (q) => {
      const out: Record<string, string> = {};
      for (const [label, answers] of Object.entries(bad)) out[label] = await q.attempt(REG, reg({ answers }));
      return out;
    });
    expect(codes).toEqual(Object.fromEntries(Object.keys(bad).map((k) => [k, "PC033"])));
  });

  it("takes a long note with new lines, tabs and any language", async () => {
    // 500 characters in production (UTF-8). Kept under 500 bytes too, so it also holds on a
    // byte-counting test database.
    const note = `Ça n’a jamais marché.\n\tTwice! 你好 ${"x".repeat(440)}`;
    const stored = await server(async (q) => {
      await register(q, { answers: { note } });
      await q.rows(`reset role`);
      return (await all(q))[0]!.answers;
    });
    expect(stored).toEqual({ note });
  });

  it("refuses while the retention period isn't set (PC032)", async () => {
    const code = await server((q) => q.attempt(REG, reg()), (su) => su.rows(`update public.settings set interest_retention_months = null`).then(() => {}));
    expect(code).toBe("PC032");
  });

  it("has the table re-check kind, source, name and answers, whoever writes", async () => {
    const ins = (cols: string, vals: string) =>
      `insert into public.interest_signups (postcode, email, consent_text_version, delete_after, ${cols}) values ('CA25 5AB', 'x@example.com', 'v1', now(), ${vals})`;
    const r = await as("superuser", async (q) => ({
      cleaner: await q.attempt(ins("kind, source", `'cleaner', 'launch_page'`)),
      kind: await q.attempt(ins("kind, source", `'landlord', 'launch_page'`)),
      source: await q.attempt(ins("kind, source", `'customer', 'billboard'`)),
      name: await q.attempt(ins("kind, source, first_name", `'customer', 'launch_page', '=cmd'`)),
      answers: await q.attempt(ins("kind, source, answers", `'customer', 'launch_page', '[1]'::jsonb`)),
      nullAnswers: await q.attempt(ins("kind, source, answers", `'customer', 'launch_page', null`)),
    }));
    expect(r).toEqual({ cleaner: "ok", kind: CHECK, source: CHECK, name: CHECK, answers: CHECK, nullAnswers: "23502" });
  });

  it("leaves register_interest exactly as it was: customers, no name, no answers", async () => {
    const rows = await server(async (q) => {
      await q.rows(`select public.register_interest($1, $2, $3, $4, $5, $6)`, ["CA25 5AB", "old@example.com", null, true, "holding_page", "draft-2026-11"]);
      await q.rows(`reset role`);
      return all(q);
    });
    expect(rows).toMatchObject([{ kind: "customer", first_name: null, source: "holding_page", answers: {} }]);
  });
});

describe("admin: who is who, and what people told us", () => {
  const seed = async (su: Query) => {
    await seedReg(su);
    await seedReg(su, { email: "sam@example.com", name: "Sam", answers: { frequency: "weekly", priorities: ["reliable"] } });
    await seedReg(su, { kind: "cleaner", name: "Tess", email: null, phone: "07700900321", postcode: "CA14 3XX", answers: { drives: "yes", availability: ["weekends", "evenings"] } });
    await seedReg(su, { email: "gone@example.com", answers: { frequency: "fortnightly" } });
    await su.rows(`update public.interest_signups set unsubscribed_at = now() where email = 'gone@example.com'`);
  };

  it("refuses the answer counts to everyone but an admin", async () => {
    for (const who of NOT_ADMIN) {
      const code = await setupThen(seed, who === "anon" ? null : U[who], async (q) => {
        if (who === "anon") await q.rows(`set local role anon`);
        return q.attempt(`select * from public.admin_interest_answer_counts()`);
      });
      expect({ who, code }).toEqual({ who, code: DENIED });
    }
  });

  it("shows kind and tap answers in the masked list, but never the first name or the free-text note", async () => {
    const r = await setupThen(seed, U.admin, async (q) => ({
      list: await q.rows(`select kind, postcode_district, contact_masked, source, answers from public.admin_list_interest() order by contact_masked`),
      columns: Object.keys((await q.rows(`select * from public.admin_list_interest() limit 1`))[0]!),
    }));
    expect(r.list).toEqual([
      { kind: "customer", postcode_district: "CA25", contact_masked: "g•••@example.com", source: "launch_page", answers: { frequency: "fortnightly" } },
      { kind: "customer", postcode_district: "CA25", contact_masked: "j•••@example.com", source: "launch_page", answers: { frequency: "weekly", priorities: ["reliable", "proof"] } },
      { kind: "customer", postcode_district: "CA25", contact_masked: "s•••@example.com", source: "launch_page", answers: { frequency: "weekly", priorities: ["reliable"] } },
      { kind: "cleaner", postcode_district: "CA14", contact_masked: "•••321", source: "launch_page", answers: { drives: "yes", availability: ["weekends", "evenings"] } },
    ]);
    expect(r.columns).not.toContain("first_name");
    expect(JSON.stringify(r.list)).not.toContain("Never turned up");
  });

  it("exports kind, first name and every answer, the note included, and still leaves out anyone who unsubscribed", async () => {
    const r = await setupThen(seed, U.admin, async (q) => ({
      rows: await q.rows(`select kind, first_name, postcode, email, phone, answers from public.admin_export_interest() order by kind, email`),
      audit: await q.rows(`select action, detail from public.audit_log where entity = 'interest_signups' and action = 'export'`),
    }));
    expect(r.rows).toEqual([
      { kind: "cleaner", first_name: "Tess", postcode: "CA14 3XX", email: null, phone: "+447700900321", answers: { drives: "yes", availability: ["weekends", "evenings"] } },
      { kind: "customer", first_name: "Jo", postcode: "CA25 5AB", email: "jo.bloggs@example.com", phone: null,
        answers: { frequency: "weekly", priorities: ["reliable", "proof"], note: "Never turned up.\nTwice." } },
      { kind: "customer", first_name: "Sam", postcode: "CA25 5AB", email: "sam@example.com", phone: null, answers: { frequency: "weekly", priorities: ["reliable"] } },
    ]);
    expect(r.audit).toEqual([{ action: "export", detail: { district: "all", rows: 3 } }]);
  });

  it("tallies each answer per kind, without the note or anyone who unsubscribed, and audits the look with a count only", async () => {
    const r = await setupThen(seed, U.admin, async (q) => ({
      counts: await q.rows(`select kind, question, answer, people::int from public.admin_interest_answer_counts() order by kind, question, answer`),
      audit: await q.rows<{ action: string; actor: string; detail: unknown }>(
        `select action, actor_id::text as actor, detail from public.audit_log where entity = 'interest_signups' order by id`),
    }));
    expect(r.counts).toEqual([
      { kind: "cleaner", question: "availability", answer: "evenings", people: 1 },
      { kind: "cleaner", question: "availability", answer: "weekends", people: 1 },
      { kind: "cleaner", question: "drives", answer: "yes", people: 1 },
      { kind: "customer", question: "frequency", answer: "weekly", people: 2 },
      { kind: "customer", question: "priorities", answer: "proof", people: 1 },
      { kind: "customer", question: "priorities", answer: "reliable", people: 2 },
    ]);
    expect(r.audit).toEqual([{ action: "view_answers", actor: U.admin, detail: { rows: 6 } }]);
    expect(JSON.stringify(r)).not.toContain("example.com");
  });

  it("still lets nobody read or write the table directly, the new columns included", async () => {
    for (const who of [...NOT_ADMIN, "admin"] as const) {
      const r = await setupThen(seed, who === "anon" ? null : U[who], async (q) => {
        if (who === "anon") await q.rows(`set local role anon`);
        return {
          read: await q.attempt(`select first_name, answers from public.interest_signups`),
          write: await q.attempt(`update public.interest_signups set answers = '{}'`),
        };
      });
      expect({ who, ...r }).toEqual({ who, read: DENIED, write: DENIED });
    }
  });
});
