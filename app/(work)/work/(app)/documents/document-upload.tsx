"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import { createClient } from "@/lib/db/browser";
import { DOC_GUIDE, documentPath, documentType, formatBytes, MAX_DOCUMENT_BYTES, type DocumentKind } from "../../_lib/documents";
import { recordDocument } from "./actions";

type Stage =
  | { name: "idle"; error?: string }
  | { name: "sending"; fileName: string; size: number }
  // The file is safely in the bucket but the row isn't written yet: retry only that step.
  | { name: "unsaved"; path: string; fileName: string; size: number; error: string }
  | { name: "sent"; fileName: string };

/**
 * One document: optional expiry date, then one tap to take a photo or choose a file.
 * Uploads go straight from the phone to the private bucket (never via our server), then
 * a Server Action records them. Bad signal is expected: every failure says what to do,
 * and a half-finished upload resumes from where it stopped.
 */
export function DocumentUpload({ kind, cleanerId, replacing }: { kind: DocumentKind; cleanerId: string; replacing: boolean }) {
  const router = useRouter();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [expiresOn, setExpiresOn] = useState("");
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const rule = DOC_GUIDE[kind].expiry;

  async function record(path: string, fileName: string, size: number) {
    let result: Awaited<ReturnType<typeof recordDocument>>;
    try {
      result = await recordDocument({ kind, path, expiresOn: rule === "none" ? null : expiresOn || null });
    } catch {
      result = { ok: false, error: "We got the file but couldn't save it. Check your signal and press Try again." };
    }
    if (result.ok) {
      setStage({ name: "sent", fileName });
      router.refresh();
    } else {
      setStage({ name: "unsaved", path, fileName, size, error: result.error });
    }
  }

  async function send(file: File) {
    if (rule === "required" && !expiresOn) {
      setStage({ name: "idle", error: "Add the date your cover ends first, then choose the file." });
      return;
    }
    const type = documentType(file);
    if (!type) {
      setStage({ name: "idle", error: "Ping takes photos (JPG, PNG, HEIC, WebP) and PDFs. Choose one of those." });
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setStage({ name: "idle", error: `That file is ${formatBytes(file.size)}. The limit is 10 MB: try a photo instead of a scan.` });
      return;
    }
    if (file.size === 0) {
      setStage({ name: "idle", error: "That file is empty. Choose it again." });
      return;
    }

    setStage({ name: "sending", fileName: file.name, size: file.size });
    const path = documentPath(cleanerId, kind, type, crypto.randomUUID());
    let uploaded = false;
    try {
      const { error } = await createClient().storage.from("cleaner-documents").upload(path, file, { contentType: type, upsert: false });
      uploaded = !error;
    } catch {
      uploaded = false;
    }
    if (!uploaded) {
      setStage({ name: "idle", error: "It didn't send. Your signal may have dropped. Choose the file again to retry." });
      return;
    }
    await record(path, file.name, file.size);
  }

  if (stage.name === "sent") {
    return (
      <p role="status" className="flex min-h-14 items-center gap-3 rounded-md bg-ok-soft px-4 font-semibold text-ok">
        <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden>
          <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Sent. We&rsquo;ll check it and let you know.
      </p>
    );
  }

  if (stage.name === "unsaved") {
    return (
      <div className="grid gap-3">
        <p role="alert" className="rounded-md bg-bad-soft px-4 py-3 font-medium text-bad">{stage.error}</p>
        <Button variant="ink" size="lg" className="w-full" onClick={() => { setStage({ name: "sending", fileName: stage.fileName, size: stage.size }); void record(stage.path, stage.fileName, stage.size); }}>
          Try again
        </Button>
      </div>
    );
  }

  const sending = stage.name === "sending";
  return (
    <div className="grid gap-4">
      {rule !== "none" ? (
        <div className="grid gap-2">
          <label htmlFor={`${id}-expiry`} className="text-sm font-semibold">
            {rule === "required" ? "Cover ends on" : "Expiry date, if it has one"}
          </label>
          <input
            id={`${id}-expiry`}
            type="date"
            value={expiresOn}
            disabled={sending}
            required={rule === "required"}
            onChange={(e) => setExpiresOn(e.target.value)}
            className="min-h-14 w-full rounded-md bg-card px-4 text-base text-ink ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-ink"
          />
        </div>
      ) : null}

      {stage.name === "idle" && stage.error ? (
        <p role="alert" className="rounded-md bg-bad-soft px-4 py-3 font-medium text-bad">{stage.error}</p>
      ) : null}

      <input
        ref={fileRef}
        id={`${id}-file`}
        type="file"
        accept="image/*,application/pdf,.heic,.heif"
        className="peer sr-only"
        disabled={sending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // choosing the same file again still fires a change
          if (file) void send(file);
        }}
      />
      <label
        htmlFor={`${id}-file`}
        aria-disabled={sending || undefined}
        className={buttonClass(replacing ? "secondary" : "primary", "lg", `w-full cursor-pointer peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-signal ${sending ? "pointer-events-none opacity-70" : ""}`)}
      >
        {sending ? <Spinner /> : (
          <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
            <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="12" cy="13" r="3.25" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        )}
        <span>{sending ? `Sending ${formatBytes(stage.size)}…` : replacing ? "Send a new copy" : "Take a photo or choose a file"}</span>
      </label>
    </div>
  );
}
