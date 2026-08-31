"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Connect-Garmin form for the setup page. A two-step flow:
 *   1. email/password → POST /api/garmin-login
 *   2. if the account has two-factor, the server replies needs_mfa with a
 *      session id; a code field appears → POST /api/garmin-login-mfa
 *
 * The credentials are forwarded to the login Worker only to obtain a token and
 * are never stored or echoed back. Sign-in runs through a Cloudflare Worker so
 * it works from cloud deploys (where Garmin blocks direct SSO).
 */
export function ConnectGarmin({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  type Reply = { status?: string; error?: string; session_id?: string };

  function onSuccess() {
    setPassword("");
    setMfaCode("");
    setSessionId(null);
    setOkMsg("Garmin connected.");
    router.refresh();
  }

  async function startLogin(e: React.FormEvent) {
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
      const d = (await res.json().catch(() => ({}))) as Reply;
      if (d.status === "connected") {
        onSuccess();
      } else if (d.status === "needs_mfa") {
        setSessionId(d.session_id ?? "");
        setError(null);
      } else {
        setError(d.error ?? `Request failed (${res.status}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!mfaCode.trim()) {
      setError("Enter the verification code Garmin sent you.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/garmin-login-mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, mfa_code: mfaCode.trim() }),
      });
      const d = (await res.json().catch(() => ({}))) as Reply;
      if (d.status === "connected") {
        onSuccess();
      } else {
        setError(d.error ?? `Request failed (${res.status}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function cancelMfa() {
    setSessionId(null);
    setMfaCode("");
    setError(null);
  }

  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-teal focus:outline-none";

  // Step 2: verification code
  if (sessionId !== null) {
    return (
      <form onSubmit={submitMfa} className="space-y-3">
        <p className="text-xs text-text-muted">
          This Garmin account uses two-factor authentication. Enter the
          verification code from your authenticator app or SMS.
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={mfaCode}
          onChange={(e) => setMfaCode(e.target.value)}
          placeholder="Verification code"
          className={inputCls}
          aria-label="Verification code"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal/20 px-4 py-2 text-sm font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify code"}
          </button>
          <button
            type="button"
            onClick={cancelMfa}
            disabled={busy}
            className="text-xs text-text-muted underline hover:text-text-secondary disabled:opacity-50"
          >
            Start over
          </button>
          {error && (
            <span className="text-xs text-danger" role="alert">
              {error}
            </span>
          )}
        </div>
      </form>
    );
  }

  // Step 1: email + password
  return (
    <form onSubmit={startLogin} className="space-y-3">
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
        aria-label="Garmin email"
      />
      <input
        type="password"
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Garmin password"
        className={inputCls}
        aria-label="Garmin password"
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
        Two-factor accounts are supported: after sign-in you&apos;ll be asked for
        a verification code. Sign-in runs through a proxy so it works on cloud
        deploys.
      </p>
    </form>
  );
}
