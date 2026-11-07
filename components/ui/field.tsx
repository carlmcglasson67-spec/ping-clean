import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";

type FieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  hint?: ReactNode;
  error?: string;
};

/** Labelled input with hint and error wired up for screen readers. 56px tall. */
export function Field({ label, hint, error, className, ...input }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("grid gap-2", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-navy">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...input}
        className={cn(
          "min-h-14 w-full rounded-md bg-card px-4 text-base text-navy placeholder:text-navy-3",
          "ring-1 ring-inset ring-line transition-shadow duration-200",
          "focus:outline-none focus:ring-2 focus:ring-blue",
          error && "ring-2 ring-bad focus:ring-bad",
        )}
      />
      {hint && !error ? (
        <p id={hintId} className="text-sm text-navy-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
