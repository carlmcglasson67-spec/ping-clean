// Phase 1 "done when": each role logs in and sees only its own data.
// Every table, every seeded role, exact row counts.
import { afterAll, describe, expect, it } from "vitest";
import { as, IDS, pool } from "./helpers";

afterAll(() => pool.end());

const TABLES = [
  "profiles", "cleaners", "cleaner_documents", "settings", "properties", "series", "series_billing", "visits",
  "job_offers", "checklist_templates", "checklist_items", "visit_photos", "reviews", "visit_qc",
  "payments", "payouts", "messages", "audit_log", "engine_alerts", "interest_signups",
] as const;

describe("every table is locked down", () => {
  it("has row level security enabled on every public table", async () => {
    const rows = await as("superuser", (q) =>
      q.rows<{ tablename: string; rowsecurity: boolean }>(
        `select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1`,
      ),
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual([...TABLES].sort());
    expect(rows.filter((r) => !r.rowsecurity)).toEqual([]);
  });

  it("gives anonymous visitors nothing from any table", async () => {
    for (const t of TABLES) {
      const result = await as("anon", (q) => q.attempt(`select * from public.${t}`));
      const n = result === "ok" ? await as("anon", (q) => q.count(`public.${t}`)) : 0;
      expect({ table: t, rows: n }).toEqual({ table: t, rows: 0 });
    }
  });

  it("keeps the private helper schema out of reach of anonymous visitors", async () => {
    expect(await as("anon", (q) => q.attempt(`select private.is_admin()`))).toBe("42501");
  });
});

// Expected visible rows per role. Anything not listed must be 0.
const EXPECTED: Record<string, Partial<Record<(typeof TABLES)[number], number>>> = {
  anna: { profiles: 1, properties: 1, series: 1, visits: 3, checklist_items: 11, visit_photos: 2, reviews: 1, payments: 1, messages: 2 },
  ben: { profiles: 1, properties: 1, series: 1 },
  tara: {
    profiles: 1, cleaners: 1, cleaner_documents: 2, properties: 1, series: 1, visits: 3, job_offers: 2,
    checklist_templates: 1, checklist_items: 11, visit_photos: 2, reviews: 1, visit_qc: 1, payouts: 1, messages: 2,
  },
  alex: { profiles: 1, cleaners: 1, checklist_templates: 1 },
  sam: { profiles: 1, cleaners: 1, cleaner_documents: 1 },
};

describe.each(Object.keys(EXPECTED))("%s sees only their own data", (who) => {
  it("matches the expected row count on every table", async () => {
    const seen: Record<string, number> = {};
    const want: Record<string, number> = {};
    await as(who as keyof typeof EXPECTED & "anna", async (q) => {
      for (const t of TABLES) {
        seen[t] = await q.count(`public.${t}`);
        want[t] = EXPECTED[who]![t] ?? 0;
      }
    });
    expect(seen).toEqual(want);
  });
});

describe("admin", () => {
  it("sees everything", async () => {
    const counts = await as("admin", async (q) => ({
      profiles: await q.count("public.profiles"),
      properties: await q.count("public.properties"),
      series: await q.count("public.series"),
      settings: await q.count("public.settings"),
      documents: await q.count("public.cleaner_documents"),
      offers: await q.count("public.job_offers"),
    }));
    expect(counts).toEqual({ profiles: 6, properties: 2, series: 2, settings: 1, documents: 3, offers: 2 });
  });
});

describe("address privacy", () => {
  it("hides the address of a job a cleaner has only been offered", async () => {
    const rows = await as("tara", (q) =>
      q.rows(`select id from public.properties where id = $1`, [IDS.benProperty]),
    );
    expect(rows).toEqual([]);
  });

  it("shows the full address and access notes once the cleaner holds the series", async () => {
    const [p] = await as("tara", (q) =>
      q.rows<{ address_line1: string; access_notes: string; key_code: string }>(
        `select address_line1, access_notes, key_code from public.properties where id = $1`,
        [IDS.annaProperty],
      ),
    );
    expect(p).toMatchObject({ address_line1: "12 Test Street", key_code: "4721" });
  });

  it("takes the address away again when the series ends", async () => {
    const n = await as("superuser", async (su) => {
      await su.rows(`update public.series set status = 'ended', ends_on = current_date where id = $1`, [IDS.annaSeries]);
      // Same transaction, now acting as Tara.
      await su.rows(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: "00000000-0000-4000-a000-000000000004", role: "authenticated" })]);
      await su.rows(`set local role authenticated`);
      return su.count("public.properties");
    });
    expect(n).toBe(0);
  });
});

describe("public pricing", () => {
  it("lets anyone see the customer price but not the commission", async () => {
    const [p] = await as("anon", (q) => q.rows(`select * from public.public_pricing()`));
    expect(Object.keys(p!).sort()).toEqual(["launch_districts", "min_booking_minutes", "price_per_hour_pence", "ready"]);
    expect(p!.ready).toBe(true);
  });

  it("reports not ready while the real numbers are still unset", async () => {
    const [p] = await as("superuser", async (q) => {
      await q.rows(`update public.settings set price_per_hour_pence = null where id`);
      return q.rows<{ ready: boolean }>(`select * from public.public_pricing()`);
    });
    expect(p!.ready).toBe(false);
  });
});
