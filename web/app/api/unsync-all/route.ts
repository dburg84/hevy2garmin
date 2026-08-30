import { NextResponse } from "next/server";
import { unsyncAll } from "@/lib/pending-store";

// Deletes from the app's own synced_workouts table at request time — never at build.
export const dynamic = "force-dynamic";

/**
 * POST /api/unsync-all
 *
 * Clears every terminal synced_workouts row so all workouts become sync
 * candidates again. DB-ONLY: it does NOT delete any Garmin activity (same
 * boundary as single /api/unsync). Mirrors the Python /api/unsync-all.
 *
 * NOTE: auth-gating (session cookie / middleware) is added in the login phase;
 * this route is intentionally unauthenticated for now.
 */
export async function POST() {
  let count: number;
  try {
    count = await unsyncAll();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count });
}
