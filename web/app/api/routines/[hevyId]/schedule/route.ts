import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { scheduleRoutine } from "@/lib/garmin-routine-sync";
import { getDb } from "@/lib/db";
import { verifySession, SESSION_COOKIE, authEnabled } from "@/lib/auth";

// Writes a Garmin calendar entry at request time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/routines/[hevyId]/schedule
 * Body: { date: "YYYY-MM-DD" }
 *
 * Schedules the routine's already-synced Garmin workout onto a calendar date.
 * The routine must have been synced first (so a garmin_workout_id exists). Same
 * authorization gate as the sync route.
 */
async function isAuthorized(request: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization") ?? "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m && m[1] === cronSecret) return true;
  }
  if (!authEnabled()) return true;
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value ?? null);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ hevyId: string }> },
) {
  const { hevyId } = await params;
  if (!hevyId) {
    return NextResponse.json({ error: "hevyId is required." }, { status: 400 });
  }

  let body: { date?: unknown } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "A date (YYYY-MM-DD) is required." }, { status: 400 });
  }

  if (!(await isAuthorized(request))) {
    return NextResponse.json(
      { error: "Unauthorized: scheduling requires a session or CRON_SECRET." },
      { status: 401 },
    );
  }

  let sql: ReturnType<typeof getDb>;
  try {
    sql = getDb();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `DB unavailable: ${error}` }, { status: 503 });
  }

  try {
    const rows = (await sql`
      SELECT garmin_workout_id FROM synced_routines WHERE hevy_routine_id = ${hevyId} LIMIT 1
    `) as Array<{ garmin_workout_id: string | null }>;
    const garminWorkoutId = rows[0]?.garmin_workout_id;
    if (!garminWorkoutId) {
      return NextResponse.json(
        { error: "Sync this routine to Garmin before scheduling it." },
        { status: 409 },
      );
    }
    const result = await scheduleRoutine(hevyId, garminWorkoutId, date, sql);
    const code = result.status === "error" ? 502 : 200;
    return NextResponse.json({ ok: result.status === "scheduled", ...result }, { status: code });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 502 });
  }
}
