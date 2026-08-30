"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Connect-Garmin form for the setup page. Sends email/password to
 * /api/garmin-login, which runs the SSO and persists the DI tokens. The password
 * is used only to log in and is never stored or echoed back.
 */
export function ConnectGarmin({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    if (!email.trim() || !password) {
      setError("Enter your Garmin email and password.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/garmin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const d = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (d.status === "connected") {
        setPassword("");
        setOkMsg("Garmin connected.");
        router.refresh();
      } else {
        // needs_mfa or error both carry a message
        setError(d.error ?? `Request failed (${res.status}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-teal focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-text-muted">
        {connected
          ? "Garmin is connected. Sign in again to refresh the session."
          : "Sign in with your Garmin Connect account. Your password is used only to get a token and is never stored."}
      </p>
      <input
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Garmin email"
        className={inputCls}
      />
      <input
        type="password"
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Garmin password"
        className={inputCls}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-teal/20 px-4 py-2 text-sm font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50"
        >
          {busy ? "Connecting…" : "Connect Garmin"}
        </button>
        {okMsg && <span className="text-xs text-success">{okMsg}</span>}
        {error && (
          <span className="text-xs text-danger" role="alert">
            {error}
          </span>
        )}
      </div>
      <p className="text-xs text-text-muted">
        Two-factor accounts and cloud deploys: web sign-in isn&apos;t supported
        yet — use the CLI or scheduled job to establish the Garmin session.
      </p>
    </form>
  );
}
