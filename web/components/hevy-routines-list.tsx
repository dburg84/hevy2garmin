"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Routine {
  id: string;
  title: string;
  exercises: number;
}

const btn =
  "rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-active disabled:opacity-50";

function RoutineRow({ r }: { r: Routine }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "sync" | "schedule">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [date, setDate] = useState("");

  async function sync() {
    setBusy("sync");
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/routines/${encodeURIComponent(r.id)}/sync`, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setError(d.error ?? `Request failed (${res.status}).`);
        return;
      }
      setSynced(true);
      setMsg("Synced to Garmin as a planned workout.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function schedule() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Pick a date first.");
      return;
    }
    setBusy("schedule");
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/routines/${encodeURIComponent(r.id)}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setError(d.error ?? `Request failed (${res.status}).`);
        return;
      }
      setShowSchedule(false);
      setMsg(`Scheduled for ${date}.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-text">{r.title}</div>
          <div className="mt-0.5 text-xs text-text-muted">
            {r.exercises} exercise{r.exercises === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={sync} disabled={busy !== null} className={btn}>
            {busy === "sync" ? "Syncing…" : synced ? "Re-sync" : "Sync to Garmin"}
          </button>
          <button
            type="button"
            onClick={() => setShowSchedule((v) => !v)}
            disabled={busy !== null}
            className={btn}
          >
            {showSchedule ? "Cancel" : "Schedule"}
          </button>
        </div>
      </div>
      {showSchedule && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text focus:border-teal focus:outline-none"
          />
          <button
            type="button"
            onClick={schedule}
            disabled={busy !== null}
            className="rounded-lg bg-teal/20 px-3 py-1.5 text-xs font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50"
          >
            {busy === "schedule" ? "Scheduling…" : "Add to calendar"}
          </button>
          <span className="text-xs text-text-muted">Sync the routine first if you haven&apos;t.</span>
        </div>
      )}
      {msg && !error && <div className="mt-1.5 text-xs text-success">{msg}</div>}
      {error && (
        <div className="mt-1.5 text-xs text-danger" role="alert">
          {error}
        </div>
      )}
    </li>
  );
}

/**
 * Your Hevy routines, with per-routine "Sync to Garmin" (create a planned
 * workout) and "Schedule" (add it to a calendar date). Fetches /api/hevy-routines
 * (read-only) on mount; degrades quietly when Hevy is unreachable.
 */
export function HevyRoutinesList() {
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/hevy-routines")
      .then((res) => res.json())
      .then((d: { routines?: Routine[]; error?: string }) => {
        if (!alive) return;
        setRoutines(Array.isArray(d.routines) ? d.routines : []);
        if (d.error) setNote(d.error);
        setPhase("ready");
      })
      .catch((err) => {
        if (!alive) return;
        setNote(err instanceof Error ? err.message : String(err));
        setPhase("ready");
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = query.trim()
    ? routines.filter((r) => r.title.toLowerCase().includes(query.trim().toLowerCase()))
    : routines;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">Your Hevy routines</h2>
        {routines.length > 0 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search routines…"
            aria-label="Search routines"
            className="w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-teal focus:outline-none"
          />
        )}
      </div>
      {phase === "loading" ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-muted">
          Loading routines from Hevy…
        </div>
      ) : routines.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-muted">
          {note ? `Couldn't load routines: ${note}` : "No routines found in Hevy."}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-muted">
          No routines match “{query}”.
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-elevated">
            {filtered.map((r) => (
              <RoutineRow key={r.id} r={r} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-muted tabular-nums">
            {filtered.length} of {routines.length} routine{routines.length === 1 ? "" : "s"}
          </p>
        </>
      )}
    </section>
  );
}
