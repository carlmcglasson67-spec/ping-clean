"use client";

import { useId, useState } from "react";
import { passwordChecks } from "@/lib/auth/password";
import { cn } from "./cn";

/**
 * Password input with a show/hide toggle and, for new passwords, the rules ticking off
 * as you type. The rules are the same ones the server checks (lib/auth/password.ts).
 */
export function PasswordField({
  label = "Password",
  name = "password",
  autoComplete = "current-password",
  rules = false,
  email = "",
  error,
  hint,
}: {
  label?: string;
  name?: string;
  autoComplete?: "current-password" | "new-password";
  /** Show the live checklist (new passwords). */
  rules?: boolean;
  /** Used by the "not your email" rule. */
  email?: string;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const checks = rules ? passwordChecks(value, email) : [];
  const rulesId = `${id}-rules`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [rules ? rulesId : null, hint && !error ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-navy">
        {label}
      </label>
      <div
        className={cn(
          "flex min-h-14 items-stretch rounded-md bg-card ring-1 ring-inset ring-line transition-shadow duration-200 focus-within:ring-2 focus-within:ring-blue",
          error && "ring-2 ring-bad focus-within:ring-bad",
        )}
      >
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="min-w-0 flex-1 rounded-l-md bg-transparent px-4 text-base text-navy placeholder:text-navy-3 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-controls={id}
          className="m-1 min-h-12 min-w-16 rounded-[0.6rem] px-3 text-sm font-semibold text-blue hover:bg-mist focus-visible:outline-offset-0"
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {rules ? (
        <ul id={rulesId} aria-label="Password rules" className="grid gap-1.5 pt-1 text-sm">
          {checks.map((c) => (
            <li key={c.id} className={cn("flex items-center gap-2.5", c.ok ? "text-ok" : "text-navy-3")}>
              <span
                aria-hidden
                className={cn(
                  "grid size-5 place-items-center rounded-full text-[0.7rem] font-bold transition-colors",
                  c.ok ? "bg-ok text-white" : "ring-1 ring-inset ring-line",
                )}
              >
                {c.ok ? "✓" : ""}
              </span>
              <span>
                {c.label}
                <span className="sr-only">{c.ok ? ": done" : ": not yet"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {hint && !error ? (
        <p id={hintId} className="text-sm text-navy-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
