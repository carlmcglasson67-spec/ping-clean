"use client";

import { useActionState, useId } from "react";
import { Button, Field } from "@/components/ui";
import { saveDetails, type DetailsState } from "./actions";

export function DetailsForm({ initial }: { initial: { fullName: string; phone: string; bio: string } }) {
  const [state, action, pending] = useActionState<DetailsState, FormData>(saveDetails, { values: initial });
  const v = state.values ?? initial;
  const bioId = useId();

  return (
    <form action={action} className="grid gap-6" noValidate>
      {state.error ? (
        <p role="alert" className="rounded-md bg-bad-soft px-5 py-4 font-medium text-bad ring-1 ring-inset ring-bad/20">{state.error}</p>
      ) : null}

      <Field label="Full name" name="fullName" autoComplete="name" required defaultValue={v.fullName} error={state.fieldErrors?.fullName} hint="As it appears on your photo ID." />
      <Field
        label="Mobile number"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        defaultValue={v.phone}
        error={state.fieldErrors?.phone}
        hint="We call or text about your application and new jobs. Never shared with customers."
      />
      <div className="grid gap-2">
        <label htmlFor={bioId} className="text-sm font-semibold">A few lines about you <span className="font-normal text-navy-3">(optional)</span></label>
        <textarea
          id={bioId}
          name="bio"
          rows={4}
          maxLength={600}
          defaultValue={v.bio}
          aria-invalid={state.fieldErrors?.bio ? true : undefined}
          aria-describedby={`${bioId}-hint`}
          className="w-full rounded-md bg-card px-4 py-3.5 text-base text-navy ring-1 ring-inset ring-line placeholder:text-navy-3 focus:outline-none focus:ring-2 focus:ring-navy"
          placeholder="How long you've been cleaning, what you take pride in."
        />
        <p id={`${bioId}-hint`} className={state.fieldErrors?.bio ? "text-sm font-medium text-bad" : "text-sm text-navy-3"}>
          {state.fieldErrors?.bio ?? "The Ping team reads this when checking your application."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" pending={pending} className="w-full sm:w-auto">
          {pending ? "Saving…" : "Save my details"}
        </Button>
        {state.saved && !pending ? (
          <p role="status" className="font-semibold text-ok">Saved.</p>
        ) : null}
      </div>
    </form>
  );
}
