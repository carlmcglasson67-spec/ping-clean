"use client";

import { useEffect, useRef } from "react";
import { cn } from "./cn";

type TurnstileApi = {
  render: (el: HTMLElement, opts: { sitekey: string; theme?: string }) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const api = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

/**
 * Cloudflare Turnstile, rendered explicitly so it also works when the form appears after
 * the page has loaded. It adds its own hidden "cf-turnstile-response" field to the form.
 *
 * A token works once. Pass `resetOn` (the form's latest result): each time it changes the
 * widget gets a fresh token, so a second try after an error isn't refused for reusing one.
 */
export function Turnstile({
  siteKey,
  error,
  theme = "dark",
  resetOn,
}: {
  siteKey: string;
  error?: string;
  theme?: "dark" | "light";
  resetOn?: unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (!document.querySelector(`script[src="${SRC}"]`)) {
      const s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
    const timer = window.setInterval(() => {
      const t = api();
      if (t && ref.current && widget.current === null) {
        widget.current = t.render(ref.current, { sitekey: siteKey, theme });
        window.clearInterval(timer);
      }
    }, 150);
    return () => {
      window.clearInterval(timer);
      const t = api();
      if (t && widget.current) t.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, theme]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = api();
    if (t && widget.current) t.reset(widget.current);
  }, [resetOn]);

  return (
    <div className="grid gap-2">
      <div ref={ref} className="min-h-[65px]" />
      {error ? (
        <p role="alert" className={cn("text-base font-medium", theme === "dark" ? "text-bad-on-navy" : "text-bad")}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
