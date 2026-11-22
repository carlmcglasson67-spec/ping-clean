// profiles.email follows the login email (issue #21, note 2;
// supabase/migrations/20261122093000_profile_email_sync.sql).
import { afterAll, describe, expect, it } from "vitest";
import { as, DENIED, pool, U } from "./helpers";

afterAll(() => pool.end());

const profileEmail = async (q: { rows: <R>(s: string, p?: unknown[]) => Promise<R[]> }, id: string) =>
  (await q.rows<{ email: string | null }>(`select email from public.profiles where id = $1`, [id]))[0]?.email;

describe("profiles.email follows auth.users.email", () => {
  it("copies a changed login email into the profile, for that person only", async () => {
    await as("superuser", async (q) => {
      const benBefore = await profileEmail(q, U.ben);
      await q.rows(`update auth.users set email = 'anna.new@ping.test' where id = $1`, [U.anna]);
      expect(await profileEmail(q, U.anna)).toBe("anna.new@ping.test");
      expect(await profileEmail(q, U.ben)).toBe(benBefore);
    });
  });

  it("leaves the profile alone when something else on the login changes", async () => {
    await as("superuser", async (q) => {
      // Put the profile out of step on purpose: only an email change may touch it.
      await q.rows(`update public.profiles set email = 'kept@ping.test' where id = $1`, [U.anna]);
      await q.rows(`update auth.users set raw_user_meta_data = '{"next":"/account"}' where id = $1`, [U.anna]);
      await q.rows(`update auth.users set email = email where id = $1`, [U.anna]); // same address: no change
      expect(await profileEmail(q, U.anna)).toBe("kept@ping.test");
    });
  });

  it("doesn't change while an email change is only half done (Secure email change)", async () => {
    await as("superuser", async (q) => {
      // The first of the two links only records the pending address: email itself is unchanged.
      await q.rows(`update auth.users set email_change = 'anna.next@ping.test' where id = $1`, [U.anna]);
      expect(await profileEmail(q, U.anna)).toBe("anna.customer@ping.test");
    });
  });

  it("logs an email change for admins, without the address", async () => {
    await as("superuser", async (q) => {
      await q.rows(`update auth.users set email = 'anna.logged@ping.test' where id = $1`, [U.anna]);
      const rows = await q.rows<{ action: string; detail: Record<string, unknown> }>(
        `select action, detail from public.audit_log where entity = 'profiles' and entity_id = $1 order by id desc limit 1`, [U.anna]);
      expect(rows[0]).toEqual({ action: "update", detail: { email: "changed" } });
      expect(JSON.stringify(rows)).not.toContain("anna.logged");
      // Nothing logged when the address doesn't change.
      const before = await q.count("public.audit_log");
      await q.rows(`update public.profiles set full_name = full_name where id = $1`, [U.anna]);
      expect(await q.count("public.audit_log")).toBe(before);
    });
  });

  it("runs as its owner with a locked search path, and nobody can call it", async () => {
    await as("superuser", async (q) => {
      const [fn] = await q.rows<{ secdef: boolean; config: string[] | null; public_exec: boolean; auth_exec: boolean }>(
        `select p.prosecdef as secdef, p.proconfig as config,
                has_function_privilege('anon', p.oid, 'execute') as public_exec,
                has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
           from pg_proc p where p.proname = 'sync_profile_email' and p.pronamespace = 'private'::regnamespace`);
      expect(fn).toBeDefined();
      expect(fn!.secdef).toBe(true);
      expect(fn!.config).toContain('search_path=""');
      expect(fn!.public_exec).toBe(false);
      expect(fn!.auth_exec).toBe(false);
    });
  });

  it("still won't let anyone edit their own profile email", async () => {
    for (const who of ["anna", "tara", "admin"] as const) {
      await as(who, async (q) => {
        expect(await q.attempt(`update public.profiles set email = 'mine@ping.test' where id = $1`, [U[who]])).toBe(DENIED);
      });
    }
  });
});
