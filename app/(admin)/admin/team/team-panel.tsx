"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button, Card, NavyPanel } from "@/components/ui";
import { NOT_SAVED, type ActionResult } from "../_lib/errors";
import { setAdmin } from "./actions";

export type TeamMember = { id: string; name: string; email: string; you: boolean };
export type TeamChange = { id: string; made: boolean; who: string; by: string; reason: string; when: string };

type Open = { make: true } | { make: false; member: TeamMember };

const FIELD =
  "w-full rounded-md bg-white/8 px-4 py-3 text-base text-on-navy ring-1 ring-inset ring-white/25 placeholder:text-on-navy-3 focus:outline-none focus:ring-2 focus:ring-teal-glow";

/**
 * The admins, and one change at a time: add someone or remove someone. Each needs a reason
 * and a second press that says exactly what will happen. The database decides and logs it.
 */
export function TeamPanel({ members, changes }: { members: TeamMember[]; changes: TeamChange[] }) {
  const router = useRouter();
  const emailId = useId();
  const whyId = useId();
  const [open, setOpen] = useState<Open | null>(null);
  const [email, setEmail] = useState("");
  const [why, setWhy] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const begin = (o: Open) => {
    setOpen(o);
    setEmail(o.make ? "" : o.member.email);
    setWhy("");
    setChecking(false);
    setResult(null);
  };
  const close = () => {
    setOpen(null);
    setChecking(false);
  };

  const submit = () => {
    if (!open) return;
    start(async () => {
      let r: ActionResult;
      try {
        r = await setAdmin({ email, make: open.make, reason: why });
      } catch {
        r = { ok: false, message: NOT_SAVED };
      }
      setResult(r);
      if (r.ok) {
        close();
        router.refresh();
      } else {
        setChecking(false);
      }
    });
  };

  const others = members.filter((m) => !m.you).length;

  return (
    <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
      <section aria-labelledby="admins-title" className="grid content-start gap-4 lg:col-span-7">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 id="admins-title" className="text-2xl font-semibold">
            Admins <span className="text-navy-3 tabular">{members.length}</span>
          </h2>
          {!open ? (
            <Button size="lg" onClick={() => begin({ make: true })}>
              Add an admin
            </Button>
          ) : null}
        </div>
        <ul className="grid gap-3">
          {members.map((m) => (
            <li key={m.id}>
              <Card className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
                <div className="grid min-w-0 gap-1">
                  <span className="text-lg font-semibold">
                    {m.name}
                    {m.you ? <span className="ml-2 text-sm font-semibold text-teal-ink">You</span> : null}
                  </span>
                  <span className="truncate text-navy-2">{m.email}</span>
                </div>
                {!m.you && !open ? (
                  <Button variant="secondary" onClick={() => begin({ make: false, member: m })}>
                    Remove admin
                  </Button>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
        {others === 0 ? (
          <p className="text-navy-2">You&rsquo;re the only admin. Add a second so Ping is never left with nobody who can run it.</p>
        ) : null}
        {result ? (
          <p role={result.ok ? "status" : "alert"} className={result.ok ? "font-semibold text-ok" : "font-semibold text-bad"}>
            {result.message}
          </p>
        ) : null}
      </section>

      <div className="grid content-start gap-6 lg:col-span-5">
        {open ? (
          <NavyPanel className="grid gap-5 p-6 pb-14 sm:p-7 sm:pb-16">
            <h2 className="text-lg font-semibold">{open.make ? "Add an admin" : `Remove ${open.member.name}`}</h2>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!checking) setChecking(true);
                else submit();
              }}
            >
              {open.make ? (
                <div className="grid gap-2">
                  <label htmlFor={emailId} className="text-sm font-semibold">
                    Their email
                  </label>
                  <input
                    id={emailId}
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="off"
                    value={email}
                    disabled={checking}
                    onChange={(e) => setEmail(e.target.value)}
                    className={FIELD}
                  />
                  <p className="text-sm text-on-navy-3">The address they signed up with. They must have opened the link we emailed them.</p>
                </div>
              ) : null}
              <div className="grid gap-2">
                <label htmlFor={whyId} className="text-sm font-semibold">
                  Why
                </label>
                <textarea id={whyId} required maxLength={300} rows={2} value={why} disabled={checking} onChange={(e) => setWhy(e.target.value)} className={FIELD} />
              </div>

              {checking ? (
                <p className="rounded-md bg-white/8 p-4 text-on-navy ring-1 ring-inset ring-white/20">
                  {open.make ? (
                    <>
                      <strong className="font-semibold">{email.trim()}</strong> will see every customer&rsquo;s address and access notes, every
                      cleaner&rsquo;s documents and every payment, and can change all of it. Sure?
                    </>
                  ) : (
                    <>
                      <strong className="font-semibold">{open.member.name}</strong> loses the console straight away. Their account becomes a
                      customer one. Sure?
                    </>
                  )}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button type="submit" variant={open.make ? "signal" : "danger"} pending={pending} disabled={pending}>
                  {checking ? (open.make ? "Yes, make them an admin" : "Yes, remove them") : "Continue"}
                </Button>
                <Button type="button" variant="onNavy" disabled={pending} onClick={checking ? () => setChecking(false) : close}>
                  {checking ? "Go back" : "Cancel"}
                </Button>
              </div>
            </form>
            <p className="text-sm text-on-navy-3">Checked by the database and logged with your name and the reason.</p>
          </NavyPanel>
        ) : null}

        <section aria-labelledby="changes-title" className="grid gap-4">
          <h2 id="changes-title" className="text-lg font-semibold">
            Recent changes
          </h2>
          {changes.length === 0 ? (
            <p className="text-navy-2">None yet. The first admin was made by hand at go-live.</p>
          ) : (
            <ol className="grid gap-3">
              {changes.map((c) => (
                <li key={c.id} className="border-l-2 border-teal-ink pl-4">
                  <p className="font-semibold">
                    {c.who} {c.made ? "made an admin" : "removed as admin"}
                  </p>
                  <p className="text-sm text-navy-2">
                    By {c.by}, {c.when}
                    {c.reason ? `: “${c.reason}”` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
