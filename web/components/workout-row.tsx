"use client";

import { useState } from "react";

export interface WorkoutItem {
  hevy_id: string;
  title: string | null;
  when: string | null;
  garmin_activity_id: string | null;
  detail?: string | null;
  kind: "terminal" | "pending";
  state: string;
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusPill({ item }: { item: WorkoutItem }) {
  const terminal: Record<string, { cls: string; label: string }> = {
    success: { cls: "bg-success/15 text-success", label: "Uploaded" },
    manual: { cls: "bg-warm/15 text-warm", label: "Marked as synced" },
    skipped: { cls: "bg-surface-active text-text-muted", label: "Skipped" },
    failed: { cls: "bg-danger/15 text-danger", label: "Failed" },
  };
  if (item.kind === "terminal") {
    const s = terminal[item.state] ?? { cls: "bg-surface-active text-text-secondary", label: item.state };
    return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
  }
  return <span className="inline-block rounded-full bg-teal/15 px-2.5 py-0.5 text-xs font-medium text-teal">{item.state}</span>;
}

function HrChart({ samples }: { samples: number[] }) {
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = max - min || 1;
  const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  const W = 600;
  const H = 120;
  const pad = 8;
  const xy = (v: number, i: number) => {
    const x = pad + (i / Math.max(1, samples.length - 1)) * (W - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const line = samples.map(xy).join(" ");
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full rounded-lg bg-surface" style={{ height: 110 }}>
        <polygon points={area} fill="rgba(239, 68, 68, 0.12)" />
        <polyline points={line} fill="none" stroke="#ef4444" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-text-muted tabular-nums">
        <span>min {min} bpm</span>
        <span>avg {avg} bpm</span>
        <span>max {max} bpm</span>
      </div>
    </div>
  );
}

/**
 * A workout row with an on-demand heart-rate chart. The HR toggle appears only
 * when the workout is matched to a Garmin activity; expanding it fetches the
 * cached HR from /api/workout/[id]/hr (read-only) and draws an inline SVG.
 */
export function WorkoutRow({ item }: { item: WorkoutItem }) {
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<number[] | null | undefined>(undefined); // undefined = not fetched
  const [loading, setLoading] = useState(false);
  const canHr = Boolean(item.garmin_activity_id);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && samples === undefined) {
      setLoading(true);
      try {
        const res = await fetch(`/api/workout/${encodeURIComponent(item.hevy_id)}/hr`);
        const d = (await res.json().catch(() => ({}))) as { samples?: unknown };
        setSamples(Array.isArray(d.samples) ? (d.samples as number[]) : null);
      } catch {
        setSamples(null);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-text">{item.title || "Untitled workout"}</div>
          <div className="mt-0.5 text-xs text-text-muted">
            {fmtDate(item.when)}
            {item.garmin_activity_id && <span> · Garmin {item.garmin_activity_id}</span>}
            {item.detail && <span className="text-text-secondary"> · {item.detail}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canHr && (
            <button
              type="button"
              onClick={toggle}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-active"
            >
              {open ? "Hide HR" : "HR"}
            </button>
          )}
          <StatusPill item={item} />
        </div>
      </div>
      {open && (
        <div>
          {loading ? (
            <p className="mt-2 text-xs text-text-muted">Loading heart-rate…</p>
          ) : samples ? (
            <HrChart samples={samples} />
          ) : (
            <p className="mt-2 text-xs text-text-muted">No cached heart-rate for this workout yet.</p>
          )}
        </div>
      )}
    </li>
  );
}
