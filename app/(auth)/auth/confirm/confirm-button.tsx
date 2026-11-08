"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";

export function ConfirmButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" pending={pending} className="w-full">
      {pending ? "One moment…" : label}
    </Button>
  );
}
