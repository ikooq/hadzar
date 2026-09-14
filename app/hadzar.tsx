"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import AuthScreen, { Brand } from "./auth-screen";
import Workspace from "./workspace";
import { getClient } from "@/lib/supabase";
import { profileFor, loadData } from "@/lib/data";
import { dayInZone, type Data, type Profile } from "@/lib/types";
import { demoData } from "@/lib/demo";
export default function Hadzar() {
  const [client, setClient] = useState<SupabaseClient | null>(null),
    [user, setUser] = useState<User | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [data, setData] = useState<Data | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [recovery, setRecovery] = useState(false),
    [demo, setDemo] = useState(false),
    [invite, setInvite] = useState(""),
    [day, setDay] = useState("");
  const loadVersion = useRef(0);
  const identity = useRef<string | null>(null);
  useEffect(() => {
    setDay(dayInZone(Intl.DateTimeFormat().resolvedOptions().timeZone));
    setInvite(new URLSearchParams(location.search).get("invite") || "");
    let unsub: (() => void) | undefined;
    let active = true;
    getClient()
      .then(async (c) => {
        if (!active) return;
        setClient(c);
        if (!c) {
          setLoading(false);
          return;
        }
        const { data: listener } = c.auth.onAuthStateChange(
          (event, session) => {
            if (event === "SIGNED_IN" && identity.current !== session?.user.id)
              setLoading(true);
            identity.current = session?.user.id ?? null;
            setUser(session?.user ?? null);
            if (event === "PASSWORD_RECOVERY") {
              setRecovery(true);
              setLoading(false);
            }
            if (event === "SIGNED_OUT") {
              loadVersion.current++;
              setData(null);
              setProfile(null);
            }
          },
        );
        unsub = () => listener.subscription.unsubscribe();
        const s = await c.auth.getSession();
        if (active) {
          setUser(s.data.session?.user ?? null);
          if (!s.data.session) setLoading(false);
        }
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
    return () => {
      active = false;
      loadVersion.current++;
      unsub?.();
    };
  }, []);
  const reload = useCallback(
    async (quiet = false) => {
      if (!client || !user || demo || !day) return;
      const version = ++loadVersion.current;
      try {
        const p = await profileFor(client, user.id);
        const d = p ? await loadData(client, day) : null;
        if (version !== loadVersion.current) return;
        setProfile(p);
        setData(d);
        setError("");
      } catch (e) {
        if (version === loadVersion.current)
          setError(
            (e as { message?: string }).message ||
              "We could not load your space. Please try again.",
          );
      } finally {
        if (!quiet && version === loadVersion.current) setLoading(false);
      }
    },
    [client, user, demo, day],
  );
  useEffect(() => {
    if (user && !recovery) void reload();
  }, [user, recovery, reload]);
  useEffect(() => {
    if (!user || demo || recovery) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload(true);
    }, 8000);
    return () => clearInterval(timer);
  }, [user, demo, recovery, reload]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : (e as { message?: string })?.message ||
              "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function preview() {
    const today = dayInZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setDay(today);
    setData(demoData(today));
    setProfile({ id: "azhar", name: "Azhar", nickname: "azhar" });
    setDemo(true);
    setLoading(false);
    setError("");
  }
  if (loading)
    return (
      <main className="loading-page">
        <Brand />
        <p className="muted">Opening your space…</p>
      </main>
    );
  if ((!user || recovery) && !demo)
    return (
      <>
        <AuthScreen
          client={client}
          recovery={recovery}
          onRecovered={() => {
            setRecovery(false);
            history.replaceState(null, "", "/");
          }}
          onPreview={preview}
        />
        {error && (
          <div className="global-error" role="alert">
            {error}
            <button className="plain" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        )}
      </>
    );
  if (!profile && !demo)
    return (
      <main className="onboarding">
        <Brand />
        <div className="onboard-card">
          <h1>A name to call you.</h1>
          <p className="muted">
            This is how you’ll appear in your shared space.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(async () => {
                const r = await client!
                  .from("profiles")
                  .insert({
                    id: user!.id,
                    name: String(f.get("name")).trim(),
                    nickname: String(f.get("nickname")).toLowerCase().trim(),
                  });
                if (r.error)
                  throw new Error(
                    r.error.code === "23505"
                      ? "That nickname is already taken. Try another."
                      : r.error.message,
                  );
              });
            }}
          >
            <label>
              Your name
              <input
                name="name"
                required
                maxLength={50}
                defaultValue={user?.user_metadata.name || ""}
              />
            </label>
            <label>
              Nickname
              <input
                name="nickname"
                required
                pattern="[a-zA-Z0-9_]{3,24}"
                title="3–24 letters, numbers or underscores"
                defaultValue={user?.user_metadata.nickname || ""}
              />
            </label>
            <button className="btn dark" disabled={busy}>
              Continue
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="plain" onClick={() => client?.auth.signOut()}>
            Sign out
          </button>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="onboarding">
        <Brand />
        <div className="onboard-card">
          <span className="avatar a">{profile?.name[0]}</span>
          <h1>Hello, {profile?.name}.</h1>
          <p className="muted">
            Every shared day starts with two people. Create your space, or join
            your partner’s.
          </p>
          <button
            className="btn dark"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await client!.rpc("create_pair");
                if (r.error) throw r.error;
              })
            }
          >
            Create our space
          </button>
          <div className="or-line">
            <span>or join with an invitation</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                let code = invite.trim();
                try {
                  code = new URL(code).searchParams.get("invite") || code;
                } catch {}
                const r = await client!.rpc("join_pair", { invite_code: code });
                if (r.error) throw r.error;
                history.replaceState(null, "", "/");
              });
            }}
          >
            <label>
              Invitation link or code
              <input
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                required
                placeholder="Paste your partner’s invitation"
              />
            </label>
            <button className="btn" disabled={busy}>
              Join our space
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="plain" onClick={() => client?.auth.signOut()}>
            Sign out
          </button>
        </div>
      </main>
    );
  return (
    <Workspace
      data={data}
      setData={setData}
      userId={demo ? "azhar" : user!.id}
      day={day}
      setDay={setDay}
      demo={demo}
      client={client}
      reload={reload}
      error={error}
      onExit={() => {
        if (demo) {
          setDemo(false);
          setData(null);
          setProfile(null);
        } else void client?.auth.signOut();
      }}
    />
  );
}
