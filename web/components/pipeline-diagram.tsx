/**
 * The sync pipeline, shown on the dashboard — ports the Python "Pipeline" card:
 * Hevy → Map exercises → Generate FIT → Garmin, with the HR-fusion enrichment
 * note. Purely informational (server component, no state).
 */
const STEPS: { label: string; sub: string }[] = [
  { label: "Hevy", sub: "workout" },
  { label: "Map exercises", sub: "→ FIT categories" },
  { label: "Generate FIT", sub: "sets · reps · calories" },
  { label: "Garmin", sub: "upload or match" },
];

function Arrow() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-muted" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export function PipelineDiagram() {
  return (
    <section className="mb-8 rounded-xl border border-border bg-surface-elevated p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">Pipeline</h3>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {STEPS.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2 sm:gap-3">
            <div className="rounded-lg border border-border bg-surface px-3 py-2 text-center">
              <div className="text-sm font-medium text-text">{s.label}</div>
              <div className="mt-0.5 text-[11px] text-text-muted">{s.sub}</div>
            </div>
            {i < STEPS.length - 1 && <Arrow />}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-text-muted">
        When HR fusion is on, a matched Garmin activity&apos;s heart-rate is folded
        into the upload (falling back to ~90 bpm when none is found).{" "}
        <a href="/settings" className="text-teal underline">
          Configure
        </a>
        .
      </p>
    </section>
  );
}
