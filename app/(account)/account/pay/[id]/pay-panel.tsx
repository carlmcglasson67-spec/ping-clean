"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { checkPaymentAction, confirmCardChangeAction, payNowAction, startCardChangeAction, type PayView } from "./actions";

// Stripe's card fields are only fetched when someone asks to change their card.
const CardForm = dynamic(() => import("./card-form").then((m) => m.CardForm), {
  ssr: false,
  loading: () => (
    <p className="flex items-center gap-3 text-navy-2">
      <Spinner /> Opening the card form…
    </p>
  ),
});

type Step =
  | { at: "ready" }
  | { at: "paying" }
  | { at: "bank" } // the customer's bank is asking them to confirm
  | { at: "card"; clientSecret: string; publishableKey: string };

const TROUBLE = "We couldn’t take the payment just now, and nothing has been charged. Try again in a minute.";

/**
 * Pay now, with the saved card or a different one. Everything that matters happens on the
 * server: this only shows where things are up to and opens the bank's own confirmation step.
 */
export function PayPanel({
  paymentId,
  amount,
  card,
  needsBank,
}: {
  paymentId: string;
  amount: string;
  card: { brand: string; last4: string } | null;
  needsBank: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ at: "ready" });
  const [note, setNote] = useState<{ tone: "bad" | "ok"; text: string } | null>(null);
  const [opening, setOpening] = useState(false);

  async function show(r: PayView): Promise<void> {
    if (r.state === "paid" || r.state === "in_progress") {
      router.refresh(); // the page itself says "Paid" or "being taken"
      return;
    }
    if (r.state === "needs_bank" && r.publishableKey) {
      setStep({ at: "bank" });
      try {
        const { loadStripe } = await import("@stripe/stripe-js");
        const stripe = await loadStripe(r.publishableKey);
        if (!stripe) throw new Error("stripe didn't load");
        await stripe.handleNextAction({ clientSecret: r.clientSecret });
      } catch {
        // Whatever happened in the bank's window, the server asks Stripe how it ended.
      }
      const after = await checkPaymentAction(paymentId);
      if (after.state === "needs_bank") {
        setNote({ tone: "bad", text: "Your bank still needs you to confirm. Press the button to try again." });
        setStep({ at: "ready" });
        return;
      }
      return show(after);
    }
    setStep({ at: "ready" });
    if (r.state === "declined") setNote({ tone: "bad", text: `${r.reason} Nothing has been charged. You can try again, or use a different card.` });
    else if (r.state === "no_card") setNote({ tone: "bad", text: "There’s no card saved on your account. Add one below, then pay." });
    else setNote({ tone: "bad", text: TROUBLE });
  }

  async function pay() {
    setNote(null);
    setStep({ at: "paying" });
    try {
      await show(await payNowAction(paymentId));
    } catch {
      setStep({ at: "ready" });
      setNote({ tone: "bad", text: TROUBLE });
    }
  }

  async function changeCard() {
    setNote(null);
    setOpening(true);
    const r = await startCardChangeAction(paymentId).catch(() => ({ ok: false }) as const);
    setOpening(false);
    if (r.ok) setStep({ at: "card", clientSecret: r.clientSecret, publishableKey: r.publishableKey });
    else setNote({ tone: "bad", text: "We couldn’t open the card form just now. Try again in a minute." });
  }

  async function cardSaved(setupIntentId: string) {
    const r = await confirmCardChangeAction(paymentId, setupIntentId);
    if (!r.ok) return false;
    setStep({ at: "ready" });
    setNote({ tone: "ok", text: "New card saved. Press pay to use it." });
    router.refresh();
    return true;
  }

  if (step.at === "card") {
    return (
      <div className="grid gap-6">
        <h2 className="text-2xl font-semibold">Use a different card</h2>
        <CardForm clientSecret={step.clientSecret} publishableKey={step.publishableKey} onSaved={cardSaved} onCancel={() => setStep({ at: "ready" })} />
      </div>
    );
  }

  const busy = step.at !== "ready";
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line pb-5">
        <p className="text-lg text-navy-2">Paying with</p>
        <p className="text-lg font-semibold">{card ? <>{brandName(card.brand)} ending {card.last4}</> : "No card saved yet"}</p>
      </div>
      {note ? (
        <p role={note.tone === "bad" ? "alert" : "status"} className={note.tone === "bad" ? "rounded-md bg-bad-soft px-5 py-4 text-lg font-semibold text-bad" : "rounded-md bg-ok-soft px-5 py-4 text-lg font-semibold text-ok"}>
          {note.text}
        </p>
      ) : null}
      {step.at === "bank" ? (
        <p role="status" className="flex items-center gap-3 rounded-md bg-mist px-5 py-4 text-lg text-navy-2">
          <Spinner /> Your bank is asking you to confirm. Follow its steps, then come back here.
        </p>
      ) : null}
      <div className="grid gap-3 sm:flex sm:flex-wrap">
        {card ? (
          <Button size="xl" onClick={pay} pending={step.at === "paying"} disabled={busy || opening} className="w-full sm:w-auto">
            {needsBank ? `Confirm and pay ${amount}` : `Pay ${amount} now`}
          </Button>
        ) : null}
        <Button size={card ? "lg" : "xl"} variant={card ? "secondary" : "primary"} onClick={changeCard} pending={opening} disabled={busy} className="w-full sm:w-auto sm:self-center">
          {card ? "Use a different card" : "Add a card"}
        </Button>
      </div>
    </div>
  );
}

function brandName(brand: string) {
  const names: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", maestro: "Maestro" };
  return names[brand] ?? "Card";
}
