"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";

/** Ping's own colours, read from the page's tokens, so Stripe's card fields match the app. */
function token(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Stripe's own card fields, inside Ping's page. The card number never touches Ping: Stripe
 * collects it and hands back a saved card. `onSaved` gets the SetupIntent's id, which the
 * server then checks with Stripe itself before believing it.
 */
export function CardForm({
  clientSecret,
  publishableKey,
  onSaved,
  onCancel,
}: {
  clientSecret: string;
  publishableKey: string;
  onSaved: (setupIntentId: string) => Promise<boolean>;
  onCancel?: () => void; // omit where there is no card to fall back to (first card at booking)
}) {
  const stripe = useMemo<Promise<Stripe | null>>(() => loadStripe(publishableKey), [publishableKey]);
  const appearance = useMemo(
    () => ({
      theme: "stripe" as const,
      variables: {
        colorPrimary: token("--color-blue", "blue"),
        colorText: token("--color-navy", "black"),
        colorDanger: token("--color-bad", "red"),
        fontFamily: "Figtree, system-ui, sans-serif",
        fontSizeBase: "17px",
        borderRadius: "14px",
        spacingUnit: "5px",
      },
    }),
    [],
  );
  return (
    <Elements stripe={stripe} options={{ clientSecret, appearance }}>
      <Fields onSaved={onSaved} onCancel={onCancel} />
    </Elements>
  );
}

function Fields({ onSaved, onCancel }: { onSaved: (id: string) => Promise<boolean>; onCancel?: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);
    const { error: failed, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: window.location.href },
    });
    if (failed || !setupIntent) {
      // Stripe's own words for a card or typing problem; ours for anything else.
      const theirs = failed && (failed.type === "card_error" || failed.type === "validation_error") ? failed.message : null;
      setError(theirs ?? "We couldn't save that card. Check the details and try again.");
      setBusy(false);
      return;
    }
    const ok = await onSaved(setupIntent.id);
    if (!ok) {
      setError("Your bank accepted the card, but we couldn't save it just now. Try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-6">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? (
        <p role="alert" className="rounded-md bg-bad-soft px-4 py-3 font-semibold text-bad">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" pending={busy} disabled={!stripe}>
          Save this card
        </Button>
        {onCancel ? (
          <Button type="button" size="lg" variant="ghost" onClick={onCancel} disabled={busy}>
            Keep my current card
          </Button>
        ) : null}
      </div>
      <p className="text-base text-navy-3">Your card details go straight to Stripe, our payment provider. Ping never sees or stores the number.</p>
    </form>
  );
}
