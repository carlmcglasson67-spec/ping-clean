// Payments PR 2: fixes from the independent security review (8 Nov 2026). Each test tries
// the reviewer's attack and checks the database refuses it.
import { afterAll, describe, expect, it } from "vitest";
import { as, CHECK, DENIED, IDS, pool, setupThen, U, type Query } from "./helpers";

afterAll(() => pool.end());

const SEED_PAYMENT = "00000000-0000-4000-f000-000000000001";
const SEED_PAYOUT = "00000000-0000-4000-f200-000000000001";
const SEED_BATCH = "00000000-0000-4000-f100-000000000001";
const PAY_TODAY = "00000000-0000-4000-f000-0000000000c1";
const PAY_NEXT = "00000000-0000-4000-f000-0000000000c2";
const FK = "23503";
const NOT_NULL = "23502";

/** A charge on one of Anna's cleans (5000 = 3750 + 1250, the seed's split), moved to `to`. */
async function charge(su: Query, id: string, visit: string, to: string[] = ["processing", "succeeded"]) {
  await su.rows(`insert into public.payments (id, visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, idempotency_key)
                 values ($1, $2, $3, 5000, 1250, 3750, $4)`, [id, visit, U.anna, `charge:${id}`]);
  for (const s of to) await su.rows(`update public.payments set status = '${s}' where id = $1`, [id]);
}

const payout = (visit: string, cleaner: string, payment: string, amount: number, key: string) =>
  `insert into public.payouts (visit_id, cleaner_id, payment_id, amount_pence, available_after, idempotency_key)
   values ('${visit}', '${cleaner}', '${payment}', ${amount}, now() + interval '3 days', '${key}')`;

describe("1. a cleaner's Stripe account id", () => {
  it("can't be read by the cleaner (or any signed-in role), while the rest of their row can", async () => {
    const r = await as("superuser", async (q) => {
      await q.rows(`update public.cleaners set stripe_account_id = 'acct_TestTara01' where id = $1`, [U.tara]);
      await q.actAs(U.tara);
      return {
        acct: await q.attempt(`select stripe_account_id from public.cleaners where id = $1`, [U.tara]),
        star: await q.attempt(`select * from public.cleaners where id = $1`, [U.tara]),
        rest: (await q.rows(`select status, tier, stripe_payouts_enabled from public.cleaners where id = $1`, [U.tara]))[0],
      };
    });
    expect(r).toEqual({ acct: DENIED, star: DENIED, rest: { status: "active", tier: "top", stripe_payouts_enabled: false } });
    expect(await as("admin", (q) => q.attempt(`select stripe_account_id from public.cleaners`))).toBe(DENIED);
  });

  it("doesn't break any read or write the apps make on cleaners (column lists copied from app/)", async () => {
    const reads = ["status, tier, areas, rating_avg, completed_visits", "status, areas", "status, tier, areas, availability",
      "areas", "areas, availability", "status", "bio"];
    const r = await as("tara", async (q) => ({
      reads: await (async () => {
        const out: string[] = [];
        for (const cols of reads) out.push(await q.attempt(`select ${cols} from public.cleaners where id = '${U.tara}'`));
        return out;
      })(),
      areas: await q.attempt(`update public.cleaners set areas = areas, availability = availability where id = '${U.tara}' returning id`),
      bio: await q.attempt(`update public.cleaners set bio = 'Tidy and quick' where id = '${U.tara}' returning id`),
    }));
    expect(r).toEqual({ reads: reads.map(() => "ok"), areas: "ok", bio: "ok" });
    const admin = await as("admin", (q) => q.attempt(`select id from public.cleaners where status = 'active'`));
    expect(admin).toBe("ok");
  });

  it("is the only cleaners column held back from signed-in roles", async () => {
    const r = await as("superuser", (q) => q.rows<{ column_name: string; readable: boolean }>(
      `select column_name, has_column_privilege('authenticated', 'public.cleaners', column_name, 'select') as readable
         from information_schema.columns where table_schema = 'public' and table_name = 'cleaners'`));
    expect(r.filter((c) => !c.readable).map((c) => c.column_name)).toEqual(["stripe_account_id"]);
  });
});

describe("2. a payout must come from a succeeded payment for that clean", () => {
  const run = (sql: string) => as("superuser", async (q) => {
    await charge(q, PAY_TODAY, IDS.visitToday);
    await charge(q, PAY_NEXT, IDS.visitNextWeek, []); // still pending: nothing collected
    return q.attempt(sql);
  });

  it("refuses the reviewer's attacks: wrong clean, wrong cleaner, unpaid payment, made-up amount", async () => {
    expect(await run(payout(IDS.visitNextWeek, U.tara, PAY_TODAY, 3750, "wrong-visit"))).toBe("PC043");
    expect(await run(payout(IDS.visitToday, U.alex, PAY_TODAY, 3750, "wrong-cleaner"))).toBe("PC043");
    expect(await run(payout(IDS.visitNextWeek, U.tara, PAY_NEXT, 3750, "unpaid"))).toBe("PC043");
    expect(await run(payout(IDS.visitToday, U.tara, PAY_TODAY, 99999, "amount"))).toBe("PC043");
    expect(await run(`insert into public.payouts (visit_id, cleaner_id, amount_pence, available_after, idempotency_key)
                      values ('${IDS.visitToday}', '${U.tara}', 3750, now(), 'no-payment')`)).toBe(NOT_NULL);
    expect(await run(payout(IDS.visitToday, U.tara, PAY_TODAY, 3750, "right"))).toBe("ok");
  });

  it("can't be changed afterwards to another amount, payment, clean or cleaner", async () => {
    for (const set of ["amount_pence = 99999", `payment_id = '${PAY_TODAY}'`, `cleaner_id = '${U.alex}'`, `visit_id = '${IDS.visitToday}'`]) {
      const code = await run(`update public.payouts set ${set} where id = '${SEED_PAYOUT}'`);
      expect({ set, code }).toEqual({ set, code: "PC043" });
    }
  });

  it("isn't sent to the bank once its payment is disputed", async () => {
    const r = await as("superuser", async (q) => {
      await charge(q, PAY_TODAY, IDS.visitToday);
      await q.rows(payout(IDS.visitToday, U.tara, PAY_TODAY, 3750, "po-dispute"));
      await q.rows(`update public.payments set status = 'disputed' where id = $1`, [PAY_TODAY]);
      return q.attempt(`update public.payouts set status = 'in_batch', stripe_payout_id = 'po_TestBatch02' where idempotency_key = 'po-dispute'`);
    });
    expect(r).toBe("PC043");
  });
});

describe("3. a payment belongs to its clean", () => {
  const pay = (customer: string, amount: number, cleaner: number, fee: number, key: string) =>
    `insert into public.payments (visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, idempotency_key)
     values ('${IDS.visitToday}', '${customer}', ${amount}, ${fee}, ${cleaner}, '${key}')`;

  it("refuses Ben paying on Anna's clean, and a charge that isn't the clean's price and split", async () => {
    const r = await as("superuser", async (q) => ({
      ben: await q.attempt(pay(U.ben, 99999, 74999, 25000, "ben-on-anna")),
      price: await q.attempt(pay(U.anna, 99999, 74999, 25000, "anna-99999")),
      split: await q.attempt(pay(U.anna, 5000, 4000, 1000, "anna-split")),
      right: await q.attempt(pay(U.anna, 5000, 3750, 1250, "anna-right")),
      later: await q.attempt(`update public.payments set amount_pence = 99999, cleaner_amount_pence = 74999, application_fee_pence = 25000
                              where idempotency_key = 'anna-right'`),
      moved: await q.attempt(`update public.payments set customer_id = '${U.ben}' where idempotency_key = 'anna-right'`),
    }));
    expect(r).toEqual({ ben: FK, price: "PC044", split: "PC044", right: "ok", later: "PC044", moved: FK });
  });
});

describe("4. Carl's settings in the seed", () => {
  it("match his decisions, and the late-cancel share stays empty while it follows the clean's split", async () => {
    const r = await as("superuser", async (q) => ({
      s: (await q.rows(`select dispute_window_hours, late_cancel_split, late_cancel_cleaner_share_bps from public.settings`))[0],
      share: await q.attempt(`update public.settings set late_cancel_cleaner_share_bps = 5000`),
      fixed: await q.attempt(`update public.settings set late_cancel_split = 'fixed_share', late_cancel_cleaner_share_bps = 5000`),
    }));
    expect(r).toEqual({ s: { dispute_window_hours: 72, late_cancel_split: "same_as_clean", late_cancel_cleaner_share_bps: null },
      share: CHECK, fixed: "ok" });
  });
});

describe("5. money rows are never deleted", () => {
  const TABLES = ["payments", "payouts", "refunds", "payout_batches"] as const;
  const withRefund = async (q: Query) => {
    await q.rows(`insert into public.refunds (payment_id, amount_pence, cleaner_part_pence, ping_part_pence, reason, idempotency_key)
                  values ($1, 100, 75, 25, 'goodwill', 'r-keep')`, [SEED_PAYMENT]);
  };

  it("refuses delete and truncate to every API role, the server's service role included", async () => {
    for (const role of ["service_role", "authenticated", "anon"]) {
      for (const t of TABLES) {
        const r = await as("superuser", async (q) => {
          await withRefund(q);
          await q.rows(`set local role ${role}`);
          return { del: await q.attempt(`delete from public.${t}`), trunc: await q.attempt(`truncate public.${t} cascade`) };
        });
        expect({ role, t, ...r }).toEqual({ role, t, del: DENIED, trunc: DENIED });
      }
    }
  });

  it("refuses even the database owner, row by row or the whole table", async () => {
    for (const t of TABLES) {
      const r = await as("superuser", async (q) => {
        await withRefund(q);
        return { del: await q.attempt(`delete from public.${t}`), trunc: await q.attempt(`truncate public.${t} cascade`) };
      });
      expect({ t, ...r }).toEqual({ t, del: "PC045", trunc: "PC045" });
    }
  });

  it("so a clean with money rows can't be deleted or truncated away either", async () => {
    const r = await as("superuser", async (q) => ({
      del: await q.attempt(`delete from public.visits where id = $1`, [IDS.visitDone]),
      trunc: await q.attempt(`truncate public.visits cascade`),
      kept: await q.count("public.payments"),
    }));
    // PC016 once "visits never deleted" (PR #30) is in; the foreign key refuses it before that.
    expect(["PC016", FK]).toContain(r.del);
    expect({ trunc: r.trunc, kept: r.kept }).toEqual({ trunc: "PC045", kept: 1 });
  });
});

describe("6. state maps", () => {
  it("every new money row starts at the start of its map", async () => {
    const r = await as("superuser", async (q) => ({
      payment: await q.attempt(`insert into public.payments (visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, idempotency_key, status)
                                values ($1, $2, 5000, 1250, 3750, 'start', 'succeeded')`, [IDS.visitToday, U.anna]),
      payout: await q.attempt(`insert into public.payouts (visit_id, cleaner_id, payment_id, amount_pence, available_after, idempotency_key, status, paid_at, stripe_payout_id)
                               values ($1, $2, $3, 3750, now(), 'start', 'paid', now(), 'po_TestStart01')`, [IDS.visitDone, U.tara, SEED_PAYMENT]),
      refund: await q.attempt(`insert into public.refunds (payment_id, amount_pence, cleaner_part_pence, ping_part_pence, reason, idempotency_key, status)
                               values ($1, 100, 75, 25, 'goodwill', 'start', 'succeeded')`, [SEED_PAYMENT]),
      batch: await q.attempt(`insert into public.payout_batches (cleaner_id, amount_pence, idempotency_key, status) values ($1, 100, 'start', 'paid')`, [U.tara]),
    }));
    expect(r).toEqual({ payment: "PC046", payout: "PC046", refund: "PC046", batch: "PC046" });
  });

  it("refunds never go back to pending and a failed one stays failed; bank payouts never go back to created", async () => {
    const moves = (start: string[], next: string) => as("superuser", async (q) => {
      await q.rows(`insert into public.refunds (payment_id, amount_pence, cleaner_part_pence, ping_part_pence, reason, idempotency_key)
                    values ($1, 100, 75, 25, 'goodwill', 'r-move')`, [SEED_PAYMENT]);
      for (const s of start) await q.rows(`update public.refunds set status = '${s}' where idempotency_key = 'r-move'`);
      return q.attempt(`update public.refunds set status = '${next}' where idempotency_key = 'r-move'`);
    });
    expect(await moves(["succeeded"], "pending")).toBe("PC047");
    expect(await moves(["failed"], "succeeded")).toBe("PC047");
    expect(await moves(["succeeded"], "failed")).toBe("ok"); // Stripe can report a late failure
    expect(await as("superuser", (q) => q.attempt(`update public.payout_batches set status = 'created' where id = $1`, [SEED_BATCH]))).toBe("PC041");
  });

  it("refuses a refund on a payment that was never taken, or was lost to a dispute", async () => {
    const refundOn = (to: string[]) => as("superuser", async (q) => {
      await charge(q, PAY_TODAY, IDS.visitToday, to);
      return q.attempt(`insert into public.refunds (payment_id, amount_pence, cleaner_part_pence, ping_part_pence, reason, idempotency_key)
                        values ($1, 100, 75, 25, 'goodwill', 'r-lost')`, [PAY_TODAY]);
    });
    expect(await refundOn([])).toBe("PC048");
    expect(await refundOn(["processing", "succeeded", "disputed", "dispute_lost"])).toBe("PC048");
    expect(await refundOn(["processing", "succeeded"])).toBe("ok");
  });
});

describe("7. the audit log never stores Stripe ids, keys or a cleaner's account", () => {
  it("records that they changed, not what they changed to", async () => {
    const rows = await as("superuser", async (q) => {
      await q.rows(`update public.cleaners set stripe_account_id = 'acct_TestTara01' where id = $1`, [U.tara]);
      await charge(q, PAY_TODAY, IDS.visitToday);
      await q.rows(`update public.payments set stripe_payment_intent_id = 'pi_TestSecret01', stripe_charge_id = 'ch_TestSecret01',
                    cleaner_account_id = 'acct_TestTara01' where id = $1`, [PAY_TODAY]);
      await q.rows(payout(IDS.visitToday, U.tara, PAY_TODAY, 3750, "payout:secret-key"));
      await q.rows(`insert into public.payout_batches (cleaner_id, amount_pence, idempotency_key, stripe_payout_id)
                    values ($1, 3750, 'batch:secret-key', 'po_TestSecret01')`, [U.tara]);
      await q.rows(`insert into public.refunds (payment_id, amount_pence, cleaner_part_pence, ping_part_pence, reason, idempotency_key)
                    values ($1, 100, 75, 25, 'goodwill', 'refund:secret-key')`, [PAY_TODAY]);
      await q.rows(`update public.refunds set stripe_refund_id = 're_TestSecret01' where idempotency_key = 'refund:secret-key'`);
      return q.rows<{ entity: string; detail: Record<string, unknown> }>(
        `select entity, detail from public.audit_log where entity in ('cleaners', 'payments', 'payouts', 'payout_batches', 'refunds') order by id`);
    });
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/acct_Test|pi_TestSecret|ch_TestSecret|po_TestSecret|re_TestSecret|secret-key/);
    const cleaner = rows.find((r) => r.entity === "cleaners")!;
    expect(cleaner.detail).toMatchObject({ stripe_account_id: "changed" });
    const paymentUpdate = rows.filter((r) => r.entity === "payments").at(-1)!;
    expect(paymentUpdate.detail).toMatchObject({ stripe_payment_intent_id: "changed", stripe_charge_id: "changed", cleaner_account_id: "changed" });
  });
});

describe("re-review: refunds once sent", () => {
  const refund = async (q: Query, key: string, payment = SEED_PAYMENT) => {
    await q.rows(`insert into public.refunds (payment_id, amount_pence, cleaner_part_pence, ping_part_pence, reason, idempotency_key)
                  values ($1, 1000, 750, 250, 'clean_quality', $2)`, [payment, key]);
  };

  it("can be re-split while pending, but the amount and split are frozen once it leaves pending", async () => {
    const r = await as("superuser", async (q) => {
      await refund(q, "r-freeze");
      const whilePending = await q.attempt(`update public.refunds set amount_pence = 800, cleaner_part_pence = 600, ping_part_pence = 200 where idempotency_key = 'r-freeze'`);
      await q.rows(`update public.refunds set status = 'succeeded' where idempotency_key = 'r-freeze'`);
      const out: Record<string, string> = { whilePending };
      for (const [k, set] of [
        ["amount", "amount_pence = 2000, cleaner_part_pence = 1500, ping_part_pence = 500"],
        ["split", "cleaner_part_pence = 0, ping_part_pence = 800"],
        ["reason", "reason = 'ping_error'"],
        ["withFailure", "status = 'failed', amount_pence = 2000, cleaner_part_pence = 1500, ping_part_pence = 500"],
      ] as const) out[k] = await q.attempt(`update public.refunds set ${set} where idempotency_key = 'r-freeze'`);
      return out;
    });
    expect(r).toEqual({ whilePending: "ok", amount: "PC047", split: "PC047", reason: "PC047", withFailure: "PC047" });
  });

  it("can't succeed on a payment that was lost to a dispute (the admin resolves it)", async () => {
    const r = await as("superuser", async (q) => {
      await charge(q, PAY_TODAY, IDS.visitToday);
      await refund(q, "r-dispute", PAY_TODAY);
      await q.rows(`update public.payments set status = 'disputed' where id = $1`, [PAY_TODAY]);
      await q.rows(`update public.payments set status = 'dispute_lost' where id = $1`, [PAY_TODAY]);
      return {
        succeed: await q.attempt(`update public.refunds set status = 'succeeded' where idempotency_key = 'r-dispute'`),
        fail: await q.attempt(`update public.refunds set status = 'failed' where idempotency_key = 'r-dispute'`),
      };
    });
    expect(r).toEqual({ succeed: "PC048", fail: "ok" });
  });
});

describe("re-review: a payout only goes into its own cleaner's bank payout", () => {
  it("refuses Tara's payout in Alex's batch, allows it in her own", async () => {
    const r = await as("superuser", async (q) => {
      await charge(q, PAY_TODAY, IDS.visitToday);
      await q.rows(payout(IDS.visitToday, U.tara, PAY_TODAY, 3750, "po-batch"));
      const [alex] = await q.rows<{ id: string }>(`insert into public.payout_batches (cleaner_id, amount_pence, idempotency_key)
                                                    values ($1, 3750, 'batch:alex') returning id`, [U.alex]);
      const [tara] = await q.rows<{ id: string }>(`insert into public.payout_batches (cleaner_id, amount_pence, idempotency_key)
                                                    values ($1, 3750, 'batch:tara') returning id`, [U.tara]);
      const into = (batch: string) => q.attempt(
        `update public.payouts set status = 'in_batch', batch_id = $1 where idempotency_key = 'po-batch'`, [batch]);
      return { alex: await into(alex!.id), tara: await into(tara!.id),
               moved: await q.attempt(`update public.payouts set batch_id = $1 where idempotency_key = 'po-batch'`, [alex!.id]) };
    });
    expect(r).toEqual({ alex: "PC043", tara: "ok", moved: "PC043" });
  });
});

describe("re-review: ending a block says why its cleans were cancelled", () => {
  it("admin_end_block stamps the cancelled cleans 'block_ended', and leaves the done one alone", async () => {
    const rows = await setupThen(async () => {}, U.admin, async (q) => {
      await q.rows(`select public.admin_end_block($1, 'Customer moving house')`, [IDS.annaSeries]);
      await q.rows(`reset role`);
      return q.rows<{ id: string; status: string; cancel_reason: string | null }>(
        `select id, status::text, cancel_reason from public.visits where series_id = $1 order by scheduled_date`, [IDS.annaSeries]);
    });
    expect(rows).toEqual([
      { id: IDS.visitDone, status: "completed", cancel_reason: null },
      { id: IDS.visitToday, status: "cancelled", cancel_reason: "block_ended" },
      { id: IDS.visitNextWeek, status: "cancelled", cancel_reason: "block_ended" },
    ]);
  });
});
