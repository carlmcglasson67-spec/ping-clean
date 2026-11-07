import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";

/** A big, thumb-sized checkbox with its label as part of the target, and an error line. */
export function Checkbox({
  children,
  error,
  className,
  ...input
}: Omit<ComponentProps<"input">, "type" | "id" | "children"> & { children: ReactNode; error?: string }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label
        htmlFor={id}
        className={cn(
          "flex min-h-12 cursor-pointer items-start gap-3.5 rounded-md bg-card px-4 py-3.5 ring-1 ring-inset ring-line transition-shadow hover:ring-navy-3 has-[:checked]:ring-2 has-[:checked]:ring-blue has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue",
          error && "ring-2 ring-bad",
        )}
      >
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...input}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--color-blue)]"
        />
        <span className="text-base text-navy-2">{children}</span>
      </label>
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
