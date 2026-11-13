import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { resolveSiteUrl } from "@/lib/env";
import { formatDay } from "@/lib/dates";
import { formatPence } from "@/lib/money";

// Emails to customers about a payment (payments PR 8), sent through Resend's HTTP API.
// The database queues them (private.customer_notices), once each; this file words and sends
// them. Off until RESEND_API_KEY and PING_EMAIL_FROM are set: notices then simply wait.
// Logs carry the notice id and kind only, never the address or the wording.

export type NoticeKind = "payment_failed" | "payment_needs_confirming" | "block_on_hold" | "block_ended_unpaid";

type Env = Record<string, string | undefined>;

/** Where emails are sent from, or null when email isn't set up (or is set up wrongly). */
export function emailConfig(env: Env = process.env): { key: string; from: string } | null {
  const key = env.RESEND_API_KEY;
  const from = env.PING_EMAIL_FROM;
  if (!key || !/^re_[A-Za-z0-9_]{10,200}$/.test(key)) return null;
  if (!from || !/^[^<>\r\n]{0,60}<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from)) return null;
  return { key, from };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type NoticeFacts = { firstName: string | null; amountPence: number | null; cleanDate: string | null; link: string; lateCancelFee?: boolean };

/** The wording of each email. Plain, short, and never a promise Ping can't keep. */
export function noticeEmail(kind: NoticeKind, f: NoticeFacts): { subject: string; text: string; html: string } {
  const hello = f.firstName ? `Hello ${f.firstName},` : "Hello,";
  const what = f.lateCancelFee ? "the late-cancellation fee for your clean" : "your clean";
  const clean = f.cleanDate ? `${what} on ${formatDay(f.cleanDate)}` : what;
  const amount = f.amountPence != null ? ` (${formatPence(f.amountPence)})` : "";
  let subject: string;
  let lines: string[];
  let action: string | null;
  switch (kind) {
    case "payment_needs_confirming":
      subject = "Your bank needs you to confirm a payment";
      lines = [`Your bank wants you to confirm the payment for ${clean}${amount} before it goes through.`, "It takes a minute, and nothing is taken until you do."];
      action = "Confirm the payment";
      break;
    case "payment_failed":
      subject = f.lateCancelFee ? "We couldn't take your late-cancellation fee" : "We couldn't take payment for your clean";
      lines = [`We couldn't take the payment for ${clean}${amount}. Your bank declined it.`, "You can pay now with the same card, or use a different one."];
      action = "Sort the payment";
      break;
    case "block_on_hold":
      subject = "Your cleans are on hold";
      lines = [
        `We've tried the payment for ${clean}${amount} and your bank has declined it each time.`,
        "Your remaining cleans are on hold, so your cleaner won't come until this is paid. As soon as it is, they're back on.",
        "If it stays unpaid, the rest of your cleans will be cancelled.",
      ];
      action = "Pay and restart your cleans";
      break;
    default:
      subject = "Your cleans have been cancelled";
      lines = ["A payment for one of your cleans is still unpaid, so the rest of your cleans have been cancelled and your cleaner has been released.", "The unpaid clean is still owed. Once it's paid you're welcome to book again."];
      action = "Go to your account";
  }
  const sign = "Reply to this email if anything here looks wrong.\n\nPing Clean";
  const text = [hello, "", ...lines.flatMap((l) => [l, ""]), `${action}: ${f.link}`, "", sign].join("\n");
  const html =
    `<div style="font-family:Figtree,Arial,sans-serif;font-size:17px;line-height:1.55;color:#001D44;max-width:560px">` +
    `<p>${escape(hello)}</p>` +
    lines.map((l) => `<p>${escape(l)}</p>`).join("") +
    `<p style="margin:28px 0"><a href="${escape(f.link)}" style="background:#0052FE;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 26px;border-radius:999px;display:inline-block">${escape(action)}</a></p>` +
    `<p>Reply to this email if anything here looks wrong.</p><p>Ping Clean</p></div>`;
  return { subject, text, html };
}

export type NoticeRun = { off?: true; claimed: number; sent: number; failed: number };

/**
 * Sends the notices that are due. A notice that fails is left for the next run (the database
 * hands it out again 10 minutes later, five times at most). Resend is given the notice id
 * as an idempotency key, so a retry after a timeout can't send the same email twice.
 */
export async function sendDueNotices(limit = 20, fetcher: typeof fetch = fetch): Promise<NoticeRun> {
  const config = emailConfig();
  const site = resolveSiteUrl();
  if (!config || !site) return { off: true, claimed: 0, sent: 0, failed: 0 };
  const db = createAdminClient();
  const claimed = await db.rpc("notices_claim", { p_limit: limit });
  if (claimed.error) throw new Error("couldn't read the notices that are due");
  const run: NoticeRun = { claimed: claimed.data?.length ?? 0, sent: 0, failed: 0 };

  for (const n of claimed.data ?? []) {
    let problem: string | null = null;
    if (!n.email) problem = "no_email_address";
    else {
      const link = n.payment_id && n.kind !== "block_ended_unpaid" ? `${site}/account/pay/${n.payment_id}` : `${site}/account`;
      // A late-cancellation fee is worded as one: there was no clean to pay for.
      const kind = n.payment_id ? (await db.from("payments").select("kind").eq("id", n.payment_id).maybeSingle()).data?.kind : null;
      const mail = noticeEmail(n.kind, { firstName: n.full_name?.trim().split(/\s+/)[0] || null, amountPence: n.amount_pence, cleanDate: n.clean_date, link, lateCancelFee: kind === "late_cancel" });
      try {
        const res = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${config.key}`, "content-type": "application/json", "idempotency-key": `ping-notice-${n.notice_id}` },
          body: JSON.stringify({ from: config.from, to: [n.email], subject: mail.subject, text: mail.text, html: mail.html }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) problem = `resend_${res.status}`;
      } catch {
        problem = "resend_unreachable";
      }
    }
    const noted = await db.rpc("notice_sent", { p_notice: n.notice_id, p_error: problem });
    if (problem || noted.error) {
      run.failed++;
      console.error(`notices: ${n.kind} ${n.notice_id} not sent (${problem ?? "couldn't record"})`);
    } else run.sent++;
  }
  return run;
}
