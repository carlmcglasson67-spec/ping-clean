"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { confirmCardSetup, startCardSetup } from "@/lib/stripe/actions";

// Stripe's card fields are only fetched when the customer opens the form.
const CardForm = dynamic(() => import("../../_components/card-form").then((m) => m.CardForm), {
  ssr: false,
  loading: () => (
    <p className="flex items-center gap-3 text-navy-2">
      <Spinner /> Opening the card form…
    </p>
  ),
});

/** The last step of booking: save the card each clean will be charged to. Nothing is taken. */
export function SaveCard({ seriesId }: { seriesId: string }) {
  const router = useRouter();
  const [form, setForm] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    setOpening(true);
    const r = await startCardSetup(seriesId).catch(() => ({ ok: false, error: "We couldn’t open the card form just now. Please try again." }) as const);
    setOpening(false);
    if (r.ok) setForm({ clientSecret: r.clientSecret, publishableKey: r.publishableKey });
    else setError(r.error);
  }

  async function saved(setupIntentId: string) {
    const r = await confirmCardSetup(setupIntentId);
    if (r.ok) router.refresh(); // the page now says "Card saved"
    return r.ok;
  }

  if (form) return <CardForm clientSecret={form.clientSecret} publishableKey={form.publishableKey} onSaved={saved} />;
  return (
    <div className="grid gap-4">
      {error ? (
        <p role="alert" className="rounded-md bg-bad-soft px-5 py-4 text-lg font-semibold text-bad">
          {error}
        </p>
      ) : null}
      <Button size="xl" onClick={open} pending={opening} className="w-full sm:w-auto sm:justify-self-start">
        Add your card
      </Button>
    </div>
  );
}
