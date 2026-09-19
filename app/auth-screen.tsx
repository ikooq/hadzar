"use client";
import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
export function Brand() {
  return (
    <span className="brand-mark">
      <span className="mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span className="brand">hadzar</span>
    </span>
  );
}
export default function AuthScreen({
  client,
  recovery,
  invite,
  onRecovered,
  onPreview,
}: {
  client: SupabaseClient | null;
  recovery: boolean;
  invite?: string;
  onRecovered: () => void;
  onPreview: () => void;
}) {
  const [mode, setMode] = useState<"signup" | "login" | "forgot">("signup");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!client) {
      setError(
        "Registration is not open yet. You can explore the sample workspace below.",
      );
      return;
    }
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") || "").trim();
    const password = String(f.get("password") || "");
    try {
      if (recovery) {
        const r = await client.auth.updateUser({ password });
        if (r.error) throw r.error;
        setMessage("Your password has been updated.");
        onRecovered();
      } else if (mode === "signup") {
        const invite = new URLSearchParams(location.search).get("invite");
        const redirect =
          location.origin +
          (invite ? "/?invite=" + encodeURIComponent(invite) : "/");
        const r = await client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirect,
            data: {
              name: String(f.get("name")).trim(),
              nickname: String(f.get("nickname")).toLowerCase().trim(),
            },
          },
        });
        if (r.error) throw r.error;
        if (!r.data.session)
          setMessage(
            "Check your email to confirm your account, then come back to create or join your pair.",
          );
      } else if (mode === "forgot") {
        const r = await client.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + "/?recovery=1",
        });
        if (r.error) throw r.error;
        setMessage(
          "If an account exists for this email, a password reset link is on its way.",
        );
      } else {
        const r = await client.auth.signInWithPassword({ email, password });
        if (r.error) throw r.error;
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <div>
          <h1>
            Two full lives.
            <br />A little time, together.
          </h1>
          <p>
            A shared space for the moments you find, the promises you keep, and
            the everyday in between.
          </p>
          {invite && !recovery && (
            <p className="auth-invite-note">
              Your partner invited you. Sign in if you already have a hadzar
              account, or create one to join their space.
            </p>
          )}
          <div
            className="mini-day"
            aria-label="Example schedules for Azhar and Ilias"
          >
            <div className="mini-head">
              <span>Azhar</span>
              <span>Ilias</span>
            </div>
            <div className="mini-tracks">
              <span>12:00</span>
              <div>
                <p className="mini-block">Design review</p>
              </div>
              <div>
                <p className="mini-block second">Team meeting</p>
              </div>
            </div>
            <div className="mini-window">
              <strong>90 minutes together</strong>
              <span>13:30–15:00</span>
            </div>
            <div className="mini-tracks">
              <span>15:00</span>
              <div />
              <div />
            </div>
          </div>
        </div>
        <footer className="auth-footer">
          <span>Made for two. Room for everything.</span>
          <span>Time well shared.</span>
        </footer>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <div>
            <h2>
              {recovery
                ? "A fresh start."
                : mode === "signup"
                  ? "Make room for each other."
                  : mode === "forgot"
                    ? "Forgot your password?"
                    : "Welcome back."}
            </h2>
            <p className="muted" style={{ marginTop: 10 }}>
              {recovery
                ? "Choose a new password for your account."
                : mode === "signup"
                  ? "Start with your account. Invite your person next."
                  : mode === "forgot"
                    ? "We’ll send you a link to reset it."
                    : "Your shared space is waiting for you."}
            </p>
          </div>
          <form onSubmit={submit}>
            {mode === "signup" && !recovery && (
              <div className="form-row">
                <label>
                  Your name
                  <input
                    name="name"
                    required
                    maxLength={50}
                    placeholder="Azhar"
                    autoComplete="given-name"
                  />
                </label>
                <label>
                  Nickname
                  <input
                    name="nickname"
                    required
                    minLength={3}
                    maxLength={24}
                    pattern="[a-zA-Z0-9_]{3,24}"
                    title="3–24 letters, numbers or underscores"
                    placeholder="azhar"
                    autoComplete="nickname"
                  />
                </label>
              </div>
            )}
            {!recovery && (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </label>
            )}
            {(mode !== "forgot" || recovery) && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  placeholder="At least 8 characters"
                  autoComplete={
                    mode === "login" && !recovery
                      ? "current-password"
                      : "new-password"
                  }
                />
              </label>
            )}
            <button className="btn dark" disabled={busy} type="submit">
              {busy
                ? "Please wait…"
                : recovery
                  ? "Save new password"
                  : mode === "signup"
                    ? "Create your account"
                    : mode === "forgot"
                      ? "Send reset link"
                      : "Sign in"}
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          {!recovery && (
            <>
              <p className="meta">
                {mode === "signup"
                  ? "Already have an account?"
                  : "New to hadzar?"}{" "}
                <button
                  className="plain"
                  onClick={() => {
                    setMode(mode === "signup" ? "login" : "signup");
                    setError("");
                    setMessage("");
                  }}
                >
                  {mode === "signup" ? "Sign in" : "Create an account"}
                </button>
              </p>
              {mode === "login" && (
                <button className="plain" onClick={() => setMode("forgot")}>
                  Forgot password?
                </button>
              )}
            </>
          )}
          {!client && (
            <div className="preview-entry">
              <p className="meta">Account registration is being connected.</p>
              <button className="plain" onClick={onPreview}>
                Explore the sample workspace
              </button>
            </div>
          )}
          <p className="auth-foot">
            Your own login. One shared space. Only you and your partner can see
            what you share.
          </p>
        </div>
      </section>
    </main>
  );
}
