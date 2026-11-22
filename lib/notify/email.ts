import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { resolveSiteUrl } from "@/lib/env";
import { formatDay } from "@/lib/dates";
import { formatPence } from "@/lib/money";

// Emails to customers about a payment (payments PR 8), and to the cleaner when their block
// goes on hold, comes back on or ends on hold (#44), sent through Resend's HTTP API.
// The database queues them (private.customer_notices), once each; this file words and sends
// them. Off until RESEND_API_KEY and PING_EMAIL_FROM are set: notices then simply wait.
// Logs carry the notice id and kind only, never the address or the wording.

export type NoticeKind =
  | "payment_failed"
  | "payment_needs_confirming"
  | "block_on_hold"
  | "block_ended_unpaid"
  | "cleaner_block_on_hold"
  | "cleaner_block_back_on"
  | "cleaner_block_ended";

/** The cleaner's emails: about their block, never the customer's payment. */
export const isCleanerNotice = (kind: NoticeKind) => kind.startsWith("cleaner_");

const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

type Env = Record<string, string | undefined>;

/** Where emails are sent from, or null when email isn't set up (or is set up wrongly). */
export function emailConfig(env: Env = process.env): { key: string; from: string } | null {
  const key = env.RESEND_API_KEY;
  const from = env.PING_EMAIL_FROM;
  if (!key || !/^re_[A-Za-z0-9_]{10,200}$/.test(key)) return null;
  if (!from || !/^[^<>\r\n]{0,60}<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from)) return null;
  return { key, from };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type NoticeFacts = {
  firstName: string | null;
  amountPence: number | null;
  cleanDate: string | null;
  link: string;
  lateCancelFee?: boolean;
  /** The cleaner's emails: the block's town and day of the week (ISO, Monday = 1). */
  town?: string | null;
  weekday?: number | null;
};

/** The wording of each email. Plain, short, and never a promise Ping can't keep. */
export function noticeEmail(kind: NoticeKind, f: NoticeFacts): { subject: string; text: string; html: string } {
  const hello = f.firstName ? `Hello ${f.firstName},` : "Hello,";
  const what = f.lateCancelFee ? "the late-cancellation fee for your clean" : "your clean";
  const clean = f.cleanDate ? `${what} on ${formatDay(f.cleanDate)}` : what;
  const amount = f.amountPence != null ? ` (${formatPence(f.amountPence)})` : "";
  // The cleaner's block, by its town and day only. Never the reason: the cleaner must not
  // learn the customer's card failed.
  const day = f.weekday && f.weekday >= 1 && f.weekday <= 7 ? WEEKDAYS[f.weekday - 1] : null;
  const block = `your regular clean${f.town ? ` in ${f.town}` : ""}${day ? ` on ${day}` : ""}`;
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
    case "cleaner_block_on_hold":
      subject = "One of your regular cleans is on hold";
      lines = [
        `${cap(block)} is on hold for now, so please don't go until we tell you it's back on.`,
        "There's nothing you need to do. We'll email you as soon as it's back on, and your app always shows where it stands.",
      ];
      action = "Open your jobs";
      break;
    case "cleaner_block_back_on":
      subject = "Your regular clean is back on";
      lines = [`Good news: ${block} is back on.`, "Your next clean is in your app as usual."];
      action = "Open your jobs";
      break;
    case "cleaner_block_ended":
      subject = "One of your regular cleans has ended";
      lines = [`${cap(block)} has ended, so there are no more cleans to go to on it.`, "There's nothing you need to do. Thank you for the cleans you did."];
      action = "Open your jobs";
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
      const cleaner = isCleanerNotice(n.kind);
      const link = cleaner ? `${site}/work` : n.payment_id && n.kind !== "block_ended_unpaid" ? `${site}/account/pay/${n.payment_id}` : `${site}/account`;
      // A late-cancellation fee is worded as one: there was no clean to pay for.
      const kind = n.payment_id && !cleaner ? (await db.from("payments").select("kind").eq("id", n.payment_id).maybeSingle()).data?.kind : null;
      const firstName = n.full_name?.trim().split(/\s+/)[0] || null;
      const mail = cleaner
        ? noticeEmail(n.kind, { firstName, amountPence: null, cleanDate: null, link, town: n.town, weekday: n.weekday })
        : noticeEmail(n.kind, { firstName, amountPence: n.amount_pence, cleanDate: n.clean_date, link, lateCancelFee: kind === "late_cancel" });
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
