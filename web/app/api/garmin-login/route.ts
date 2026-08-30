import { NextResponse } from "next/server";
import { GarminAuth, DBTokenStore, NEEDS_MFA } from "garmin-auth";
import { GARMIN_TOKEN_PLATFORM, resetGarminClient } from "@/lib/garmin-upload";

// Performs a live Garmin SSO login at request time — never at build.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/garmin-login
 * Body: { email, password }
 *
 * Runs the garmin-auth SSO login and persists the resulting DI tokens into
 * platform_credentials ('garmin_tokens') via DBTokenStore, so the sync engine
 * can use them. Mirrors the Python self-hosted Garmin login — the password is
 * used only to obtain a token and is never stored.
 *
 * KNOWN LIMITS (surfaced to the user in the form):
 *   - MFA accounts: login() returns needs_mfa, and the package does not yet
 *     expose an MFA-code submission, so those must use the CLI / scheduled job.
 *   - From a cloud IP (e.g. Vercel), Garmin SSO is blocked and needs the CF
 *     Worker proxy; a self-hosted deploy logs in directly.
 */
export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ status: "error", error: "Invalid JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json(
      { status: "error", error: "Email and password are required." },
      { status: 400 },
    );
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json(
      { status: "error", error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const store = new DBTokenStore(url, GARMIN_TOKEN_PLATFORM);
    const auth = new GarminAuth({ email, password, store });
    const result = await auth.login();
    if (result === NEEDS_MFA) {
      return NextResponse.json({
        status: "needs_mfa",
        error:
          "This Garmin account uses two-factor auth. Web verification-code entry isn't supported yet — use the CLI or the scheduled job to establish the session.",
      });
    }
    // Fresh tokens were persisted by the store; drop the cached client.
    resetGarminClient();
    return NextResponse.json({ status: "connected" });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: "error", error }, { status: 502 });
  }
}
