"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import AuthScreen, { Brand } from "./auth-screen";
import Workspace from "./workspace";
import { getClient } from "@/lib/supabase";
import { profileFor, loadData, pendingPairRequests } from "@/lib/data";
import { dayInZone, type Data, type PairRequest, type Profile } from "@/lib/types";
import { demoData } from "@/lib/demo";
import { pairRequestError } from "@/lib/pair-requests";
import { friendlyError } from "@/lib/errors";
import { OutgoingPairRequestList, PairRequestList } from "./pair-request-list";
export default function Hadzar() {
  const [client, setClient] = useState<SupabaseClient | null>(null),
    [user, setUser] = useState<User | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [data, setData] = useState<Data | null>(null),
    [requests, setRequests] = useState<PairRequest[]>([]),
    [requestsAvailable, setRequestsAvailable] = useState(true),
    [requestSent, setRequestSent] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [recovery, setRecovery] = useState(() =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("recovery") === "1",
    ),
    [demo, setDemo] = useState(false),
    [inviteAfterCreate, setInviteAfterCreate] = useState(false),
    [invite, setInvite] = useState(() =>
      typeof window === "undefined"
        ? ""
        : new URLSearchParams(window.location.search).get("invite") || "",
    ),
    [day, setDay] = useState(() =>
      typeof window === "undefined"
        ? ""
        : dayInZone(Intl.DateTimeFormat().resolvedOptions().timeZone),
    );
  const loadVersion = useRef(0);
  const identity = useRef<string | null>(null);
  const pairDayInitialized = useRef(false);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let active = true;
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
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
              pairDayInitialized.current = false;
              setData(null);
              setProfile(null);
              setRequests([]);
              setRequestsAvailable(true);
              setRequestSent(false);
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
      // This ref is a logical request counter, not a DOM ref. Incrementing it
      // invalidates any in-flight reload when the auth subscription unmounts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const [d, nextRequests] = p
          ? await Promise.all([loadData(client, day), pendingPairRequests(client)])
          : [null, { requests: [] as PairRequest[], available: true }];
        if (version !== loadVersion.current) return;
        if (d && !pairDayInitialized.current) {
          const pairDay = dayInZone(d.couple.timezone);
          pairDayInitialized.current = true;
          if (pairDay !== day) {
            setDay(pairDay);
            return;
          }
        }
        setProfile(p);
        setData(d);
        setRequests(nextRequests.requests);
        setRequestsAvailable(nextRequests.available);
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
    if (!user || recovery) return;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [user, recovery, reload]);
  useEffect(() => {
    if (!user || demo || recovery) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload(true);
    }, 8000);
    return () => clearInterval(timer);
  }, [user, demo, recovery, reload]);
  useEffect(() => {
    if (!client || !user || demo || recovery) return;
    const refresh = () => void reload(true);
    let channel = client.channel(`hadzar-live-${user.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "pair_requests",
        filter: `recipient_id=eq.${user.id}`,
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "pair_requests",
        filter: `sender_id=eq.${user.id}`,
      }, refresh);
    if (data?.couple.id) {
      for (const table of ["messages", "tasks", "events", "schedule_days", "notes"] as const) {
        channel = channel.on("postgres_changes", {
          event: "*",
          schema: "public",
          table,
          filter: `couple_id=eq.${data.couple.id}`,
        }, refresh);
      }
    }
    void channel.subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [client, user, demo, recovery, data?.couple.id, reload]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(friendlyError(e, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }
  async function respondToRequest(requestId: string, action: "accept" | "decline") {
    const r = await client!.rpc(
      action === "accept" ? "accept_pair_request" : "decline_pair_request",
      { request_id: requestId },
    );
    if (r.error) throw pairRequestError(r.error);
  }
  async function cancelPairRequest(requestId: string) {
    const r = await client!.rpc("cancel_pair_request", { request_id: requestId });
    if (r.error) throw pairRequestError(r.error);
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
          invite={invite}
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
          <p className="meta">Your nickname: @{profile?.nickname}</p>
          <section className="request-onboarding">
            <h2>Incoming requests</h2>
            {requestsAvailable ? <PairRequestList
              requests={requests.filter(request => request.recipient_id === user?.id && request.status === "pending")}
              busy={busy}
              onRespond={(id, action) => act(() => respondToRequest(id, action))}
            /> : <p className="muted">Partner requests are temporarily unavailable. You can still join by invitation link below.</p>}
            <h2>Sent requests</h2>
            <OutgoingPairRequestList
              requests={requests.filter(request => request.sender_id === user?.id)}
              busy={busy}
              onCancel={(id) => act(() => cancelPairRequest(id))}
            />
          </section>
          <form onSubmit={e => {
            e.preventDefault();
            const nickname = String(new FormData(e.currentTarget).get("partner_nickname")).trim().replace(/^@/, "").toLowerCase();
            setRequestSent(false);
            void act(async () => {
              const result = await client!.rpc("send_pair_request", { recipient_nickname: nickname });
              if (result.error) throw pairRequestError(result.error);
              setRequestSent(true);
            });
          }}>
            <label>Partner nickname<input name="partner_nickname" required pattern="@?[a-zA-Z0-9_]{3,24}" maxLength={25} placeholder="Your partner’s nickname" /></label>
            <button className="btn" disabled={busy || !requestsAvailable}>Send request</button>
            {(requestSent || requests.some(request => request.sender_id === user?.id && request.status === "pending")) && <p className="meta" role="status">Request sent. Your partner can accept it in their account.</p>}
          </form>
          <div className="or-line"><span>or create your space first</span></div>
          <button
            className="btn dark"
            disabled={busy}
            onClick={() => {
              setInviteAfterCreate(true);
              void act(async () => {
                const r = await client!.rpc("create_pair");
                if (r.error) throw r.error;
              });
            }}
          >
            Create our space & invite partner
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
      key={`${data.couple.id}:${data.couple.member_two || "solo"}`}
      data={data}
      setData={setData}
      userId={demo ? "azhar" : user!.id}
      day={day}
      setDay={setDay}
      demo={demo}
      client={client}
      reload={reload}
      error={error}
      requests={requests}
      requestsAvailable={requestsAvailable}
      onRequestAction={respondToRequest}
      openInviteOnStart={inviteAfterCreate && !data.couple.member_two}
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
