"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { Brand } from "./auth-screen";
import { toast } from "sonner";

type MfaFactor = {
  id: string;
  friendly_name?: string | null;
  factor_type: string;
  status: "verified" | "unverified";
};

function qrSource(value: string) {
  return value.startsWith("data:")
    ? value
    : `data:image/svg+xml;utf8,${encodeURIComponent(value)}`;
}

export function MfaSettings({ client }: { client: SupabaseClient }) {
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [setup, setSetup] = useState<{ id: string; qr: string; secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadFactors() {
    const result = await client.auth.mfa.listFactors();
    if (result.error) throw result.error;
    setFactors((result.data.all || []) as MfaFactor[]);
  }

  useEffect(() => {
    let active = true;
    void client.auth.mfa.listFactors().then((result) => {
      if (!active) return;
      if (result.error) setError(result.error.message);
      else setFactors((result.data.all || []) as MfaFactor[]);
      setLoading(false);
    });
    return () => { active = false; };
  }, [client]);

  async function beginSetup() {
    setBusy(true);
    setError("");
    try {
      for (const factor of factors.filter((item) => item.status === "unverified")) {
        await client.auth.mfa.unenroll({ factorId: factor.id });
      }
      const result = await client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Hadzar authenticator",
      });
      if (result.error) throw result.error;
      if (!result.data.totp?.qr_code || !result.data.totp.secret || !result.data.totp.uri) {
        throw new Error("Supabase did not return an authenticator setup code.");
      }
      setSetup({
        id: result.data.id,
        qr: result.data.totp.qr_code,
        secret: result.data.totp.secret,
        uri: result.data.totp.uri,
      });
      setCode("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start MFA setup.");
    } finally {
      setBusy(false);
    }
  }

  async function verifySetup() {
    if (!setup || !/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const challenge = await client.auth.mfa.challenge({ factorId: setup.id });
      if (challenge.error) throw challenge.error;
      const result = await client.auth.mfa.verify({
        factorId: setup.id,
        challengeId: challenge.data.id,
        code,
      });
      if (result.error) throw result.error;
      setSetup(null);
      setCode("");
      await loadFactors();
      toast.success("Authenticator enabled");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That code could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  async function removeFactor(id: string) {
    if (!window.confirm("Remove this authenticator from your account?")) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.auth.mfa.unenroll({ factorId: id });
      if (result.error) throw result.error;
      await loadFactors();
      toast.success("Authenticator removed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove the authenticator.");
    } finally {
      setBusy(false);
    }
  }

  const verified = factors.filter((factor) => factor.status === "verified");

  return (
    <section className="settings-form">
      <h2>Sign-in security</h2>
      <p className="meta">Add an authenticator app as a second step after your password. This is optional and can be removed from here.</p>
      {loading ? <p className="meta">Checking security settings…</p> : verified.length > 0 ? (
        <div className="account-actions">
          {verified.map((factor) => (
            <div className="pair-members" key={factor.id}>
              <div>
                <span className="avatar a"><ShieldCheck size={16} /></span>
                <span>{factor.friendly_name || "Authenticator app"}<small>Authenticator enabled</small></span>
              </div>
              <button type="button" className="plain danger-action" disabled={busy} onClick={() => void removeFactor(factor.id)}>
                <ShieldOff size={15} /> Remove
              </button>
            </div>
          ))}
        </div>
      ) : !setup ? (
        <button type="button" className="btn" disabled={busy} onClick={() => void beginSetup()}>
          <KeyRound size={15} /> Set up authenticator
        </button>
      ) : (
        <div className="mfa-setup">
          <p>Scan this QR code with 1Password, Authy, Google Authenticator, or Apple Passwords.</p>
          {/* Supabase returns the TOTP QR code as SVG/data content; Next image optimization is not applicable here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mfa-qr" src={qrSource(setup.qr)} alt="QR code for your authenticator app" />
          <p className="meta">Can’t scan it? Enter this secret manually:</p>
          <code className="mfa-secret">{setup.secret}</code>
          <p className="meta">The setup URI is also available for manual entry: <span className="mfa-uri">{setup.uri}</span></p>
          <label>
            Six-digit code
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
          </label>
          <div className="account-actions">
            <button type="button" className="btn dark" disabled={busy} onClick={() => void verifySetup()}>Verify and enable</button>
            <button type="button" className="plain" disabled={busy} onClick={() => setSetup(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export function MfaChallenge({ client, onVerified }: { client: SupabaseClient; onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function verify() {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const factors = await client.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      const factor = factors.data.totp.find((item) => item.status === "verified");
      if (!factor) throw new Error("No verified authenticator was found for this account.");
      const challenge = await client.auth.mfa.challenge({ factorId: factor.id });
      if (challenge.error) throw challenge.error;
      const result = await client.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code });
      if (result.error) throw result.error;
      onVerified();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That code could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="loading-page mfa-challenge-page">
      <Brand />
      <section className="mfa-challenge-card">
        <h1>One more step.</h1>
        <p className="muted">Enter the six-digit code from your authenticator app to open your shared space.</p>
        <label>
          Authenticator code
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        </label>
        <button className="btn dark" disabled={busy} onClick={() => void verify()}>{busy ? "Checking…" : "Continue"}</button>
        <button className="plain" disabled={busy} onClick={() => void client.auth.signOut()}>Sign out</button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
