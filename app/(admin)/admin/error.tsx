"use client";

import { AppError } from "@/components/ui/app-states";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <AppError reset={reset} />;
}
