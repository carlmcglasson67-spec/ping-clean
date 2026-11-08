import type { ReactNode } from "react";
import { LogoMark, Wordmark } from "@/components/ui";

/**
 * The two-panel frame every account screen shares (sign in, sign up, reset): a navy
 * statement panel with the signal waves on the left, the form on the right. On phones the
 * statement panel folds away so the form is on the first screen.
 */
export function AuthFrame({
  eyebrow,
  statement,
  lede,
  children,
}: {
  eyebrow: string;
  statement: ReactNode;
  lede: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="signal-waves relative hidden overflow-hidden p-12 text-on-navy lg:flex lg:flex-col xl:p-16">
        <Wordmark tone="paper" className="text-[1.8rem]" />
        <LogoMark
          colour="white"
          className="pointer-events-none absolute -right-24 top-24 size-[30rem] opacity-[0.06]"
        />
        <div className="relative mt-auto max-w-[36rem] pb-28 pt-24">
          <p className="mb-6 flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.16em] text-teal">
            <span aria-hidden className="h-px w-8 bg-teal" />
            {eyebrow}
          </p>
          <h1 className="text-[clamp(3rem,1rem+4vw,5.75rem)] font-semibold leading-[0.96]">{statement}</h1>
          <p className="mt-8 max-w-md text-lg text-on-navy-2">{lede}</p>
        </div>
      </section>

      <section className="flex flex-col px-6 pb-10 pt-8 sm:px-12 lg:px-16 xl:px-24">
        <div className="lg:hidden">
          <Wordmark />
        </div>
        <div className="my-auto w-full max-w-[30rem] py-12">{children}</div>
      </section>
    </div>
  );
}

/** Heading block above each form. */
export function FormIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-10 grid gap-4">
      <LogoMark className="size-11" />
      <h2 className="text-2xl font-semibold">{title}</h2>
      {children ? <div className="text-navy-2">{children}</div> : null}
    </div>
  );
}

/** A notice above a form: problems in red, good news in teal. */
export function Notice({ tone = "bad", children }: { tone?: "bad" | "ok"; children: ReactNode }) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={
        tone === "bad"
          ? "rounded-md bg-bad-soft px-5 py-4 text-base font-medium text-bad ring-1 ring-inset ring-bad/20"
          : "rounded-md bg-teal-soft px-5 py-4 text-base font-medium text-teal-ink ring-1 ring-inset ring-teal-deep/30"
      }
    >
      {children}
    </div>
  );
}
