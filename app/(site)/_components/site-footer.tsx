import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { LogoMark, Wordmark } from "@/components/ui";
import { AREAS_LINK, AREA_LINKS, CLEANERS_LINK, CLEANING_LINKS } from "../_content/nav";

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden signal-waves text-on-navy">
      <div className="mx-auto max-w-[96rem] px-5 pb-10 pt-20 sm:px-10 lg:px-16 lg:pt-28">
        <div className="grid gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Wordmark tone="paper" className="text-[2.25rem]" />
            <p className="mt-8 max-w-md font-display text-2xl font-semibold leading-tight">
              A cleaner home is just <span className="text-brand-gradient-navy">a Ping away.</span>
            </p>
            <p className="mt-4 max-w-md text-lg text-on-navy-2">Regular home cleaning for West Cumbria. Same cleaner, proper checklist, pay after.</p>
          </div>

          <FooterCol title="Regular cleaning" className="lg:col-span-2">
            {CLEANING_LINKS.map((l) => (
              <FooterLink key={l.label} href={l.href}>
                {l.label}
              </FooterLink>
            ))}
          </FooterCol>

          <FooterCol title="Areas" className="lg:col-span-3" more={<FooterLink href={AREAS_LINK.href}>{AREAS_LINK.label} &rarr;</FooterLink>}>
            <div className="grid grid-cols-2 gap-x-6">
              {AREA_LINKS.map((l) => (
                <FooterLink key={l.label} href={l.href}>
                  {l.label}
                </FooterLink>
              ))}
            </div>
          </FooterCol>

          <FooterCol title="Ping" className="lg:col-span-2">
            <FooterLink href={CLEANERS_LINK.href}>{CLEANERS_LINK.label}</FooterLink>
            <FooterLink href="/login">Sign in</FooterLink>
          </FooterCol>
        </div>

        <div className="mt-20 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-line-navy pt-8 text-base text-on-navy-3">
          <LogoMark className="size-7" />
          <span>&copy; {new Date().getFullYear()} Ping Clean.</span>
          <span>Cleaners on Ping are vetted, insured and self-employed.</span>
        </div>
      </div>
      <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -right-56 -top-56 size-[42rem] text-on-navy/[0.05]">
        {[90, 170, 250].map((r) => (
          <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
        ))}
      </svg>
    </footer>
  );
}

function FooterCol({ title, className, children, more }: { title: string; className?: string; children: ReactNode; more?: ReactNode }) {
  return (
    <nav aria-label={title} className={className}>
      <h2 className="mb-4 whitespace-nowrap text-sm font-semibold uppercase tracking-[0.16em] text-teal">{title}</h2>
      <div className="grid">{children}</div>
      {more}
    </nav>
  );
}

function FooterLink({ href, children }: { href: ComponentProps<typeof Link>["href"]; children: ReactNode }) {
  return (
    <Link href={href} className="flex min-h-12 items-center text-lg text-on-navy-2 transition-colors hover:text-teal">
      {children}
    </Link>
  );
}
