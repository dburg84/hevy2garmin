"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * A compact on/off switch for scheduled auto-sync, for the dashboard. Posts to
 * /api/toggle-autosync (DB-only) and refreshes. The same value is editable in
 * Settings; this is the quick toggle.
 */
export function AutoSyncToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/toggle-autosync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setError(d.error ?? `Request failed (${res.status}).`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex-1">
        <div className="text-sm font-medium text-text">Auto-sync</div>
        <div className="text-xs text-text-muted">
          {enabled ? "On — new workouts sync on a schedule." : "Off — sync only when you run it."}
        </div>
        {error && (
          <div className="mt-1 text-xs text-danger" role="alert">
            {error}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={enabled}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-teal/60" : "bg-surface-active"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-text transition-transform ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
