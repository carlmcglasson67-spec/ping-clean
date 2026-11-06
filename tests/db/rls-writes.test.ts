// What each role can and cannot change. Escalation attempts must fail.
import { afterAll, describe, expect, it } from "vitest";
import { as, CHECK, DENIED, IDS, pool, U } from "./helpers";

afterAll(() => pool.end());

describe("profiles", () => {
  it("lets a user change their own name and phone", async () => {
    expect(await as("anna", (q) => q.attempt(`update public.profiles set full_name = 'Anna T', phone = '07700 900111' where id = $1`, [U.anna]))).toBe("ok");
  });
  it("never lets a user change their own role", async () => {
    expect(await as("anna", (q) => q.attempt(`update public.profiles set role = 'admin' where id = $1`, [U.anna]))).toBe(DENIED);
    expect(await as("tara", (q) => q.attempt(`update public.profiles set role = 'admin' where id = $1`, [U.tara]))).toBe(DENIED);
  });
  it("does not let a user edit someone else's profile", async () => {
    expect(await as("anna", (q) => q.attempt(`update public.profiles set full_name = 'x' where id = $1`, [U.ben]))).toBe("no-rows");
  });
  it("audits role changes made by an admin path", async () => {
    const rows = await as("superuser", async (q) => {
      await q.rows(`update public.profiles set role = 'cleaner' where id = $1`, [U.ben]);
      return q.rows<{ detail: Record<string, unknown> }>(`select detail from public.audit_log where entity = 'profiles' and entity_id = $1`, [U.ben]);
    });
    expect(rows.at(-1)?.detail).toEqual({ role: { from: "customer", to: "cleaner" } });
  });
});

describe("sign-up", () => {
  it("makes every new login a customer, whatever the sign-up form claims", async () => {
    const role = await as("superuser", async (q) => {
      await q.rows(
        `insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-a000-0000000000aa', 'sneaky@ping.test', '{"role":"admin","full_name":"Sneaky"}')`,
      );
      const [p] = await q.rows<{ role: string }>(`select role from public.profiles where id = '00000000-0000-4000-a000-0000000000aa'`);
      return p!.role;
    });
    expect(role).toBe("customer");
  });
});

describe("cleaners", () => {
  it("lets a cleaner set their own areas, availability and bio", async () => {
    expect(await as("tara", (q) => q.attempt(`update public.cleaners set areas = '{CA14,CA28,CA15}', bio = 'Hi' where id = $1`, [U.tara]))).toBe("ok");
  });
  it("rejects areas that aren't postcode districts", async () => {
    expect(await as("tara", (q) => q.attempt(`update public.cleaners set areas = '{workington}' where id = $1`, [U.tara]))).toBe(CHECK);
  });
  it("never lets a cleaner change their own tier, status or rating", async () => {
    expect(await as("alex", (q) => q.attempt(`update public.cleaners set tier = 'top' where id = $1`, [U.alex]))).toBe(DENIED);
    expect(await as("sam", (q) => q.attempt(`update public.cleaners set status = 'active' where id = $1`, [U.sam]))).toBe(DENIED);
    expect(await as("alex", (q) => q.attempt(`update public.cleaners set rating_avg = 5 where id = $1`, [U.alex]))).toBe(DENIED);
  });
  it("lets a cleaner upload a document only as pending, into their own folder", async () => {
    expect(await as("sam", (q) => q.attempt(
      `insert into public.cleaner_documents (cleaner_id, kind, storage_path) values ($1, 'photo_id', $2)`, [U.sam, `${U.sam}/id.jpg`]))).toBe("ok");
    expect(await as("sam", (q) => q.attempt(
      `insert into public.cleaner_documents (cleaner_id, kind, storage_path, status) values ($1, 'photo_id', $2, 'verified')`, [U.sam, `${U.sam}/id.jpg`]))).toBe(DENIED);
    expect(await as("sam", (q) => q.attempt(
      `insert into public.cleaner_documents (cleaner_id, kind, storage_path) values ($1, 'photo_id', $2)`, [U.sam, `${U.tara}/id.jpg`]))).toBe(CHECK);
  });
  it("does not let a cleaner verify their own documents", async () => {
    expect(await as("sam", (q) => q.attempt(`update public.cleaner_documents set status = 'verified' where cleaner_id = $1`, [U.sam]))).toBe("no-rows");
  });
  it("lets an admin verify a document, and audits it", async () => {
    const r = await as("admin", async (q) => {
      const res = await q.attempt(`update public.cleaner_documents set status = 'verified', reviewed_by = $1, reviewed_at = now() where cleaner_id = $2`, [U.admin, U.sam]);
      const audit = await q.rows<{ actor_id: string; detail: { status?: { to: string } } }>(
        `select actor_id, detail from public.audit_log where entity = 'cleaner_documents' and action = 'update'`);
      return { res, audit };
    });
    expect(r.res).toBe("ok");
    expect(r.audit.at(-1)).toMatchObject({ actor_id: U.admin, detail: { status: { to: "verified" } } });
    expect(JSON.stringify(r.audit)).not.toContain("dbs.pdf"); // file paths stay out of the log
  });
});

describe("apply_as_cleaner", () => {
  it("turns a fresh login into a cleaner applicant with no access to jobs", async () => {
    const id = "00000000-0000-4000-a000-0000000000bb";
    await as("superuser", async (su) => {
      await su.rows(`insert into auth.users (id, email) values ($1, 'new.cleaner@ping.test')`, [id]);
      await su.rows(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: "authenticated" })]);
      await su.rows(`set local role authenticated`);
      const [c] = await su.rows<{ status: string; tier: string }>(`select status, tier from public.apply_as_cleaner()`);
      expect(c).toEqual({ status: "applicant", tier: "new" });
      expect(await su.count("public.job_offers")).toBe(0);
      expect(await su.count("public.checklist_templates")).toBe(0);
    });
  });
  it("refuses a customer who still has a live regular clean", async () => {
    expect(await as("ben", (q) => q.attempt(`select public.apply_as_cleaner()`))).toBe(DENIED);
  });
});

describe("bookings and money are server-only", () => {
  it("lets a customer add their own property but not one for someone else", async () => {
    const add = `insert into public.properties (customer_id, address_line1, town, postcode, bedrooms, bathrooms) values ($1, '1 New Road', 'Workington', 'CA14 1AA', 2, 1)`;
    expect(await as("anna", (q) => q.attempt(add, [U.anna]))).toBe("ok");
    expect(await as("anna", (q) => q.attempt(add, [U.ben]))).toBe(DENIED);
  });
  it("stops cleaners creating customer properties", async () => {
    const add = `insert into public.properties (customer_id, address_line1, town, postcode, bedrooms, bathrooms) values ($1, '1 New Road', 'Workington', 'CA14 1AA', 2, 1)`;
    expect(await as("tara", (q) => q.attempt(add, [U.tara]))).toBe(DENIED);
  });
  it("rejects badly formatted postcodes", async () => {
    const add = `insert into public.properties (customer_id, address_line1, town, postcode, bedrooms, bathrooms) values ($1, '1 New Road', 'Workington', 'ca141aa', 2, 1)`;
    expect(await as("anna", (q) => q.attempt(add, [U.anna]))).toBe(CHECK);
  });
  it("blocks customers and cleaners from writing series, visits, offers, payments or payouts directly", async () => {
    for (const who of ["anna", "tara"] as const) {
      expect(await as(who, (q) => q.attempt(`update public.visits set price_pence = 1, ping_fee_pence = 0, cleaner_earnings_pence = 1`))).toBe(DENIED);
      expect(await as(who, (q) => q.attempt(`update public.series set status = 'ended'`))).toBe(DENIED);
      expect(await as(who, (q) => q.attempt(`update public.job_offers set status = 'claimed'`))).toBe(DENIED);
      expect(await as(who, (q) => q.attempt(`insert into public.payments (visit_id, customer_id, amount_pence, application_fee_pence, idempotency_key) values ($1, $2, 1, 0, 'x')`, [IDS.visitToday, U.anna]))).toBe(DENIED);
      expect(await as(who, (q) => q.attempt(`update public.payouts set amount_pence = 999999`))).toBe(DENIED);
    }
  });
  it("blocks everyone but admins from reading or changing settings", async () => {
    expect(await as("anna", (q) => q.attempt(`update public.settings set price_per_hour_pence = 1 where id`))).toBe("no-rows");
    expect(await as("tara", (q) => q.attempt(`update public.settings set commission_value = 0 where id`))).toBe("no-rows");
    expect(await as("admin", (q) => q.attempt(`update public.settings set commission_value = 2000 where id`))).toBe("ok");
  });
  it("audits settings changes with who made them", async () => {
    const [row] = await as("admin", async (q) => {
      await q.rows(`update public.settings set commission_value = 2000 where id`);
      return q.rows(`select actor_id, detail from public.audit_log where entity = 'settings' order by id desc limit 1`);
    });
    expect(row).toEqual({ actor_id: U.admin, detail: { commission_value: { from: 2500, to: 2000 } } });
  });
});

describe("the clean", () => {
  it("only lets the cleaner tick the checklist while the visit is in progress, and stamps the time itself", async () => {
    // Completed visit: locked.
    expect(await as("tara", (q) => q.attempt(`update public.checklist_items set done = false where visit_id = $1`, [IDS.visitDone]))).toBe("no-rows");

    const result = await as("superuser", async (su) => {
      await su.rows(`update public.visits set status = 'in_progress', started_at = now() where id = $1`, [IDS.visitToday]);
      await su.rows(`insert into public.checklist_items (visit_id, item_key, room, label) values ($1, 'kitchen.sink', 'Kitchen', 'Sink')`, [IDS.visitToday]);
      await su.rows(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.tara, role: "authenticated" })]);
      await su.rows(`set local role authenticated`);
      const tick = await su.attempt(`update public.checklist_items set done = true where visit_id = $1`, [IDS.visitToday]);
      const fakeTime = await su.attempt(`update public.checklist_items set done_at = '2020-01-01' where visit_id = $1`, [IDS.visitToday]);
      const [item] = await su.rows<{ done: boolean; done_at: Date }>(`select done, done_at from public.checklist_items where visit_id = $1`, [IDS.visitToday]);
      return { tick, fakeTime, item };
    });
    expect(result.tick).toBe("ok");
    expect(result.fakeTime).toBe(DENIED);
    expect(result.item!.done).toBe(true);
    expect(Date.now() - result.item!.done_at.getTime()).toBeLessThan(60_000);
  });

  it("stops another cleaner ticking someone else's visit", async () => {
    expect(await as("alex", (q) => q.attempt(`update public.checklist_items set done = false`))).toBe("no-rows");
  });

  it("lets a customer review only their own completed visit", async () => {
    expect(await as("anna", (q) => q.attempt(`insert into public.reviews (visit_id, customer_id, rating) values ($1, $2, 5)`, [IDS.visitToday, U.anna]))).toBe(DENIED);
    expect(await as("ben", (q) => q.attempt(`insert into public.reviews (visit_id, customer_id, rating) values ($1, $2, 1)`, [IDS.visitDone, U.ben]))).toBe(DENIED);
    expect(await as("anna", (q) => q.attempt(`update public.reviews set rating = 4 where visit_id = $1`, [IDS.visitDone]))).toBe("ok");
  });

  it("never shows the internal QC score to the customer", async () => {
    expect(await as("anna", (q) => q.count("public.visit_qc"))).toBe(0);
    expect(await as("tara", (q) => q.count("public.visit_qc"))).toBe(1);
  });
});

describe("messages", () => {
  it("lets the customer and their cleaner talk, and nobody else", async () => {
    const send = `insert into public.messages (series_id, sender_id, body) values ($1, $2, 'Hello')`;
    expect(await as("anna", (q) => q.attempt(send, [IDS.annaSeries, U.anna]))).toBe("ok");
    expect(await as("tara", (q) => q.attempt(send, [IDS.annaSeries, U.tara]))).toBe("ok");
    expect(await as("alex", (q) => q.attempt(send, [IDS.annaSeries, U.alex]))).toBe(DENIED);
    expect(await as("anna", (q) => q.attempt(send, [IDS.annaSeries, U.tara]))).toBe(DENIED); // impersonation
  });
  it("lets only the recipient mark a message read", async () => {
    expect(await as("tara", (q) => q.attempt(`update public.messages set read_at = now() where sender_id = $1`, [U.anna]))).toBe("ok");
    expect(await as("anna", (q) => q.attempt(`update public.messages set read_at = now() where sender_id = $1`, [U.anna]))).toBe("no-rows");
  });
});

describe("storage", () => {
  const upload = `insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())`;
  it("lets cleaners upload documents into their own folder only", async () => {
    expect(await as("sam", (q) => q.attempt(upload, ["cleaner-documents", `${U.sam}/dbs.pdf`]))).toBe("ok");
    expect(await as("sam", (q) => q.attempt(upload, ["cleaner-documents", `${U.tara}/dbs.pdf`]))).toBe(DENIED);
    expect(await as("anna", (q) => q.attempt(upload, ["cleaner-documents", `${U.anna}/dbs.pdf`]))).toBe(DENIED);
  });
  it("only accepts visit photos from the assigned cleaner during the visit", async () => {
    expect(await as("tara", (q) => q.attempt(upload, ["visit-photos", `${IDS.visitToday}/a.jpg`]))).toBe(DENIED); // not started
    expect(await as("alex", (q) => q.attempt(upload, ["visit-photos", `${IDS.visitToday}/a.jpg`]))).toBe(DENIED);
  });
  it("keeps documents private to the cleaner and admins", async () => {
    // Each check plants Tara's file then looks as someone else, in one rolled-back transaction.
    const seen = async (who: "tara" | "alex" | "admin" | "anna") =>
      as("superuser", async (su) => {
        await su.rows(`insert into storage.objects (bucket_id, name) values ('cleaner-documents', $1)`, [`${U.tara}/dbs.pdf`]);
        await su.rows(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U[who], role: "authenticated" })]);
        await su.rows(`set local role authenticated`);
        return su.count("storage.objects");
      });
    expect(await seen("tara")).toBe(1);
    expect(await seen("admin")).toBe(1);
    expect(await seen("alex")).toBe(0);
    expect(await seen("anna")).toBe(0);
  });
});

// Fixes from the independent security review of the Phase 1 branch.
describe("security review fixes", () => {
  const asTaraAfter = async <T>(setup: string[], fn: (q: Parameters<Parameters<typeof as>[1]>[0]) => Promise<T>) =>
    as("superuser", async (su) => {
      for (const sql of setup) await su.rows(sql);
      await su.rows(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.tara, role: "authenticated" })]);
      await su.rows(`set local role authenticated`);
      return fn(su);
    });

  it("takes the address, key code and messages away from a suspended cleaner at once", async () => {
    const r = await asTaraAfter([`update public.cleaners set status = 'suspended' where id = '${U.tara}'`], async (q) => ({
      properties: await q.count("public.properties"),
      messages: await q.count("public.messages"),
      send: await q.attempt(`insert into public.messages (series_id, sender_id, body) values ($1, $2, 'hi')`, [IDS.annaSeries, U.tara]),
    }));
    expect(r).toEqual({ properties: 0, messages: 0, send: DENIED });
  });

  it("keeps Stripe customer and card ids away from cleaners and customers", async () => {
    const cols = await as("superuser", (q) => q.rows<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'series' and column_name like 'stripe%'`));
    expect(cols).toEqual([]);
    const seen = async (who: "tara" | "anna" | "admin") =>
      as("superuser", async (su) => {
        await su.rows(`insert into public.series_billing (series_id, stripe_customer_id, stripe_payment_method_id) values ($1, 'cus_test', 'pm_test')`, [IDS.annaSeries]);
        await su.rows(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U[who], role: "authenticated" })]);
        await su.rows(`set local role authenticated`);
        return su.count("public.series_billing");
      });
    expect(await seen("tara")).toBe(0);
    expect(await seen("anna")).toBe(0);
    expect(await seen("admin")).toBe(1);
  });

  it("logs every money change with the visit and who made it", async () => {
    const [row] = await as("superuser", async (q) => {
      await q.rows(`select set_config('app.actor', 'stripe-webhook', true)`);
      await q.rows(`update public.payments set status = 'refunded', refunded_pence = amount_pence where visit_id = $1`, [IDS.visitDone]);
      return q.rows<{ actor_id: string | null; actor_label: string; detail: { visit_id: string; status: unknown } }>(
        `select actor_id, actor_label, detail from public.audit_log where entity = 'payments' and action = 'update' order by id desc limit 1`);
    });
    expect(row).toMatchObject({ actor_id: null, actor_label: "stripe-webhook", detail: { visit_id: IDS.visitDone, status: { from: "succeeded", to: "refunded" } } });
  });

  it("labels unattributed system changes rather than leaving them blank", async () => {
    const [row] = await as("superuser", async (q) => {
      await q.rows(`update public.payouts set status = 'cancelled' where visit_id = $1`, [IDS.visitDone]);
      return q.rows<{ actor_label: string; detail: { visit_id: string } }>(`select actor_label, detail from public.audit_log where entity = 'payouts' order by id desc limit 1`);
    });
    expect(row).toMatchObject({ actor_label: "system", detail: { visit_id: IDS.visitDone } });
  });

  it("stamps photo times on the server; the phone's clock can't backdate evidence", async () => {
    const r = await asTaraAfter([`update public.visits set status = 'in_progress', started_at = now() where id = '${IDS.visitToday}'`], async (q) => {
      const backdate = await q.attempt(
        `insert into public.visit_photos (visit_id, kind, storage_path, uploaded_by, taken_at) values ($1, 'before', $2, $3, now() - interval '30 days')`,
        [IDS.visitToday, `${IDS.visitToday}/a.jpg`, U.tara]);
      const ok = await q.attempt(
        `insert into public.visit_photos (visit_id, kind, storage_path, uploaded_by, client_taken_at) values ($1, 'before', $2, $3, now() - interval '30 days')`,
        [IDS.visitToday, `${IDS.visitToday}/b.jpg`, U.tara]);
      const [p] = await q.rows<{ age: number }>(`select extract(epoch from now() - taken_at)::int as age from public.visit_photos where storage_path = $1`, [`${IDS.visitToday}/b.jpg`]);
      return { backdate, ok, age: p?.age };
    });
    expect(r.backdate).toBe(DENIED);
    expect(r.ok).toBe("ok");
    expect(r.age).toBeLessThan(60);
  });

  it("never lets an API role truncate a table", async () => {
    expect(await as("anna", (q) => q.attempt(`truncate public.visits`))).toBe(DENIED);
    expect(await as("admin", (q) => q.attempt(`truncate public.settings`))).toBe(DENIED);
  });

  it("lets admins change settings values but not the settings row's id", async () => {
    expect(await as("admin", (q) => q.attempt(`update public.settings set id = true where id`))).toBe(DENIED);
  });

  it("records the admin who actually reviewed a document", async () => {
    expect(await as("admin", (q) => q.attempt(
      `update public.cleaner_documents set status = 'verified', reviewed_by = $1, reviewed_at = now() where cleaner_id = $2`, [U.tara, U.sam]))).toBe(DENIED);
  });
});
