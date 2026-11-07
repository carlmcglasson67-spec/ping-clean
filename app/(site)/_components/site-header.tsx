"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ButtonLink, PingMark, Wordmark, cn } from "@/components/ui";
import { AREAS_LINK, AREA_LINKS, CLEANERS_LINK, CLEANING_LINKS, FAQ_LINK } from "../_content/nav";

type Menu = "cleaning" | "areas" | null;

/**
 * Site header with a full-width mega-menu on desktop and a full-screen sheet on phones.
 * Opens on click or hover (with a short grace period so it never flickers), closes on
 * Escape, outside click and navigation. Keyboard: Tab through, Escape returns focus.
 */
export function SiteHeader() {
  const [open, setOpen] = useState<Menu>(null);
  const [sheet, setSheet] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ids = { cleaning: useId(), areas: useId(), sheet: useId() };

  const close = useCallback(() => setOpen(null), []);

  // Navigation closes everything. Tracking the last path during render is React’s
  // recommended way to reset state on a prop change without an effect.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(null);
    setSheet(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen((m) => {
        if (m) document.getElementById(`trigger-${m}`)?.focus();
        return null;
      });
      setSheet(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = sheet ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [sheet]);

  const hoverOpen = (m: Exclude<Menu, null>) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(m);
  };
  const hoverClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(close, 180);
  };

  return (
    <header
      ref={headerRef}
      className={cn(
        "sticky top-0 z-40 transition-[background-color,box-shadow] duration-300",
        // No backdrop-filter while the phone sheet is open: it would become the sheet’s
        // containing block and pin the "fixed" sheet inside the 80px header.
        sheet ? "bg-paper" : scrolled || open ? "bg-paper/95 shadow-[0_1px_0_var(--color-line)] backdrop-blur" : "bg-paper",
      )}
      onPointerLeave={(e) => e.pointerType === "mouse" && hoverClose()}
    >
      <div className="mx-auto flex h-20 max-w-[96rem] items-center gap-4 px-5 sm:px-10 lg:h-24 lg:px-16">
        <Wordmark />

        <nav aria-label="Main" className="ml-10 hidden items-center gap-1 lg:flex">
          <Trigger id="cleaning" label="Regular cleaning" open={open} setOpen={setOpen} onHover={hoverOpen} controls={ids.cleaning} />
          <Trigger id="areas" label="Areas" open={open} setOpen={setOpen} onHover={hoverOpen} controls={ids.areas} />
          <Link
            href={CLEANERS_LINK.href}
            className="inline-flex min-h-12 items-center rounded-full px-4 text-[1.0625rem] font-semibold text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            {CLEANERS_LINK.label}
          </Link>
          <Link
            href={FAQ_LINK.href}
            className="inline-flex min-h-12 items-center rounded-full px-4 text-[1.0625rem] font-semibold text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            {FAQ_LINK.label}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link href="/login" className="hidden min-h-12 items-center rounded-full px-4 text-[1.0625rem] font-semibold text-ink hover:bg-paper-2 sm:inline-flex">
            Sign in
          </Link>
          {/* Wrapped: ButtonLink’s own inline-flex would beat a "hidden" on the link itself. */}
          <span className="hidden sm:contents">
            <ButtonLink href="/#how">How it works</ButtonLink>
          </span>
          <button
            type="button"
            className="inline-flex min-h-12 items-center gap-3 rounded-full bg-ink pl-5 pr-4 text-base font-semibold text-paper lg:hidden"
            aria-expanded={sheet}
            aria-controls={ids.sheet}
            onClick={() => setSheet((s) => !s)}
          >
            {sheet ? "Close" : "Menu"}
            <span aria-hidden className="grid gap-[5px]">
              <span className={cn("block h-[2px] w-5 rounded bg-current transition-transform duration-300", sheet && "translate-y-[3.5px] rotate-45")} />
              <span className={cn("block h-[2px] w-5 rounded bg-current transition-transform duration-300", sheet && "-translate-y-[3.5px] -rotate-45")} />
            </span>
          </button>
        </div>
      </div>

      {/* Desktop mega-menu panels */}
      <div
        id={ids.cleaning}
        hidden={open !== "cleaning"}
        onPointerEnter={(e) => e.pointerType === "mouse" && hoverOpen("cleaning")}
        className="absolute inset-x-0 top-full hidden border-t border-line bg-paper shadow-lift lg:block [&[hidden]]:hidden"
      >
        <div className="mx-auto grid max-w-[96rem] grid-cols-12 gap-8 px-16 py-12">
          <div className="grain relative col-span-4 flex flex-col justify-between overflow-hidden rounded-lg bg-ink p-9 text-paper">
            <PingMark pulse className="text-paper" />
            <div className="mt-16">
              <p className="font-display text-2xl font-semibold leading-tight">The same cleaner. Every visit. Proof every time.</p>
              <p className="mt-4 text-paper/70">One fixed hourly rate, a checklist on every clean, and your card charged only once it&rsquo;s done.</p>
            </div>
          </div>
          <ul className="col-span-8 grid grid-cols-2 gap-x-10 gap-y-2 self-center">
            {CLEANING_LINKS.map((l, i) => (
              <li key={l.label}>
                <Link href={l.href} onClick={close} className="group grid grid-cols-[3rem_1fr] gap-x-2 rounded-md p-5 transition-colors hover:bg-card">
                  <span className="font-display text-lg font-semibold text-signal-ink tabular">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-display text-xl font-semibold group-hover:text-signal-ink">{l.label}</span>
                  <span className="col-start-2 mt-1 text-base text-ink-2">{l.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div
        id={ids.areas}
        hidden={open !== "areas"}
        onPointerEnter={(e) => e.pointerType === "mouse" && hoverOpen("areas")}
        className="absolute inset-x-0 top-full hidden border-t border-line bg-paper shadow-lift lg:block [&[hidden]]:hidden"
      >
        <div className="mx-auto grid max-w-[96rem] grid-cols-12 gap-8 px-16 py-12">
          <div className="col-span-4 grid content-between gap-8 rounded-lg bg-mist p-9">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-ink-2">Where Ping cleans</p>
            <div>
              <p className="font-display text-2xl font-semibold leading-tight">West Cumbria, from the Solway to Seascale.</p>
              <p className="mt-4 text-ink-2">Ten towns and the villages around them. Pick yours to see what a regular clean looks like there.</p>
              <Link href={AREAS_LINK.href} onClick={close} className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-full bg-ink px-5 text-base font-semibold text-paper hover:bg-[#1d2732]">
                {AREAS_LINK.label} <span aria-hidden>&rarr;</span>
              </Link>
            </div>
          </div>
          <ul className="col-span-8 grid grid-cols-3 content-center gap-x-6 gap-y-1">
            {AREA_LINKS.map((l) => (
              <li key={l.label}>
                <Link href={l.href} onClick={close} className="group flex min-h-14 items-baseline justify-between gap-4 rounded-md px-5 py-3 transition-colors hover:bg-card">
                  <span className="font-display text-xl font-semibold group-hover:text-signal-ink">{l.label}</span>
                  <span className="text-sm font-semibold text-ink-3 tabular">{l.districts.join(" ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Phone sheet */}
      <div
        id={ids.sheet}
        hidden={!sheet}
        className="fixed inset-x-0 bottom-0 top-20 overflow-y-auto overscroll-contain bg-paper px-5 pb-10 pt-4 sm:px-10 lg:hidden [&[hidden]]:hidden"
      >
        <nav aria-label="Main" className="grid gap-10">
          <SheetGroup title="Regular cleaning">
            {CLEANING_LINKS.map((l) => (
              <SheetLink key={l.label} href={l.href} onClick={() => setSheet(false)}>
                {l.label}
              </SheetLink>
            ))}
          </SheetGroup>
          <SheetGroup title="Areas">
            <div className="grid grid-cols-2 gap-x-4">
              {AREA_LINKS.map((l) => (
                <Link key={l.label} href={l.href} onClick={() => setSheet(false)} className="flex min-h-12 items-center text-lg font-semibold">
                  {l.label}
                </Link>
              ))}
            </div>
          </SheetGroup>
          <SheetGroup title="Ping">
            <SheetLink href={CLEANERS_LINK.href} onClick={() => setSheet(false)}>
              {CLEANERS_LINK.label}
            </SheetLink>
            <SheetLink href={FAQ_LINK.href} onClick={() => setSheet(false)}>
              Questions
            </SheetLink>
            <SheetLink href="/login" onClick={() => setSheet(false)}>
              Sign in
            </SheetLink>
          </SheetGroup>
        </nav>
      </div>
    </header>
  );
}

function Trigger({
  id,
  label,
  open,
  setOpen,
  onHover,
  controls,
}: {
  id: Exclude<Menu, null>;
  label: string;
  open: Menu;
  setOpen: (m: Menu) => void;
  onHover: (m: Exclude<Menu, null>) => void;
  controls: string;
}) {
  const isOpen = open === id;
  return (
    <button
      id={`trigger-${id}`}
      type="button"
      aria-expanded={isOpen}
      aria-controls={controls}
      onClick={() => setOpen(isOpen ? null : id)}
      onPointerEnter={(e) => e.pointerType === "mouse" && onHover(id)}
      className={cn(
        "inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-[1.0625rem] font-semibold transition-colors",
        isOpen ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
      )}
    >
      {label}
      <svg aria-hidden viewBox="0 0 12 12" className={cn("size-3 transition-transform duration-300", isOpen && "rotate-180")}>
        <path d="M2 4.5 6 8l4-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function SheetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 border-t border-line pt-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-ink-3">{title}</h2>
      {children}
    </section>
  );
}

function SheetLink({ href, onClick, children }: { href: ComponentProps<typeof Link>["href"]; onClick: () => void; children: ReactNode }) {
  return (
    <Link href={href} onClick={onClick} className="flex min-h-14 items-center font-display text-2xl font-semibold">
      {children}
    </Link>
  );
}
