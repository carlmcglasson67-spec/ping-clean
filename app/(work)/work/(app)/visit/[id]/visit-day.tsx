"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge, Button, Spinner } from "@/components/ui";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { createClient } from "@/lib/db/browser";
import { pingErrorMessage } from "@/lib/db/errors";
import { isRealReason, photoPath, REASON_MAX } from "../../../_lib/visit";
import { completeVisit, recordPhoto, saveItem, type VisitResult } from "./actions";
import { preparePhoto } from "./photos";

export type Item = { id: string; room: string; label: string; done: boolean; reason: string | null };
export type ExistingPhoto = { id: string; kind: "before" | "after"; url: string | null };
type State = { done: boolean; reason: string | null };

type QueuedPhoto = {
  localId: string;
  kind: "before" | "after";
  preview: string;
  blob: Blob;
  type: string;
  path: string;
  takenAt: string;
  uploaded: boolean;
  status: "waiting" | "sending" | "sent";
};

const RETRY_MS = 4000;
/** Ticks waiting to send survive a reload or the phone killing the page. Ticks only: no address, no photos. */
const storeKey = (visitId: string) => `ping-ticks-${visitId}`;

function readStore(visitId: string): Record<string, State> {
  try {
    const raw = window.localStorage.getItem(storeKey(visitId));
    return raw ? (JSON.parse(raw) as Record<string, State>) : {};
  } catch {
    return {};
  }
}
function writeStore(visitId: string, pending: Record<string, State>) {
  try {
    if (Object.keys(pending).length) window.localStorage.setItem(storeKey(visitId), JSON.stringify(pending));
    else window.localStorage.removeItem(storeKey(visitId));
  } catch {
    // private mode or full: the in-memory queue still sends them
  }
}

/**
 * The visit day, once a clean is in progress: checklist, before and after photos, complete.
 * Built for one thumb and bad signal. Every tick shows at once and is queued; the queue
 * keeps sending until the database has it, and is kept on the phone across a reload.
 * Photos are shrunk, queued and sent in the background. Complete waits for both queues,
 * then asks the database, which has the last word.
 */
export function VisitDay({ visitId, items: initial, photos: existing }: { visitId: string; items: Item[]; photos: ExistingPhoto[] }) {
  const router = useRouter();
  const [completing, setCompleting] = useState(false);
  // Cleared as soon as they act on it, so an old "add a photo" never sits under a new one.
  const [completeError, setCompleteError] = useState<string | null>(null);

  // ---------------------------------------------------------------- checklist queue
  const [items, setItems] = useState<Record<string, State>>(() =>
    Object.fromEntries(initial.map((i) => [i.id, { done: i.done, reason: i.reason }])),
  );
  const pending = useRef<Record<string, State>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const flushing = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped to ask for another pass (a retry after no signal, or ticks added mid-send).
  const [tickNudge, setTickNudge] = useState(0);

  const syncCount = useCallback(() => {
    setPendingCount(Object.keys(pending.current).length);
    writeStore(visitId, pending.current);
  }, [visitId]);

  const flushTicks = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const [itemId, want] of Object.entries(pending.current)) {
        let res: VisitResult;
        try {
          res = await saveItem({ visitId, itemId, done: want.done, reason: want.reason });
        } catch {
          res = { ok: false, retry: true, message: "" };
        }
        if (!res.ok && res.retry) {
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => setTickNudge((n) => n + 1), RETRY_MS);
          return;
        }
        // Only forget it if they haven't changed it again while it was sending.
        if (pending.current[itemId] === want) delete pending.current[itemId];
        setItemErrors((e) => {
          const next = { ...e };
          if (res.ok) delete next[itemId];
          else next[itemId] = res.message;
          return next;
        });
        syncCount();
      }
    } finally {
      flushing.current = false;
    }
    if (Object.keys(pending.current).length) setTickNudge((n) => n + 1);
  }, [visitId, syncCount]);
  useEffect(() => {
    if (tickNudge) void flushTicks();
  }, [tickNudge, flushTicks]);

  const change = (itemId: string, next: State) => {
    setCompleteError(null);
    setItems((s) => ({ ...s, [itemId]: next }));
    pending.current[itemId] = next;
    syncCount();
    void flushTicks();
  };

  // Ticks left on the phone from before a reload: show them and send them.
  useEffect(() => {
    const stored = readStore(visitId);
    const known = new Set(initial.map((i) => i.id));
    const keep = Object.fromEntries(Object.entries(stored).filter(([id]) => known.has(id)));
    if (Object.keys(keep).length) {
      pending.current = { ...keep, ...pending.current };
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved queue once on mount
      setItems((s) => ({ ...s, ...keep }));
      syncCount();
      void flushTicks();
    }
  }, [visitId, initial, flushTicks, syncCount]);

  // ---------------------------------------------------------------- photo queue
  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const queueRef = useRef<QueuedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<Record<"before" | "after", string | null>>({ before: null, after: null });
  const sendingPhotos = useRef(false);
  const photoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [photoNudge, setPhotoNudge] = useState(0);
  const setQ = (fn: (q: QueuedPhoto[]) => QueuedPhoto[]) => {
    queueRef.current = fn(queueRef.current);
    setQueue(queueRef.current);
  };

  const flushPhotos = useCallback(async () => {
    if (sendingPhotos.current) return;
    sendingPhotos.current = true;
    try {
      for (const p of queueRef.current.filter((x) => x.status !== "sent")) {
        setQ((q) => q.map((x) => (x.localId === p.localId ? { ...x, status: "sending" } : x)));
        let uploaded = p.uploaded;
        if (!uploaded) {
          try {
            const { error } = await createClient().storage.from("visit-photos").upload(p.path, p.blob, { contentType: p.type, upsert: false });
            // "Already exists" means an earlier try got through before its reply was lost.
            uploaded = !error || /exist|duplicate/i.test(error.message);
          } catch {
            uploaded = false;
          }
        }
        let res: VisitResult = { ok: false, retry: true, message: "" };
        if (uploaded) {
          try {
            res = await recordPhoto({ visitId, kind: p.kind, path: p.path, clientTakenAt: p.takenAt });
          } catch {
            res = { ok: false, retry: true, message: "" };
          }
        }
        if (res.ok) {
          setQ((q) => q.map((x) => (x.localId === p.localId ? { ...x, uploaded: true, status: "sent" } : x)));
          setPhotoError((e) => ({ ...e, [p.kind]: null }));
          continue;
        }
        setQ((q) => q.map((x) => (x.localId === p.localId ? { ...x, uploaded, status: "waiting" } : x)));
        if (!res.retry) {
          setPhotoError((e) => ({ ...e, [p.kind]: res.message }));
          setQ((q) => q.filter((x) => x.localId !== p.localId));
          continue;
        }
        if (photoTimer.current) clearTimeout(photoTimer.current);
        photoTimer.current = setTimeout(() => setPhotoNudge((n) => n + 1), RETRY_MS);
        return;
      }
      // Photos taken while this pass was sending: go round again.
      if (queueRef.current.some((x) => x.status === "waiting")) setPhotoNudge((n) => n + 1);
    } finally {
      sendingPhotos.current = false;
    }
  }, [visitId]);
  useEffect(() => {
    if (photoNudge) void flushPhotos();
  }, [photoNudge, flushPhotos]);

  // Signal's back: send whatever is waiting straight away rather than at the next retry.
  useEffect(() => {
    const online = () => {
      void flushTicks();
      void flushPhotos();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [flushTicks, flushPhotos]);

  // Photos being shrunk on the phone, not queued yet: they count as waiting too.
  const [preparing, setPreparing] = useState(0);

  const addPhoto = async (kind: "before" | "after", file: File) => {
    setPhotoError((e) => ({ ...e, [kind]: null }));
    setCompleteError(null);
    setPreparing((n) => n + 1);
    const prepared = await preparePhoto(file);
    setPreparing((n) => n - 1);
    if ("error" in prepared) {
      setPhotoError((e) => ({ ...e, [kind]: prepared.error }));
      return;
    }
    const localId = crypto.randomUUID();
    setQ((q) => [
      ...q,
      {
        localId,
        kind,
        preview: URL.createObjectURL(prepared.blob),
        blob: prepared.blob,
        type: prepared.type,
        path: photoPath(visitId, kind, prepared.ext, crypto.randomUUID()),
        takenAt: new Date().toISOString(),
        uploaded: false,
        status: "waiting",
      },
    ]);
    void flushPhotos();
  };

  // Photos waiting to send live only in this page (never stored on the phone): warn before leaving.
  const photosWaiting = queue.filter((p) => p.status !== "sent").length + preparing;
  useEffect(() => {
    if (!photosWaiting && !pendingCount) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [photosWaiting, pendingCount]);
  useEffect(() => () => queueRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  // ---------------------------------------------------------------- complete

  const complete = async () => {
    setCompleting(true);
    setCompleteError(null);
    // Give the queues a moment to empty: a clean can't be completed on ticks it hasn't sent.
    for (let i = 0; i < 20 && (Object.keys(pending.current).length || queueRef.current.some((p) => p.status !== "sent")); i++) {
      void flushTicks();
      void flushPhotos();
      await new Promise((r) => setTimeout(r, 500));
    }
    const waiting = Object.keys(pending.current).length + queueRef.current.filter((p) => p.status !== "sent").length;
    if (waiting) {
      setCompleting(false);
      setCompleteError(`${waiting === 1 ? "One thing is" : `${waiting} things are`} still waiting for signal. Stay on this screen: it keeps trying, then tap Complete again.`);
      return;
    }
    let res: VisitResult;
    try {
      res = await completeVisit(visitId);
    } catch {
      res = { ok: false, retry: true, message: "That didn't send. Your signal may have dropped. Tap Complete again." };
    }
    setCompleting(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    setCompleteError(completeMessage(res));
  };

  // ---------------------------------------------------------------- render
  const rooms = useMemo(() => {
    const out = new Map<string, Item[]>();
    for (const i of initial) out.set(i.room, [...(out.get(i.room) ?? []), i]);
    return [...out.entries()];
  }, [initial]);
  const resolved = Object.values(items).filter((s) => s.done || (s.reason && isRealReason(s.reason))).length;
  const total = initial.length;
  const photosOf = (kind: "before" | "after") => existing.filter((p) => p.kind === kind).length + queue.filter((p) => p.kind === kind).length;

  return (
    <div className="grid gap-10">
      <section aria-labelledby="progress" className="grid gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="progress" className="text-xl font-semibold">Checklist</h2>
          <p className="font-display text-2xl font-semibold tabular" aria-live="polite">
            {resolved}<span className="text-ink-3">/{total}</span>
          </p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-paper-2" aria-hidden>
          <div className="h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${total ? (resolved / total) * 100 : 0}%` }} />
        </div>
        <SyncLine ticks={pendingCount} photos={photosWaiting} />
      </section>

      <PhotoBox kind="before" title="Before photos" hint="Before you start: the rooms as you found them." existing={existing} queue={queue} error={photoError.before} onAdd={addPhoto} />

      <div className="grid gap-8">
        {rooms.map(([room, list]) => (
          <section key={room} aria-label={room} className="grid gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-3">{room}</h3>
            <ul className="grid gap-2.5">
              {list.map((i) => (
                <ChecklistRow key={i.id} item={i} state={items[i.id]!} error={itemErrors[i.id]} onChange={(s) => change(i.id, s)} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <PhotoBox kind="after" title="After photos" hint="When you're done: the same rooms, finished." existing={existing} queue={queue} error={photoError.after} onAdd={addPhoto} />

      <section aria-labelledby="finish" className="grid gap-4 rounded-lg bg-ink p-6 text-paper sm:p-8">
        <h2 id="finish" className="text-xl font-semibold">Finished?</h2>
        <ul className="grid gap-1.5 text-paper/80">
          <Check ok={resolved === total}>{resolved === total ? "Every item ticked or explained" : `${total - resolved} item${total - resolved === 1 ? "" : "s"} still to tick or explain`}</Check>
          <Check ok={photosOf("before") > 0}>{photosOf("before") > 0 ? "Before photo added" : "Add a before photo"}</Check>
          <Check ok={photosOf("after") > 0}>{photosOf("after") > 0 ? "After photo added" : "Add an after photo"}</Check>
        </ul>
        {completeError ? <p role="alert" className="rounded-md bg-bad-soft px-4 py-3 font-medium text-bad">{completeError}</p> : null}
        <Button size="xl" pending={completing} onClick={() => void complete()} className="w-full">
          {completing ? "Completing…" : "Complete this clean"}
        </Button>
      </section>
    </div>
  );
}

function completeMessage(res: Extract<VisitResult, { ok: false }>): string {
  if (res.code === "PC013" && res.detail && Number(res.detail) > 0) {
    const n = Number(res.detail);
    return `${n} item${n === 1 ? " is" : "s are"} still to tick, or mark “couldn't do” with a reason.`;
  }
  if (res.code === "PC014" && res.detail) {
    const want = res.detail.split(",");
    return want.length > 1 ? "Add a before and an after photo." : `Add ${want[0] === "after" ? "an after" : "a before"} photo. If you just took it, wait for it to finish sending.`;
  }
  return res.message || pingErrorMessage(null);
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", ok ? "bg-ok text-paper" : "ring-2 ring-paper/30")} aria-hidden>
        {ok ? (
          <svg viewBox="0 0 24 24" className="size-4"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : null}
      </span>
      <span className={ok ? "text-paper" : undefined}>{children}</span>
    </li>
  );
}

function SyncLine({ ticks, photos }: { ticks: number; photos: number }) {
  if (!ticks && !photos) {
    return <p className="text-sm text-ink-3">Everything&rsquo;s saved.</p>;
  }
  const parts = [ticks ? `${ticks} tick${ticks === 1 ? "" : "s"}` : null, photos ? `${photos} photo${photos === 1 ? "" : "s"}` : null].filter(Boolean);
  return (
    <p role="status" className="flex items-center gap-2 text-sm font-semibold text-warn">
      <Spinner className="size-4" /> Sending {parts.join(" and ")}. Keep going: nothing&rsquo;s lost.
    </p>
  );
}

function ChecklistRow({ item, state, error, onChange }: { item: Item; state: State; error?: string; onChange: (s: State) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(state.reason ?? "");
  const skipped = !state.done && Boolean(state.reason);
  const draftOk = isRealReason(draft.trim());

  return (
    <li data-item={item.id} data-state={state.done ? "done" : skipped ? "skipped" : "open"} className={cn("grid gap-0 overflow-hidden rounded-md ring-1 ring-inset transition-colors", state.done ? "bg-ok-soft/70 ring-ok/25" : skipped ? "bg-warn-soft/70 ring-warn/25" : "bg-card ring-line")}>
      <div className="flex items-stretch">
        <button
          type="button"
          aria-pressed={state.done}
          onClick={() => {
            setOpen(false);
            onChange(state.done ? { done: false, reason: null } : { done: true, reason: null });
          }}
          className="flex min-h-16 flex-1 items-center gap-4 px-4 py-3 text-left"
        >
          <span
            aria-hidden
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full ring-2 transition-colors",
              state.done ? "bg-ok text-paper ring-ok" : skipped ? "bg-warn text-paper ring-warn" : "ring-line",
            )}
          >
            {state.done ? (
              <svg viewBox="0 0 24 24" className="size-5"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : skipped ? (
              <svg viewBox="0 0 24 24" className="size-5"><path d="M7 12h10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
            ) : null}
          </span>
          <span className="grid gap-0.5">
            <span className={cn("text-base font-semibold", state.done && "text-ink-2")}>{item.label}</span>
            {skipped ? <span className="text-sm text-warn">Couldn&rsquo;t do: {state.reason}</span> : null}
          </span>
        </button>
        {!state.done ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-why`}
            onClick={() => {
              setDraft(state.reason ?? "");
              setOpen((o) => !o);
            }}
            className="min-h-16 shrink-0 border-l border-line/70 px-4 text-sm font-semibold text-ink-2 hover:bg-paper-2"
          >
            {skipped ? "Change" : "Couldn’t do"}
          </button>
        ) : null}
      </div>
      {open ? (
        <form
          id={`${id}-why`}
          className="grid gap-3 border-t border-line/70 bg-paper px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draftOk) return;
            onChange({ done: false, reason: draft.trim() });
            setOpen(false);
          }}
        >
          <label htmlFor={`${id}-reason`} className="text-sm font-semibold">Why couldn&rsquo;t you do it? The customer will see this.</label>
          <textarea
            id={`${id}-reason`}
            rows={2}
            maxLength={REASON_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="For example: No access to the back bedroom"
            className="w-full rounded-md bg-card px-4 py-3 text-base ring-1 ring-inset ring-line focus:outline-none focus:ring-2 focus:ring-ink"
          />
          {!draftOk && draft.trim() ? <p className="text-sm font-medium text-bad">Say why in a few words.</p> : null}
          <div className="flex gap-3">
            <Button type="submit" variant="ink" disabled={!draftOk} className="flex-1">Save reason</Button>
            {skipped ? (
              <Button type="button" variant="secondary" onClick={() => { onChange({ done: false, reason: null }); setOpen(false); }}>
                Clear
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            )}
          </div>
        </form>
      ) : null}
      {error ? <p role="alert" className="border-t border-bad/20 bg-bad-soft px-4 py-2 text-sm font-medium text-bad">{error}</p> : null}
    </li>
  );
}

function PhotoBox({
  kind,
  title,
  hint,
  existing,
  queue,
  error,
  onAdd,
}: {
  kind: "before" | "after";
  title: string;
  hint: string;
  existing: ExistingPhoto[];
  queue: QueuedPhoto[];
  error: string | null;
  onAdd: (kind: "before" | "after", f: File) => void;
}) {
  const id = useId();
  const mine = existing.filter((p) => p.kind === kind);
  const queued = queue.filter((p) => p.kind === kind);
  const count = mine.length + queued.length;

  return (
    <section aria-labelledby={`${id}-h`} className="grid gap-4 rounded-lg bg-card p-5 shadow-card ring-1 ring-line/70 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-h`} className="text-xl font-semibold">{title}</h2>
        {count ? <Badge tone="ok">{count} added</Badge> : <Badge tone="warn">At least one</Badge>}
      </div>
      <p className="-mt-2 text-ink-2">{hint}</p>
      {count ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {mine.map((p) => (
            <li key={p.id} className="relative aspect-square overflow-hidden rounded-md bg-paper-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not an optimisable asset */}
              {p.url ? <img src={p.url} alt={`${title.replace(" photos", "")} photo`} className="size-full object-cover" /> : null}
            </li>
          ))}
          {queued.map((p) => (
            <li key={p.localId} className="relative aspect-square overflow-hidden rounded-md bg-paper-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of a photo still sending */}
              <img src={p.preview} alt={`${title.replace(" photos", "")} photo${p.status === "sent" ? "" : ", sending"}`} className={cn("size-full object-cover", p.status !== "sent" && "opacity-60")} />
              {p.status !== "sent" ? (
                <span className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded bg-ink/80 py-0.5 text-xs font-semibold text-paper">
                  <Spinner className="size-3" /> Sending
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert" className="rounded-md bg-bad-soft px-4 py-3 font-medium text-bad">{error}</p> : null}
      <input
        id={`${id}-file`}
        type="file"
        accept="image/*"
        capture="environment"
        className="peer sr-only"
        aria-label={kind === "after" ? "Take an after photo" : "Take a before photo"}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          for (const f of files) void onAdd(kind, f);
        }}
      />
      <label
        htmlFor={`${id}-file`}
        className={buttonClass(count ? "secondary" : "primary", "lg", "w-full cursor-pointer peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-signal")}
      >
        <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
          <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="12" cy="13" r="3.25" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span>{count ? "Take another" : kind === "after" ? "Take an after photo" : "Take a before photo"}</span>
      </label>
    </section>
  );
}
