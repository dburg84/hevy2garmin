/**
 * The sync pipeline "how it works" diagram — the same truth as the Python
 * dashboard's SVG, presented more richly in TS/React: brand-coloured gradient
 * stages, an animated pulse flowing through the arrows (CSS-only, no JS), and
 * the HR-enrichment loop rendered properly. Server component; theme-agnostic
 * (the brand accents read on both light and dark grounds).
 *
 * Content is faithful to the real pipeline and MUST stay accurate:
 *   Hevy API (fetch workouts) → Map exercises (N built-in mappings)
 *   → Generate FIT (+ HR + calories) → Garmin (upload activity)
 *   HR loop: Garmin daily HR → matched to the workout → calories → into the FIT.
 */

interface Stage {
  key: string;
  x: number;
  w: number;
  title: string;
  sub: string;
  dynamic?: boolean;
  a: string;
  b: string;
}

const STAGES: Stage[] = [
  { key: "hevy", x: 8, w: 184, title: "Hevy API", sub: "Fetch workouts", a: "#6366f1", b: "#818cf8" },
  { key: "map", x: 224, w: 184, title: "Map exercises", sub: "", dynamic: true, a: "#a855f7", b: "#c084fc" },
  { key: "fit", x: 440, w: 184, title: "Generate FIT", sub: "+ HR + calories", a: "#f59e0b", b: "#fbbf24" },
  { key: "garmin", x: 656, w: 184, title: "Garmin", sub: "Upload activity", a: "#00875a", b: "#34d399" },
];

const ROSE = "#f43f5e";
const ROSE_LIGHT = "#fb7185";

export function PipelineDiagram({ mappingCount }: { mappingCount?: number }) {
  const mapSub = `${(mappingCount ?? 433).toLocaleString()} exercises mapped`;

  return (
    <section className="mb-8 rounded-xl border border-border bg-surface-elevated p-4">
      <div className="mb-3 flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted" aria-hidden="true">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <h3 className="text-sm font-semibold text-text">Pipeline</h3>
        <span className="text-xs text-text-muted">— how a workout reaches Garmin</span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 848 214"
          role="img"
          aria-label="Hevy workout, map exercises, generate FIT with heart-rate and calories, upload to Garmin; Garmin's daily heart-rate is matched back into the FIT."
          className="h-auto w-full min-w-[560px]"
        >
          <defs>
            {STAGES.map((s) => (
              <linearGradient key={s.key} id={`pg-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.a} stopOpacity="0.22" />
                <stop offset="1" stopColor={s.a} stopOpacity="0.06" />
              </linearGradient>
            ))}
            <style>{`
              .pg-flow { stroke-dasharray: 5 6; animation: pgflow 0.9s linear infinite; }
              .pg-flow-rose { stroke-dasharray: 4 6; animation: pgflow 1.1s linear infinite; }
              @keyframes pgflow { to { stroke-dashoffset: -22; } }
              @media (prefers-reduced-motion: reduce) { .pg-flow, .pg-flow-rose { animation: none; } }
            `}</style>
            <marker id="pg-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
            </marker>
            <marker id="pg-arrow-rose" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill={ROSE} />
            </marker>
          </defs>

          {/* Top-row flow arrows (animated dashes = data moving) */}
          {[0, 1, 2].map((i) => {
            const x1 = STAGES[i].x + STAGES[i].w;
            const x2 = STAGES[i + 1].x;
            return (
              <g key={`arr-${i}`}>
                <line x1={x1 + 2} y1="46" x2={x2 - 6} y2="46" stroke="#334155" strokeWidth="6" strokeLinecap="round" opacity="0.35" />
                <line x1={x1 + 2} y1="46" x2={x2 - 6} y2="46" stroke="#94a3b8" strokeWidth="2" className="pg-flow" markerEnd="url(#pg-arrow)" />
              </g>
            );
          })}

          {/* Stage cards */}
          {STAGES.map((s) => (
            <g key={s.key}>
              <rect x={s.x} y="14" width={s.w} height="64" rx="10" fill={`url(#pg-${s.key})`} stroke={s.a} strokeOpacity="0.4" />
              <rect x={s.x} y="14" width={s.w} height="4" rx="2" fill={s.a} />
              <text x={s.x + s.w / 2} y="45" textAnchor="middle" fontSize="14" fontWeight="700" fill={s.b}>{s.title}</text>
              <text x={s.x + s.w / 2} y="63" textAnchor="middle" fontSize="11" fill="#94a3b8">
                {s.dynamic ? mapSub : s.sub}
              </text>
            </g>
          ))}

          {/* ── HR enrichment loop ── */}
          {/* Garmin ↓ to Fetch HR */}
          <line x1="748" y1="80" x2="748" y2="120" stroke="#00875a" strokeWidth="2" className="pg-flow" markerEnd="url(#pg-arrow)" opacity="0.9" />
          {/* Fetch HR Data (dashed, under Garmin) */}
          <rect x="656" y="126" width="184" height="52" rx="10" fill="rgba(0,135,90,0.06)" stroke="#00875a" strokeOpacity="0.35" strokeDasharray="6 3" />
          <text x="748" y="148" textAnchor="middle" fontSize="12" fontWeight="600" fill="#34d399">Fetch HR data</text>
          <text x="748" y="164" textAnchor="middle" fontSize="10" fill="#94a3b8">Daily watch monitoring</text>
          {/* Fetch HR ← Match HR (rose, data flows left) */}
          <line x1="654" y1="152" x2="626" y2="152" stroke={ROSE} strokeWidth="2" className="pg-flow-rose" markerEnd="url(#pg-arrow-rose)" />
          {/* Match HR & Calc Calories (rose, under Generate FIT) */}
          <rect x="440" y="126" width="184" height="52" rx="10" fill="rgba(244,63,94,0.07)" stroke={ROSE} strokeOpacity="0.4" />
          <text x="532" y="148" textAnchor="middle" fontSize="12" fontWeight="600" fill={ROSE_LIGHT}>Match HR & calc calories</text>
          <text x="532" y="164" textAnchor="middle" fontSize="10" fill="#94a3b8">~90 bpm fallback if none</text>
          {/* Match HR ↑ into Generate FIT (rose, feeds back up) */}
          <line x1="532" y1="124" x2="532" y2="82" stroke={ROSE} strokeWidth="2" className="pg-flow-rose" markerEnd="url(#pg-arrow-rose)" />
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm bg-[#94a3b8]" /> Workout data</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: ROSE }} /> Heart-rate enrichment</span>
        <span>
          Toggle HR fusion in{" "}
          <a href="/settings" className="text-teal underline">
            Settings
          </a>
          .
        </span>
      </div>
    </section>
  );
}
