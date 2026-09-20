"use client";
import {
  Fragment,
  useState,
  useEffect,
  useRef,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type FormEvent,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CalendarDays,
  ListChecks,
  ReceiptText,
  StickyNote,
  MessageCircle,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Check,
  Pin,
  Send,
  LogOut,
  Copy,
  Download,
  KeyRound,
  CalendarPlus,
  WifiOff,
  Trash2,
  Users,
  Link2,
  CheckCheck,
  ArrowUpRight,
  Bell,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Brand } from "./auth-screen";
import {
  time,
  minutes,
  money,
  duration,
  overdue,
  dayInZone,
  type Data,
  type DayEvent,
  type Task,
  type Note,
  type Message,
  type PairRequest,
} from "@/lib/types";
import { sharedWindows } from "@/lib/schedule";
import { pairRequestError } from "@/lib/pair-requests";
import { friendlyError } from "@/lib/errors";
import { OutgoingPairRequestList, PairRequestList } from "./pair-request-list";

type View = "schedule" | "tasks" | "penalties" | "notes" | "chat" | "settings";
type WeekCandidate = { day: string; start: number; end: number };
type LocalNotice = { id: string; title: string; body: string; at: number; read?: boolean };
type QueuedMessage = { id: string; body: string; created_at: string };
type Modal = {
  kind: "event" | "task" | "note" | "invite" | "plan" | "request" | "requests";
  note?: Note;
  event?: DayEvent;
  start?: number;
  end?: number;
} | null;
type Props = {
  data: Data;
  setData: Dispatch<SetStateAction<Data | null>>;
  userId: string;
  day: string;
  setDay: (d: string) => void;
  demo: boolean;
  client: SupabaseClient | null;
  reload: (quiet?: boolean) => Promise<void>;
  error: string;
  onExit: () => void;
  requests: PairRequest[];
  requestsAvailable: boolean;
  onRequestAction: (requestId: string, action: "accept" | "decline") => Promise<void>;
  openInviteOnStart?: boolean;
};
const nav = [
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "tasks", label: "Commitments", icon: ListChecks },
  { id: "penalties", label: "Penalties", icon: ReceiptText },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "settings", label: "Settings", icon: Settings },
] as const;
function Choice({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label>
      {label}
      <Select name={name} defaultValue={value}>
        <SelectTrigger className="choice">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
export default function Workspace({
  data,
  setData,
  userId,
  day,
  setDay,
  demo,
  client,
  reload,
  error,
  onExit,
  requests,
  requestsAvailable,
  onRequestAction,
  openInviteOnStart = false,
}: Props) {
  const [view, setView] = useState<View>("schedule"),
    [modal, setModal] = useState<Modal>(() =>
      openInviteOnStart ? { kind: "invite" } : null,
    ),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [filter, setFilter] = useState("active"),
    [noteSearch, setNoteSearch] = useState(""),
    [draft, setDraft] = useState(""),
    [inviteLink, setInviteLink] = useState(""),
    [chosenWindow, setChosenWindow] = useState(0),
    [now, setNow] = useState(() => Date.now()),
    [older, setOlder] = useState<Message[]>([]),
    [hasOlder, setHasOlder] = useState(true),
    [chatBusy, setChatBusy] = useState(false),
    [weekCandidates, setWeekCandidates] = useState<WeekCandidate[]>([]),
    [weekLoading, setWeekLoading] = useState(false),
    [noticeOpen, setNoticeOpen] = useState(false),
    [notices, setNotices] = useState<LocalNotice[]>([]),
    [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>(() => {
      if (typeof window === "undefined") return [];
      try { return JSON.parse(localStorage.getItem(`hadzar-outbox-${data.couple.id}`) || "[]"); } catch { return []; }
    }),
    [setupOpen, setSetupOpen] = useState(() =>
      typeof window !== "undefined" && !localStorage.getItem(`hadzar-setup-${data.couple.id}`),
    );
  const [accountError, setAccountError] = useState("");
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const chatEnd = useRef<HTMLDivElement>(null),
    chatScroll = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true),
    noticeSnapshot = useRef<{ latestMessage: string; pendingRequests: number; tasks: Record<string, string> } | null>(null);
  const couple = data.couple,
    me = data.profiles.find((p) => p.id === userId)!,
    partner = data.profiles.find((p) => p.id !== userId),
    names = data.profiles.map((p) => p.name).join(" & ");
  const allEvents = data.events.filter((e) => e.day === day),
    ready = data.ready.filter((r) => r.day === day),
    bothReady = !!partner && ready.length === 2,
    windows = bothReady ? sharedWindows(allEvents, couple) : [],
    myReady = ready.some((r) => r.user_id === userId),
    shared = allEvents.filter((e) => e.shared);
  const name = useCallback(
    (id: string) => data.profiles.find((p) => p.id === id)?.name || "Your partner",
    [data.profiles],
  );
  const color = (id: string) => (id === couple.member_one ? "a" : "b");
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(day + "T12:00:00Z"));
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: couple.timezone,
    }).format(new Date(value));
  const chatDayKey = (value: string | number) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: couple.timezone,
    }).formatToParts(new Date(value));
    const part = (type: string) =>
      parts.find((item) => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const chatDateLabel = (value: string) => {
    const key = chatDayKey(value),
      today = chatDayKey(now),
      todayParts = today.split("-").map(Number),
      yesterdayDate = new Date(
        Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]),
      );
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);
    if (key === today) return "Today";
    if (key === yesterday) return "Yesterday";
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: couple.timezone,
    }).format(new Date(value));
  };
  const activeTasks = data.tasks.filter(
      (t) => !t.completed_at && !t.declined_at && !t.cancelled_at,
    ),
    fees = data.tasks.filter(
      (t) => overdue(t, now) && t.penalty > 0 && !t.waived_at && !t.cancelled_at && !t.declined_at,
    ),
    unpaid = fees.filter((t) => !t.paid_at);
  const visibleNotes = data.notes.filter((n) =>
    (n.title + " " + n.body).toLowerCase().includes(noteSearch.toLowerCase()),
  );
  const incomingRequests = requests.filter((request) => request.recipient_id === userId && request.status === "pending");
  const outgoingRequests = requests.filter((request) => request.sender_id === userId);
  const messages = [...older, ...data.messages].filter(
    (m, i, a) => a.findIndex((x) => x.id === m.id) === i,
  );
  const readMarker = data.messageReads.find((entry) => entry.user_id === userId)?.last_read_at;
  const unreadMessages = messages.filter(
    (message) => message.sender_id !== userId && (!readMarker || message.created_at > readMarker),
  ).length;
  const notificationItems = [
    ...data.notifications.map((notice) => ({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      at: Date.parse(notice.created_at),
      read: !!notice.read_at,
      persistent: true,
    })),
    ...notices
      .filter((notice) => !data.notifications.some((item) => item.id === notice.id))
      .map((notice) => ({ ...notice, persistent: false })),
  ].sort((a, b) => b.at - a.at);
  const unreadNotificationCount = notificationItems.filter((notice) => !notice.read).length;
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = `hadzar-note-reminders-${couple.id}`;
    let delivered: string[] = [];
    try { delivered = JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { delivered = []; }
    const deliveredSet = new Set(delivered);
    const due = data.notes.filter((note) => note.remind_at && Date.parse(note.remind_at) <= now && !deliveredSet.has(note.id));
    if (!due.length) return;
    const fresh = due.map((note) => ({
      id: `note-reminder-${note.id}`,
      title: `Reminder: ${note.title}`,
      body: note.body || "You saved this for later.",
      at: Date.now(),
    }));
    queueMicrotask(() => setNotices((current) => [...fresh, ...current.filter((notice) => !fresh.some((item) => item.id === notice.id))]));
    const next = [...delivered, ...due.map((note) => note.id)].slice(-100);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }, [couple.id, data.notes, now]);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(`hadzar-outbox-${couple.id}`, JSON.stringify(queuedMessages));
  }, [couple.id, queuedMessages]);
  useEffect(() => {
    if (!online || demo || !client || !queuedMessages.length) return;
    let active = true;
    void (async () => {
      const remaining: QueuedMessage[] = [];
      for (const message of queuedMessages) {
        const result = await client.from("messages").insert({ couple_id: couple.id, sender_id: userId, body: message.body });
        if (result.error) remaining.push(message);
      }
      if (active) {
        if (remaining.length !== queuedMessages.length) {
          setQueuedMessages(remaining);
          await reload(true);
          toast.success("Offline messages synced");
        }
      }
    })();
    return () => { active = false; };
  }, [online, demo, client, couple.id, userId, queuedMessages, reload]);
  useEffect(() => {
    if (nearBottom.current)
      chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [data.messages.length, view]);
  useEffect(() => {
    if (view !== "chat" || !messages.length || demo) return;
    const latest = messages[messages.length - 1]?.created_at;
    if (!latest || (readMarker && latest <= readMarker)) return;
    void client!
      .from("message_reads")
      .upsert(
        { couple_id: couple.id, user_id: userId, last_read_at: latest },
        { onConflict: "couple_id,user_id" },
      )
      .then((result) => {
        if (result.error) return;
        setData((current) => (current ? {
          ...current,
          messageReads: [
            ...current.messageReads.filter((entry) => entry.user_id !== userId),
            { couple_id: couple.id, user_id: userId, last_read_at: latest },
          ],
        } : current));
      });
  // The message array is intentionally included so a newly received message is marked read.
  }, [view, messages.length, demo, client, couple.id, userId, readMarker, messages, setData]);
  useEffect(() => {
    const onlineNow = () => setOnline(true);
    const offlineNow = () => setOnline(false);
    window.addEventListener("online", onlineNow);
    window.addEventListener("offline", offlineNow);
    return () => {
      window.removeEventListener("online", onlineNow);
      window.removeEventListener("offline", offlineNow);
    };
  }, []);
  useEffect(() => {
    if (view !== "schedule") return;
    const dateForOffset = (offset: number) => {
      const date = new Date(day + "T12:00:00Z");
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const days = Array.from({ length: 7 }, (_, index) => dateForOffset(index));
    let active = true;
    if (demo) {
      queueMicrotask(() => {
        if (active) {
          const currentDayEvents = data.events.filter((event) => event.day === day);
          setWeekCandidates(
            data.ready.filter((r) => r.day === day).length === 2
              ? sharedWindows(currentDayEvents, couple).map((window) => ({ day, ...window }))
              : [],
          );
        }
      });
      return () => { active = false; };
    }
    if (!client || !couple.id || !online) return;
    queueMicrotask(() => {
      if (active) setWeekLoading(true);
    });
    void Promise.all([
      client.from("events").select("*").eq("couple_id", couple.id).gte("day", days[0]).lte("day", days[days.length - 1]),
      client.from("schedule_days").select("*").eq("couple_id", couple.id).gte("day", days[0]).lte("day", days[days.length - 1]),
    ]).then(([eventResult, readyResult]) => {
      if (!active) return;
      if (eventResult.error || readyResult.error) {
        setWeekCandidates([]);
        return;
      }
      const candidates = days.flatMap((candidateDay) => {
        const readyForDay = (readyResult.data || []).filter((entry) => entry.day === candidateDay);
        if (readyForDay.length !== 2) return [];
        return sharedWindows(
          (eventResult.data || []).filter((event) => event.day === candidateDay),
          couple,
        ).map((window) => ({ day: candidateDay, ...window }));
      });
      candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.day.localeCompare(b.day) || a.start - b.start);
      setWeekCandidates(candidates.slice(0, 3));
    }).catch(() => {
      if (active) setWeekCandidates([]);
    }).finally(() => {
      if (active) setWeekLoading(false);
    });
    return () => { active = false; };
  }, [view, day, couple, client, demo, online, data.ready, data.events]);
  useEffect(() => {
    const taskState = Object.fromEntries(
      data.tasks.map((task) => [task.id, `${task.accepted_at || ""}|${task.completed_at || ""}|${task.confirmed_at || ""}|${task.declined_at || ""}|${task.cancelled_at || ""}`]),
    );
    const latestMessage = data.messages[data.messages.length - 1];
    const next = {
      latestMessage: latestMessage?.id || "",
      pendingRequests: incomingRequests.length,
      tasks: taskState,
    };
    const previous = noticeSnapshot.current;
    noticeSnapshot.current = next;
    if (!previous || demo) return;
    const fresh: LocalNotice[] = [];
    if (next.pendingRequests > previous.pendingRequests) {
      fresh.push({ id: crypto.randomUUID(), title: "A new partner request", body: "Someone is waiting for your answer.", at: Date.now() });
    }
    if (latestMessage && latestMessage.id !== previous.latestMessage && latestMessage.sender_id !== userId) {
      fresh.push({ id: crypto.randomUUID(), title: `A message from ${name(latestMessage.sender_id)}`, body: latestMessage.body, at: Date.now() });
    }
    for (const task of data.tasks) {
      const before = previous.tasks[task.id];
      const after = taskState[task.id];
      if (!before || before === after) continue;
      if (!task.accepted_at && task.declined_at) fresh.push({ id: crypto.randomUUID(), title: "A commitment was declined", body: task.title, at: Date.now() });
      else if (task.completed_at && !before.includes(task.completed_at)) fresh.push({ id: crypto.randomUUID(), title: `${name(task.assignee_id)} marked a promise complete`, body: task.title, at: Date.now() });
      else if (task.confirmed_at && !before.includes(task.confirmed_at)) fresh.push({ id: crypto.randomUUID(), title: "Completion confirmed", body: task.title, at: Date.now() });
      else if (task.accepted_at && !before.includes(task.accepted_at)) fresh.push({ id: crypto.randomUUID(), title: "A commitment was accepted", body: task.title, at: Date.now() });
    }
    if (fresh.length) queueMicrotask(() => setNotices((current) => [...fresh, ...current].slice(0, 12)));
  }, [data.messages, data.tasks, incomingRequests.length, demo, userId, name]);
  function changeDay(next: string) {
    setChosenWindow(0);
    setDay(next);
  }
  function finishSetup() {
    if (typeof window !== "undefined") localStorage.setItem(`hadzar-setup-${couple.id}`, "done");
    setSetupOpen(false);
  }
  function openModal(next: Exclude<Modal, null>) {
    setFormError("");
    setModal(next);
  }
  useEffect(() => {
    const registry = (
      document as unknown as {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => void;
        };
      }
    ).modelContext;
    if (!registry) return;
    const lifecycle = new AbortController();
    try {
      registry.registerTool(
        {
          name: "open_hadzar_section",
          title: "Open a hadzar section",
          description:
            "Navigate the visible shared workspace without changing saved data.",
          inputSchema: {
            type: "object",
            properties: {
              section: { type: "string", enum: nav.map((n) => n.id) },
            },
            required: ["section"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute: (input: unknown) => {
            const section = (input as { section?: string })?.section;
            if (!nav.some((n) => n.id === section))
              throw new Error("Unknown section");
            setView(section as View);
            return { section };
          },
        },
        { signal: lifecycle.signal },
      );
    } catch {}
    return () => lifecycle.abort();
  }, []);
  async function perform(
    fn: () => Promise<void>,
    success?: string,
    close = true,
  ) {
    if (busy) return false;
    if (!demo && !online) {
      const message = "You’re offline. Reconnect before saving changes.";
      setFormError(message);
      toast.error(message);
      return false;
    }
    setBusy(true);
    setFormError("");
    try {
      await fn();
      if (!demo) await reload();
      if (close) setModal(null);
      if (success) toast.success(demo ? "Sample updated · not saved" : success);
      return true;
    } catch (e) {
      const message =
        friendlyError(e, "Could not save. Please try again.");
      setFormError(message);
      toast.error(message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function checked(p: PromiseLike<{ error: unknown }>) {
    const r = await p;
    if (r.error) {
      const issue = r.error as { code?: string; message?: string };
      throw new Error(friendlyError(issue));
    }
  }
  function update(fn: (d: Data) => Data) {
    setData((d) => (d ? fn(d) : d));
  }
  function moveDay(delta: number) {
    const d = new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    changeDay(d.toISOString().slice(0, 10));
  }
  async function toggleReady() {
    await perform(
      async () => {
        if (demo) {
          update((d) => ({
            ...d,
            ready: myReady
              ? d.ready.filter((r) => !(r.user_id === userId && r.day === day))
              : [...d.ready, { couple_id: couple.id, user_id: userId, day }],
          }));
          return;
        }
        if (myReady)
          await checked(
            client!
              .from("schedule_days")
              .delete()
              .eq("user_id", userId)
              .eq("day", day),
          );
        else
          await checked(
            client!
              .from("schedule_days")
              .insert({ couple_id: couple.id, user_id: userId, day }),
          );
      },
      myReady ? "Schedule marked as unconfirmed" : "Your schedule is confirmed",
      false,
    );
  }
  async function taskAction(t: Task, action: string) {
    await perform(
      async () => {
        if (demo) {
          update((d) => ({
            ...d,
            tasks:
              d.tasks.map((x) => {
                if (x.id !== t.id) return x;
                const stamp = new Date().toISOString();
                if (action === "decline") return { ...x, declined_at: stamp };
                if (action === "cancel") return { ...x, cancelled_at: stamp };
                if (action === "waive") return { ...x, waived_at: stamp };
                return {
                  ...x,
                  [action === "accept"
                    ? "accepted_at"
                    : action === "complete"
                      ? "completed_at"
                      : action === "confirm"
                        ? "confirmed_at"
                        : "paid_at"]: stamp,
                };
              }),
          }));
          return;
        }
        await checked(client!.rpc("act_on_task", { task_id: t.id, action }));
      },
      action === "paid"
        ? "Payment recorded. No money was transferred."
        : action === "complete"
          ? "Promise kept."
          : action === "accept"
            ? "Commitment accepted"
            : action === "confirm"
              ? "Completion confirmed"
              : action === "cancel"
                ? "Commitment cancelled"
                : action === "waive"
                  ? "Penalty waived"
              : "Invitation declined",
      false,
    );
  }
  async function cancelRequest(requestId: string) {
    await perform(
      async () => {
        const result = await client!.rpc("cancel_pair_request", { request_id: requestId });
        if (result.error) throw pairRequestError(result.error);
      },
      "Request cancelled",
      false,
    );
  }
  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || chatBusy) {
      return;
    }
    if (!online && !demo) {
      setQueuedMessages((current) => [...current, { id: crypto.randomUUID(), body, created_at: new Date().toISOString() }]);
      setDraft("");
      toast.success("Saved to your outbox · it will send when you reconnect.");
      return;
    }
    setChatBusy(true);
    try {
      if (demo)
        update((d) => ({
          ...d,
          messages: [
            ...d.messages,
            {
              id: crypto.randomUUID(),
              couple_id: couple.id,
              sender_id: userId,
              body,
              created_at: new Date().toISOString(),
            },
          ],
        }));
      else {
        await checked(
          client!
            .from("messages")
            .insert({ couple_id: couple.id, sender_id: userId, body }),
        );
        await reload(true);
      }
      setDraft("");
      nearBottom.current = true;
    } catch (e) {
      toast.error(
        (e as { message?: string }).message ||
          "Message not sent. Please try again.",
      );
    } finally {
      setChatBusy(false);
    }
  }
  async function olderMessages() {
    if (demo) {
      setHasOlder(false);
      return;
    }
    const first = messages[0];
    if (!first) return;
    setChatBusy(true);
    try {
      const r = await client!
        .from("messages")
        .select("*")
        .eq("couple_id", couple.id)
        .lt("created_at", first.created_at)
        .order("created_at", { ascending: false })
        .limit(100);
      if (r.error) throw r.error;
      setOlder((v) => [...r.data.reverse(), ...v]);
      setHasOlder(r.data.length === 100);
    } catch {
      toast.error("Could not load earlier messages.");
    } finally {
      setChatBusy(false);
    }
  }
  async function makeInvite() {
    await perform(
      async () => {
        if (demo) {
          setInviteLink("");
          toast.info("Invitations are available in your own registered space.");
          return;
        }
        const r = await client!.rpc("create_invitation");
        if (r.error) throw r.error;
        setInviteLink(location.origin + "/?invite=" + r.data);
      },
      undefined,
      false,
    );
  }
  async function respondToRequest(requestId: string, action: "accept" | "decline") {
    await perform(() => onRequestAction(requestId, action), action === "accept" ? "You’re connected. Welcome to your shared space." : "Request declined");
  }
  async function saveModal(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await perform(async () => {
      if (modal?.kind === "event") {
        const start = minutes(String(f.get("start"))),
          end = minutes(String(f.get("end")));
        if (end <= start)
          throw new Error("The end time must be after the start time.");
        const title = String(f.get("title")).trim();
        const repeat = String(f.get("repeat") || "none");
        const days = [day];
        const date = new Date(day + "T12:00:00Z");
        const count = repeat === "daily" ? 6 : repeat === "weekdays" ? 13 : repeat === "weekly" ? 21 : 0;
        for (let i = 1; i <= count; i++) {
          const next = new Date(date);
          next.setUTCDate(next.getUTCDate() + i);
          if (repeat === "weekdays" && [0, 6].includes(next.getUTCDay())) continue;
          if (repeat === "weekly" && i % 7 !== 0) continue;
          days.push(next.toISOString().slice(0, 10));
        }
        const seriesId = repeat === "none" ? null : crypto.randomUUID();
        const records = days.map((eventDay) => ({
          id: crypto.randomUUID(),
          couple_id: couple.id,
          user_id: userId,
          day: eventDay,
          title,
          start_min: start,
          end_min: end,
          shared: false,
          series_id: seriesId,
          series_rule: repeat === "none" ? null : repeat,
        }));
        if (demo) update((d) => ({ ...d, events: [...d.events, ...records] }));
        else await checked(client!.from("events").insert(records));
      }
      if (modal?.kind === "plan") {
        const record = {
          id: crypto.randomUUID(),
          couple_id: couple.id,
          user_id: userId,
          day,
          title: String(f.get("title")).trim(),
          start_min: modal.start!,
          end_min: modal.end!,
          shared: true,
          plan_status: "proposed" as const,
          plan_note: "",
        };
        if (demo) update((d) => ({ ...d, events: [...d.events, record] }));
        else {
          const hold = await client!.rpc("hold_window", {
            event_day: day,
            start_at: record.start_min,
            end_at: record.end_min,
            hold_minutes: 10,
          });
          if (hold.error) throw hold.error;
          try {
            await checked(
              client!.rpc("propose_window", {
                event_day: day,
                start_at: record.start_min,
                end_at: record.end_min,
                event_title: record.title,
                event_note: "",
              }),
            );
          } finally {
            if (hold.data) await client!.rpc("release_window", { hold_id: hold.data });
          }
        }
      }
      if (modal?.kind === "note") {
        const record = {
          title: String(f.get("title")).trim(),
          body: String(f.get("body")).trim(),
          pinned: f.get("pinned") === "on",
          visibility: String(f.get("visibility") || "shared") as "shared" | "private",
          remind_at: String(f.get("remind_at") || "")
            ? new Date(String(f.get("remind_at"))).toISOString()
            : null,
        };
        if (demo) {
          update((d) => ({
            ...d,
            notes: modal.note
              ? d.notes.map((n) =>
                  n.id === modal.note!.id ? { ...n, ...record } : n,
                )
              : [
                  {
                    ...record,
                    id: crypto.randomUUID(),
                    couple_id: couple.id,
                    author_id: userId,
                    created_at: new Date().toISOString(),
                  },
                  ...d.notes,
                ],
          }));
        } else if (modal.note)
          await checked(
            client!.from("notes").update(record).eq("id", modal.note.id),
          );
        else
          await checked(
            client!
              .from("notes")
              .insert({ ...record, couple_id: couple.id, author_id: userId }),
          );
      }
      if (modal?.kind === "task") {
        const due_at = new Date(String(f.get("due"))).toISOString();
        if (Date.parse(due_at) <= Date.now())
          throw new Error("Choose a future deadline.");
        const assignee_id = String(f.get("assignee"));
        const record = {
          id: crypto.randomUUID(),
          couple_id: couple.id,
          creator_id: userId,
          assignee_id,
          title: String(f.get("title")).trim(),
          description: String(f.get("description")).trim(),
          penalty: Number(f.get("penalty")),
          due_at,
          accepted_at: assignee_id === userId ? new Date().toISOString() : null,
          completed_at: null,
          confirmed_at: assignee_id === userId ? new Date().toISOString() : null,
          paid_at: null,
          declined_at: null,
          cancelled_at: null,
          waived_at: null,
          created_at: new Date().toISOString(),
        };
        if (demo) update((d) => ({ ...d, tasks: [...d.tasks, record] }));
        else
          await checked(
            client!.rpc("add_task", {
              task_title: record.title,
              task_description: record.description,
              assigned_to: assignee_id,
              deadline: due_at,
              fee: record.penalty,
            }),
          );
      }
      if (modal?.kind === "request") {
        const nickname = String(f.get("nickname")).trim().replace(/^@/, "").toLowerCase();
        if (!nickname) throw new Error("Enter your partner’s nickname.");
        if (demo) toast.info("Requests are available in your own registered space.");
        else {
          const result = await client!.rpc("send_pair_request", { recipient_nickname: nickname });
          if (result.error) throw pairRequestError(result.error);
        }
      }
    }, modal?.kind === "request" ? "Request sent" : "Saved to your shared space");
  }
  async function removeNote(n: Note) {
    await perform(async () => {
      if (demo)
        update((d) => ({ ...d, notes: d.notes.filter((x) => x.id !== n.id) }));
      else await checked(client!.from("notes").delete().eq("id", n.id));
    }, "Note removed");
  }
  async function removeEvent(e: DayEvent) {
    await perform(async () => {
      if (demo)
        update((d) => ({
          ...d,
          events: d.events.filter((x) => x.id !== e.id),
        }));
      else await checked(client!.from("events").delete().eq("id", e.id));
    }, "Event removed");
  }
  async function removeEventSeries(e: DayEvent) {
    if (!e.series_id) return removeEvent(e);
    await perform(async () => {
      if (demo)
        update((d) => ({ ...d, events: d.events.filter((x) => x.series_id !== e.series_id) }));
      else
        await checked(client!.from("events").delete().eq("series_id", e.series_id).eq("user_id", userId));
    }, "Series removed");
  }
  async function respondToPlan(event: DayEvent, action: "accept" | "decline" | "reschedule") {
    await perform(async () => {
      if (demo) {
        update((d) => ({
          ...d,
          events: d.events.map((item) => item.id === event.id ? { ...item, plan_status: action === "accept" ? "accepted" : action === "decline" ? "declined" : "reschedule_requested" } : item),
        }));
        return;
      }
      await checked(client!.rpc("respond_to_plan", { plan_id: event.id, action, note: "" }));
    }, action === "accept" ? "Plan accepted" : action === "decline" ? "Plan declined" : "Reschedule requested");
  }
  async function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const settings = {
      timezone: String(f.get("timezone")),
      day_start: minutes(String(f.get("day_start"))),
      day_end: minutes(String(f.get("day_end"))),
      minimum_window: Number(f.get("minimum")),
      buffer: Number(f.get("buffer")),
      default_penalty: Number(f.get("penalty")),
    };
    if (
      !demo &&
      settings.timezone !== couple.timezone &&
      data.events.length > 0 &&
      !window.confirm(
        "Changing the shared timezone changes how existing busy blocks are interpreted. Continue and confirm your schedules again?",
      )
    ) return;
    await perform(
      async () => {
        if (settings.day_end <= settings.day_start)
          throw new Error("Shared hours must end after they start.");
        if (demo)
          update((d) => ({ ...d, couple: { ...d.couple, ...settings } }));
        else
          await checked(
            client!.rpc("save_pair_settings", {
              tz: settings.timezone,
              start_at: settings.day_start,
              end_at: settings.day_end,
              min_window: settings.minimum_window,
              travel_buffer: settings.buffer,
              default_fee: settings.default_penalty,
            }),
          );
      },
      "Shared preferences saved",
      false,
    );
  }
  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const values = {
      name: String(f.get("name")).trim(),
      nickname: String(f.get("nickname")).trim().toLowerCase(),
    };
    await perform(
      async () => {
        if (demo)
          update((d) => ({
            ...d,
            profiles: d.profiles.map((p) =>
              p.id === userId ? { ...p, ...values } : p,
            ),
          }));
        else
          await checked(
            client!.from("profiles").update(values).eq("id", userId),
          );
      },
      "Profile updated",
      false,
    );
  }
  async function savePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!client || demo) return;
    const form = new FormData(e.currentTarget);
    const password = String(form.get("new_password") || "");
    const confirmation = String(form.get("confirm_password") || "");
    setAccountError("");
    if (password.length < 8) {
      setAccountError("Use at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setAccountError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await client.auth.updateUser({ password });
      if (result.error) throw result.error;
      e.currentTarget.reset();
      toast.success("Password updated");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }
  async function exportData() {
    if (busy) return;
    setBusy(true);
    try {
      let events = data.events;
      let messages = data.messages;
      let ready = data.ready;
      if (!demo && client) {
        const [eventResult, messageResult, readyResult] = await Promise.all([
          client.from("events").select("*").eq("couple_id", couple.id).order("day").order("start_min"),
          client.from("messages").select("*").eq("couple_id", couple.id).order("created_at"),
          client.from("schedule_days").select("*").eq("couple_id", couple.id).order("day"),
        ]);
        if (eventResult.error) throw eventResult.error;
        if (messageResult.error) throw messageResult.error;
        if (readyResult.error) throw readyResult.error;
        events = eventResult.data || [];
        messages = messageResult.data || [];
        ready = readyResult.data || [];
      }
      const payload = {
        exported_at: new Date().toISOString(),
        profile: me,
        partner: partner || null,
        shared_space: couple,
        events,
        schedule_confirmations: ready,
        commitments: data.tasks,
        notes: data.notes,
        messages,
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `hadzar-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Your complete hadzar archive is ready to download");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare your export.");
    } finally {
      setBusy(false);
    }
  }
  async function deleteAccount() {
    if (demo || !client) return;
    if (!window.confirm("Delete your account and all spaces, messages, notes and commitments connected to it? This cannot be undone.")) return;
    setBusy(true);
    setAccountError("");
    try {
      const result = await client.rpc("delete_my_account");
      if (result.error) throw result.error;
      await client.auth.signOut();
      toast.success("Your account was deleted");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Could not delete your account.");
    } finally {
      setBusy(false);
    }
  }
  async function leavePair() {
    if (demo || !client) return;
    if (!window.confirm("Leave this shared space? Your partner will keep their own account and the shared space will be separated.")) return;
    setBusy(true);
    setAccountError("");
    try {
      const result = await client.rpc("leave_pair");
      if (result.error) throw result.error;
      await client.auth.signOut();
      toast.success("You left the shared space");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Could not leave the shared space.");
    } finally {
      setBusy(false);
    }
  }
  async function markNotificationRead(id: string) {
    const notice = data.notifications.find((item) => item.id === id);
    if (!notice || demo || !client) return;
    await client.rpc("mark_notification_read", { notification_id: id });
    setData((current) => current ? {
      ...current,
      notifications: current.notifications.map((item) => item.id === id ? { ...item, read_at: item.read_at || new Date().toISOString() } : item),
    } : current);
  }
  function exportIcs() {
    const escapeIcs = (value: string) =>
      value.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
    const stamp = (minutesValue: number) => `${day.replaceAll("-", "")}T${time(minutesValue).replace(":", "")}00`;
    const stampNow = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//hadzar//Shared time//EN",
      "CALSCALE:GREGORIAN",
      `X-WR-TIMEZONE:${couple.timezone}`,
      ...allEvents.flatMap((event) => [
        "BEGIN:VEVENT",
        `UID:${event.id}@hadzar`,
        `DTSTAMP:${stampNow}`,
        `DTSTART;TZID=${couple.timezone}:${stamp(event.start_min)}`,
        `DTEND;TZID=${couple.timezone}:${stamp(event.end_min)}`,
        `SUMMARY:${escapeIcs(event.title)}`,
        `DESCRIPTION:${escapeIcs(event.shared ? "Shared time together" : `Busy time for ${name(event.user_id)}`)}`,
        "END:VEVENT",
      ]),
      "END:VCALENDAR",
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `hadzar-${day}.ics`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Calendar file downloaded");
  }
  function notesPanel(full = false) {
    return (
      <section className={"notes-panel " + (full ? "full" : "")}>
        <div className="panel-title">
          <h2>
            Little notes <span className="count">{data.notes.length}</span>
          </h2>
          <button
            className="icon-btn"
            aria-label="Add note"
            onClick={() => openModal({ kind: "note" })}
          >
            <Plus size={18} />
          </button>
        </div>
        {full && (
          <input
            aria-label="Search notes"
            placeholder="Find a little something…"
            value={noteSearch}
            onChange={(e) => setNoteSearch(e.target.value)}
            className="note-search"
          />
        )}
        <div className="note-list">
          {(full ? visibleNotes : data.notes.slice(0, 3)).map((n) => (
            <button
              className="note-item"
              key={n.id}
              onClick={() => openModal({ kind: "note", note: n })}
            >
              <span className="note-marker">
                {n.pinned ? <Pin size={13} /> : <span>—</span>}
              </span>
              <span>
                <strong>{n.title}</strong>
                <span className="note-preview">{n.body || "Open note"}</span>
                <small className="note-meta">
                  {n.visibility === "private" ? "Only me" : "Shared"}
                  {n.remind_at ? ` · ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: couple.timezone }).format(new Date(n.remind_at))}` : ""}
                </small>
              </span>
            </button>
          ))}
          {!data.notes.length && (
            <p className="quiet-empty">
              A collection code. A place to try.
              <br />
              Leave something here for later.
            </p>
          )}
          {full && !!data.notes.length && !visibleNotes.length && (
            <p className="quiet-empty">No matching notes.</p>
          )}
        </div>
        {!full && (
          <button className="plain all-notes" onClick={() => setView("notes")}>
            All notes <ArrowUpRight size={14} />
          </button>
        )}
      </section>
    );
  }
  function chatPanel(full = false) {
    return (
      <section className={"chat-panel " + (full ? "full" : "")}>
          <div className="panel-title">
            <div>
              <h2>Just us</h2>
            <p className="meta">
              {partner
                ? `${partner.name} & you`
                : "Your conversation starts here"}
            </p>
            </div>
            <span className="panel-indicator">
              <MessageCircle size={19} strokeWidth={1.5} />
              {unreadMessages > 0 && <span className="count live-count">{unreadMessages}</span>}
            </span>
        </div>
        <div
          className="messages"
          ref={chatScroll}
          onScroll={(e) => {
            const el = e.currentTarget;
            nearBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
        >
          {hasOlder && data.messages.length >= 100 && (
            <button
              className="plain"
              disabled={chatBusy}
              onClick={olderMessages}
            >
              Earlier messages
            </button>
          )}
          <div className="chat-date">Your shared conversation</div>
          {messages.map((m, i) => {
            const previous = messages[i - 1];
            const newDate =
              !previous || chatDayKey(previous.created_at) !== chatDayKey(m.created_at);
            return (
              <Fragment key={m.id}>
                {newDate && (
                  <div className="chat-date message-day" role="separator">
                    {chatDateLabel(m.created_at)}
                  </div>
                )}
                <div
                  className={
                    "message-row " +
                    (m.sender_id === userId ? "mine " : "") +
                    (previous?.sender_id === m.sender_id && !newDate
                      ? "grouped"
                      : "")
                  }
                >
                  <div
                    className={
                      "bubble " + (m.sender_id === userId ? color(userId) : "")
                    }
                  >
                    <p>{m.body}</p>
                    <span
                      className="message-time"
                      title={new Intl.DateTimeFormat("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: couple.timezone,
                      }).format(new Date(m.created_at))}
                    >
                      {new Intl.DateTimeFormat("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: couple.timezone,
                      }).format(new Date(m.created_at))}
                      {m.sender_id === userId && (
                        <Check size={11} aria-label="Sent" />
                      )}
                    </span>
                  </div>
                </div>
              </Fragment>
            );
          })}
          {!messages.length && (
            <p className="quiet-empty">
              There’s room for the little things.
              <br />
              Say hello.
            </p>
          )}
          <div ref={chatEnd} />
        </div>
        {!!queuedMessages.length && (
          <p className="outbox-status" role="status">{queuedMessages.length} message{queuedMessages.length === 1 ? "" : "s"} waiting to sync.</p>
        )}
        <form className="composer" onSubmit={sendMessage}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => document.body.classList.add("composing")}
            onBlur={() => document.body.classList.remove("composing")}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={4000}
            rows={1}
            aria-label="Message"
            placeholder="A little message…"
          />
          <button
            type="submit"
            className="send-btn"
            disabled={chatBusy || !draft.trim()}
            aria-label="Send message"
          >
            <Send size={17} />
          </button>
        </form>
      </section>
    );
  }
  function taskCard(t: Task) {
    const late = overdue(t, now);
    return (
      <article
        className={
          "commitment " +
          (late ? "late " : "") +
          (t.completed_at ? "completed " : "") +
          (t.cancelled_at || t.declined_at ? "closed" : "")
        }
        key={t.id}
      >
        <div className="commitment-main">
          <div className="person-tag">
            <span className={"person-line " + color(t.assignee_id)} />
            {name(t.assignee_id)}
            {!t.accepted_at && (
              <span className="status">Awaiting acceptance</span>
            )}
            {t.completed_at && (
              <span className="status">
                <Check size={13} /> {t.confirmed_at ? "Confirmed" : "Complete"}
              </span>
            )}
            {t.completed_at && !t.confirmed_at && t.creator_id !== t.assignee_id && (
              <span className="status">Waiting for confirmation</span>
            )}
            {t.declined_at && <span className="status">Declined</span>}
            {t.cancelled_at && <span className="status">Cancelled</span>}
            {t.waived_at && <span className="status">Penalty waived</span>}
          </div>
          <h3>{t.title}</h3>
          {t.description && <p className="muted">{t.description}</p>}
          {t.assignee_id === userId && !t.completed_at && (
            <div className="task-actions">
              {t.accepted_at ? (
                <button
                  className="plain"
                  disabled={busy}
                  onClick={() => taskAction(t, "complete")}
                >
                  <Check size={15} /> Mark complete
                </button>
              ) : (
                <>
                  <button
                    className="plain"
                    disabled={busy || Date.parse(t.due_at) <= now}
                    onClick={() => taskAction(t, "accept")}
                  >
                    Accept commitment
                  </button>
                  <button
                    className="plain muted"
                    disabled={busy}
                    onClick={() => taskAction(t, "decline")}
                  >
                    Decline
                  </button>
                </>
              )}
            </div>
          )}
          {t.creator_id === userId &&
            t.assignee_id !== userId &&
            !!t.completed_at &&
            !t.confirmed_at && (
              <div className="task-actions">
                <button
                  className="plain"
                  disabled={busy}
                  onClick={() => taskAction(t, "confirm")}
                >
                  <CheckCheck size={15} /> Confirm completion
                </button>
              </div>
            )}
          {t.creator_id === userId &&
            !t.completed_at &&
            !t.cancelled_at &&
            !t.declined_at && (
              <div className="task-actions">
                <button
                  className="plain muted"
                  disabled={busy}
                  onClick={() => taskAction(t, "cancel")}
                >
                  Cancel commitment
                </button>
              </div>
            )}
        </div>
        <div className="commitment-terms">
          <span className={late ? "error" : ""}>
            <Clock size={14} />
            {formatDate(t.due_at)}
          </span>
          {late && <small className="error">Deadline missed</small>}
          <div>
            <small>{late ? "Penalty due" : "If the deadline is missed"}</small>
            <strong className="serif">{money(t.penalty)}</strong>
          </div>
        </div>
      </article>
    );
  }
  const selected =
    windows[Math.min(chosenWindow, Math.max(0, windows.length - 1))];
  const heroId = shared[0]?.id;
  return (
    <div className="app-shell">
      <Toaster position="top-center" theme="light" />
      {!online && <div className="offline-banner" role="status"><WifiOff size={15} /> Offline · changes are paused until you reconnect.</div>}
      {demo && (
        <div className="demo-banner">
          <span>Sample workspace · Azhar & Ilias · Changes are not saved</span>
          <button onClick={onExit}>Back to registration</button>
        </div>
      )}
      <header className="app-header">
        <Brand />
        <span className="header-date">
          {new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: couple.timezone,
          }).format(new Date())}
        </span>
        <div className="header-pair">
          <div className="avatar-stack">
            {data.profiles.map((p) => (
              <span className={"avatar " + color(p.id)} key={p.id}>
                {p.name[0]}
              </span>
            ))}
          </div>
          <div>
            <span>{names}</span>
            <small>
              {partner ? "A space for two" : "Waiting for your person"}
            </small>
          </div>
        </div>
        <div className="notification-wrap">
          <button
            className="icon-btn notification-button"
            aria-label="Notifications"
            aria-expanded={noticeOpen}
            onClick={() => setNoticeOpen((open) => !open)}
          >
            <Bell size={17} />
            {!!unreadNotificationCount && <span className="notification-dot" />}
          </button>
          {noticeOpen && (
            <div className="notification-popover" role="dialog" aria-label="Notifications">
              <div className="panel-title">
                <h2>Recent activity</h2>
                {!!notificationItems.length && <button className="plain" onClick={async () => {
                  await Promise.all(data.notifications.filter((item) => !item.read_at).map((item) => markNotificationRead(item.id)));
                  setNotices([]);
                }}>Clear</button>}
              </div>
              {notificationItems.length ? notificationItems.map((notice) => (
                <button className={"notification-item " + (notice.read ? "read" : "")} key={notice.id} onClick={() => { void markNotificationRead(notice.id); setNoticeOpen(false); }}>
                  <strong>{notice.title}</strong>
                  <span>{notice.body}</span>
                  <small>{new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(notice.at)}</small>
                </button>
              )) : <p className="muted">Nothing new right now.</p>}
            </div>
          )}
        </div>
      </header>
      <div className="app-grid">
        <main className="work-area">
          <Tabs
            value={view}
            onValueChange={(v) => setView(v as View)}
            className="desktop-tabs"
          >
            <TabsList variant="line" className="work-tabs">
              {nav
                .filter((n) => !["notes", "chat"].includes(n.id))
                .map((n) => (
                  <TabsTrigger className="work-tab" value={n.id} key={n.id}>
                    <n.icon size={17} />
                    {n.label}
                  </TabsTrigger>
                ))}
            </TabsList>
          </Tabs>
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button className="plain" onClick={() => reload()}>
                Retry
              </button>
            </div>
          )}
          {!partner && (
            <div className="invite-banner">
              <Users size={20} />
              <div>
                <strong>Your half is here.</strong>
                <p>Invite your partner to start finding time together.</p>
                <p>Your nickname: @{me.nickname}</p>
                {!requestsAvailable && <p role="status">Partner requests are temporarily unavailable. Invite by link while we reconnect them.</p>}
                {requests.some(request => request.sender_id === userId && request.status === "pending") && <p role="status">Request sent · waiting for your partner to accept.</p>}
              </div>
              <div className="invite-actions">
                <button
                  className="btn"
                  onClick={() => openModal({ kind: "invite" })}
                >
                  Invite by link
                </button>
                <button
                  className="btn"
                  onClick={() => openModal({ kind: "request" })}
                  disabled={!requestsAvailable}
                >
                  Send request
                </button>
                <button
                  className="btn dark"
                  onClick={() => openModal({ kind: "requests" })}
                  disabled={!requestsAvailable}
                >
                  Accept request{incomingRequests.length ? ` · ${incomingRequests.length}` : ""}
                </button>
              </div>
            </div>
          )}
          {view === "schedule" && (
            <div className="screen schedule-screen">
              <div className="screen-heading">
                <div>
                  <h1>Your day, side by side.</h1>
                  <p className="muted">{dateLabel}</p>
                </div>
                <button
                  className="btn"
                  onClick={() => openModal({ kind: "event" })}
                >
                  <Plus size={16} /> Add busy time
                </button>
              </div>
              {setupOpen && partner && (
                <section className="setup-panel">
                  <div>
                    <span className="meta">A gentle first step</span>
                    <h2>Find your first shared moment.</h2>
                    <p className="muted">Set your rhythm, add one busy block, then confirm the day together.</p>
                  </div>
                  <div className="setup-steps">
                    <button className="setup-step" onClick={() => { setView("settings"); finishSetup(); }}>
                      <strong>1</strong><span>Set your shared hours</span>
                    </button>
                    <button className="setup-step" onClick={() => openModal({ kind: "event" })}>
                      <strong>2</strong><span>Add your busy time</span>
                    </button>
                    <button className="setup-step" onClick={() => { void toggleReady(); finishSetup(); }}>
                      <strong>3</strong><span>Confirm this day</span>
                    </button>
                  </div>
                  <button className="plain" onClick={finishSetup}>I’ll explore first</button>
                </section>
              )}
              <div className="calendar-toolbar">
                <div className="date-controls">
                  <button
                    className="icon-btn"
                    aria-label="Previous day"
                    onClick={() => moveDay(-1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="btn"
                    onClick={() => changeDay(dayInZone(couple.timezone))}
                  >
                    Today
                  </button>
                  <button
                    className="icon-btn"
                    aria-label="Next day"
                    onClick={() => moveDay(1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                  <input
                    type="date"
                    aria-label="Choose day"
                    value={day}
                    onChange={(e) => e.target.value && changeDay(e.target.value)}
                  />
                </div>
                <span className="meta">
                  {couple.timezone.replaceAll("_", " ")} ·{" "}
                  {time(couple.day_start)}–{time(couple.day_end)}
                </span>
                <button className="plain calendar-export" onClick={exportIcs}>
                  <CalendarPlus size={15} /> Export .ics
                </button>
              </div>
              <div className="schedule-status">
                <button
                  className="ready-toggle"
                  onClick={toggleReady}
                  disabled={busy}
                >
                  <span className={"ready-check " + (myReady ? "checked" : "")}>
                    {myReady && <Check size={13} />}
                  </span>
                  My schedule is up to date
                </button>
                <span className="meta">
                  {bothReady
                    ? `${windows.length} shared ${windows.length === 1 ? "window" : "windows"}`
                    : partner
                      ? `Waiting for ${!myReady ? "your confirmation" : partner.name + "’s schedule"}`
                      : "Your partner hasn’t joined yet"}
                </span>
              </div>
              <div className="timeline-heading">
                <span />
                <div>
                  <span className="person-line a" />
                  {name(couple.member_one)}
                  <small>
                    {ready.some((r) => r.user_id === couple.member_one)
                      ? "Confirmed"
                      : "Not confirmed"}
                  </small>
                </div>
                <div>
                  <span className="person-line b" />
                  {partner ? name(couple.member_two!) : "Your partner"}
                  <small>
                    {ready.some((r) => r.user_id === couple.member_two)
                      ? "Confirmed"
                      : "Not confirmed"}
                  </small>
                </div>
              </div>
              <div
                className="timeline"
                style={{ height: couple.day_end - couple.day_start + 32 }}
              >
                {Array.from(
                  {
                    length:
                      Math.ceil((couple.day_end - couple.day_start) / 60) + 1,
                  },
                  (_, i) => couple.day_start + i * 60,
                )
                  .filter((t) => t <= couple.day_end)
                  .map((t) => (
                    <div
                      className="time-rule"
                      key={t}
                      style={{ top: t - couple.day_start }}
                    >
                      <span>{time(t)}</span>
                      <i />
                    </div>
                  ))}
                <div className="lane-divider" />
                {allEvents
                  .filter(
                    (e) =>
                      !e.shared &&
                      e.end_min > couple.day_start &&
                      e.start_min < couple.day_end,
                  )
                  .map((e) => (
                    <button
                      key={e.id}
                      className={"calendar-event " + color(e.user_id)}
                      style={{
                        top:
                          Math.max(e.start_min, couple.day_start) -
                          couple.day_start +
                          3,
                        height:
                          Math.min(e.end_min, couple.day_end) -
                          Math.max(e.start_min, couple.day_start) -
                          6,
                        left:
                          e.user_id === couple.member_one
                            ? "calc(56px + 8px)"
                            : "calc(50% + 28px + 8px)",
                      }}
                      onClick={() => openModal({ kind: "event", event: e })}
                    >
                      <span className="event-time">
                        {time(e.start_min)}–{time(e.end_min)}
                      </span>
                      <strong>{e.title}</strong>
                    </button>
                  ))}
                {windows.map((w, i) => {
                  const hero =
                    !heroId && i === Math.min(chosenWindow, windows.length - 1);
                  return (
                    <button
                      key={w.start}
                      className={
                        "shared-window " +
                        (hero ? "hero " : "") +
                        (w.end - w.start < 60 ? "short-window" : "")
                      }
                      style={{
                        top: w.start - couple.day_start + 3,
                        height: w.end - w.start - 6,
                      }}
                      onClick={() => {
                        setChosenWindow(i);
                        openModal({ kind: "plan", start: w.start, end: w.end });
                      }}
                    >
                      <span className="window-time">
                        {time(w.start)}–{time(w.end)} <span>Both free</span>
                      </span>
                      <strong className="serif">
                        {duration(w.end - w.start)} together
                      </strong>
                      {w.end - w.start >= 75 && (
                        <span className="window-action">
                          Make a little plan <Plus size={14} />
                        </span>
                      )}
                    </button>
                  );
                })}
                {shared
                  .filter(
                    (e) =>
                      e.end_min > couple.day_start &&
                      e.start_min < couple.day_end,
                  )
                  .map((e) => (
                    <button
                      key={e.id}
                      className={
                        "shared-window " +
                        (e.id === heroId ? "hero " : "") +
                        (e.end_min - e.start_min < 60 ? "short-window" : "")
                      }
                      style={{
                        top:
                          Math.max(e.start_min, couple.day_start) -
                          couple.day_start +
                          3,
                        height:
                          Math.min(e.end_min, couple.day_end) -
                          Math.max(e.start_min, couple.day_start) -
                          6,
                      }}
                      onClick={() => openModal({ kind: "event", event: e })}
                    >
                      <span className="window-time">
                        {time(e.start_min)}–{time(e.end_min)} · Planned by{" "}
                        {name(e.user_id)}
                      </span>
                      <strong className="serif">{e.title}</strong>
                    </button>
                  ))}
              </div>
              {selected && selected.end - selected.start < 60 && (
                <div className="short-window-detail">
                  <span>
                    {duration(selected.end - selected.start)} together ·{" "}
                    {time(selected.start)}–{time(selected.end)}
                  </span>
                  <button
                    className="btn"
                    onClick={() =>
                      openModal({
                        kind: "plan",
                        start: selected.start,
                        end: selected.end,
                      })
                    }
                  >
                    Make a plan
                  </button>
                </div>
              )}
              {!bothReady && (
                <p className="schedule-explainer">
                  Shared windows appear once you both confirm this day. Add your
                  busy time first; the remaining time within your shared hours
                  is treated as free.
                </p>
              )}
              {bothReady && !windows.length && !shared.length && (
                <div className="quiet-empty">
                  No shared window today.{" "}
                  <button className="plain" onClick={() => moveDay(1)}>
                    Look at tomorrow
                  </button>
                </div>
              )}
              <div className="up-next">
                <div className="panel-title">
                  <h2>A couple of promises</h2>
                  <button className="plain" onClick={() => setView("tasks")}>
                    View all
                  </button>
                </div>
                {activeTasks.slice(0, 2).map((t) => (
                  <button
                    className="compact-task"
                    key={t.id}
                    onClick={() => setView("tasks")}
                  >
                    <span>
                      <strong>{t.title}</strong>
                      <small>
                        {name(t.assignee_id)} · {formatDate(t.due_at)}
                      </small>
                    </span>
                    <span>
                      {money(t.penalty)}
                      <small>At stake</small>
                    </span>
                  </button>
                ))}
                {!activeTasks.length && (
                  <p className="quiet-empty">
                    No outstanding commitments. A little breathing room.
                  </p>
                )}
              </div>
              <section className="reflection-panel">
                <div className="panel-title">
                  <div>
                    <h2>A little look back</h2>
                    <p className="meta">A small reflection from what you’ve shared here.</p>
                  </div>
                </div>
                <div className="reflection-grid">
                  <div><strong className="serif">{shared.length + windows.length}</strong><span>shared moments logged</span></div>
                  <div><strong className="serif">{data.tasks.filter((t) => t.completed_at).length}</strong><span>promises kept</span></div>
                  <div><strong className="serif">{activeTasks.length}</strong><span>still open</span></div>
                </div>
              </section>
              <section className="week-panel">
                <div className="panel-title">
                  <div>
                    <h2>Best chances this week</h2>
                    <p className="meta">The three longest windows we can see ahead.</p>
                  </div>
                </div>
                {weekLoading && <p className="muted">Looking across the next seven days…</p>}
                {!weekLoading && weekCandidates.length > 0 && (
                  <div className="week-candidates">
                    {weekCandidates.map((candidate) => (
                      <button
                        className="week-candidate"
                        key={`${candidate.day}-${candidate.start}`}
                        onClick={() => changeDay(candidate.day)}
                      >
                        <span>{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(candidate.day + "T12:00:00Z"))}</span>
                        <strong>{time(candidate.start)}–{time(candidate.end)}</strong>
                        <small>{duration(candidate.end - candidate.start)}</small>
                      </button>
                    ))}
                  </div>
                )}
                {!weekLoading && !weekCandidates.length && (
                  <p className="quiet-empty">No confirmed shared windows yet. Confirm a day together to see the best chances here.</p>
                )}
              </section>
            </div>
          )}
          {view === "tasks" && (
            <div className="screen">
              <div className="screen-heading">
                <div>
                  <h1>Words you can count on.</h1>
                  <p className="muted">Small promises. Clear terms.</p>
                </div>
                <button
                  className="btn"
                  onClick={() => openModal({ kind: "task" })}
                >
                  <Plus size={16} /> New commitment
                </button>
              </div>
              <Tabs value={filter} onValueChange={setFilter}>
                <TabsList variant="line" className="filter-tabs">
                  <TabsTrigger value="active">
                    Active · {activeTasks.length}
                  </TabsTrigger>
                  <TabsTrigger value="mine">Mine</TabsTrigger>
                  <TabsTrigger value="completed">History</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="section-meta">
                Deadlines shown in {couple.timezone.replaceAll("_", " ")}
              </p>
              <div className="commitment-list">
                {data.tasks
                  .filter((t) =>
                    filter === "completed"
                      ? !!(t.completed_at || t.declined_at || t.cancelled_at)
                      : filter === "mine"
                        ? !t.completed_at && !t.declined_at && !t.cancelled_at && t.assignee_id === userId
                        : !t.completed_at && !t.declined_at && !t.cancelled_at,
                  )
                  .map(taskCard)}
              </div>
              {!data.tasks.some((t) =>
                  filter === "completed"
                  ? !!(t.completed_at || t.declined_at || t.cancelled_at)
                  : filter === "mine"
                    ? !t.completed_at && !t.declined_at && !t.cancelled_at && t.assignee_id === userId
                    : !t.completed_at && !t.declined_at && !t.cancelled_at,
              ) && (
                <div className="empty-surface">
                  <ListChecks size={28} strokeWidth={1} />
                  <h2>
                    {filter === "completed"
                      ? "Kept promises will live here."
                      : "A clean slate."}
                  </h2>
                  <p className="muted">
                    An owner, a deadline, and an agreed amount.
                  </p>
                </div>
              )}
              <p className="section-meta">
                A commitment assigned to your partner starts only when they
                accept it.
              </p>
            </div>
          )}
          {view === "penalties" && (
            <div className="screen">
              <div className="screen-heading">
                <div>
                  <h1>Keeping things fair.</h1>
                  <p className="muted">
                    A clear record of the terms you agreed to.
                  </p>
                </div>
                <ReceiptText size={23} strokeWidth={1.2} />
              </div>
              <section className="penalty-total">
                <span className="muted">To settle</span>
                <div className="serif">
                  {money(unpaid.reduce((s, t) => s + t.penalty, 0))}
                </div>
                <p className="meta">
                  {unpaid.length} unpaid{" "}
                  {unpaid.length === 1 ? "commitment" : "commitments"}
                </p>
              </section>
              <div className="panel-title">
                <h2>Your record</h2>
                <span className="meta">Amounts in KZT</span>
              </div>
              {fees.map((t) => (
                <article className="penalty-row" key={t.id}>
                  <div>
                    <h3>{t.title}</h3>
                    <p className="meta">
                      {name(t.assignee_id)} · {formatDate(t.due_at)}
                    </p>
                  </div>
                  <div className="penalty-right">
                    <strong>{money(t.penalty)}</strong>
                    <span className={t.paid_at || t.waived_at ? "meta" : "error"}>
                      {t.paid_at ? "Recorded as paid" : t.waived_at ? "Waived" : "Unpaid"}
                    </span>
                    {!t.paid_at && t.assignee_id === userId && (
                      <button
                        className="plain"
                        disabled={busy}
                        onClick={() => taskAction(t, "paid")}
                      >
                        Record payment
                      </button>
                    )}
                    {!t.paid_at && !t.waived_at && t.creator_id === userId && (
                      <button
                        className="plain"
                        disabled={busy}
                        onClick={() => taskAction(t, "waive")}
                      >
                        Waive penalty
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {!fees.length && (
                <div className="empty-surface">
                  <CheckCheck size={28} strokeWidth={1} />
                  <h2>Nothing to settle.</h2>
                  <p className="muted">
                    Missed, accepted commitments will appear here.
                  </p>
                </div>
              )}
              <p className="section-meta">
                This is a shared record. Recording a payment does not transfer
                money.
              </p>
            </div>
          )}
          {view === "notes" && (
            <div className="screen standalone-notes">
              <div className="screen-heading">
                <div>
                  <h1>For another moment.</h1>
                  <p className="muted">Little things worth remembering.</p>
                </div>
              </div>
              {notesPanel(true)}
            </div>
          )}
          {view === "chat" && (
            <div className="screen standalone-chat">{chatPanel(true)}</div>
          )}
          {view === "settings" && (
            <div className="screen settings-screen">
              <div className="screen-heading">
                <div>
                  <h1>Make this space yours.</h1>
                  <p className="muted">
                    Your names. Your rhythm. Your agreements.
                  </p>
                </div>
              </div>
              <form className="settings-form" onSubmit={saveProfile}>
                <h2>Your profile</h2>
                <div className="form-row">
                  <label>
                    Your name
                    <input
                      name="name"
                      required
                      maxLength={50}
                      defaultValue={me.name}
                    />
                  </label>
                  <label>
                    Nickname
                    <input
                      name="nickname"
                      required
                      pattern="[a-zA-Z0-9_]{3,24}"
                      title="3–24 letters, numbers or underscores"
                      defaultValue={me.nickname}
                    />
                  </label>
                </div>
                <button className="btn" disabled={busy}>
                  Save profile
                </button>
              </form>
              <section className="settings-form">
                <h2>Your account</h2>
                <p className="meta">Keep a copy of your shared space or update the password used to sign in.</p>
                <div className="account-actions">
                  <button type="button" className="btn" disabled={busy} onClick={() => void exportData()}>
                    <Download size={15} /> Export my data
                  </button>
                </div>
                {!demo && (
                  <form className="password-form" onSubmit={savePassword}>
                    <label>
                      <span><KeyRound size={14} /> New password</span>
                      <input name="new_password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required />
                    </label>
                    <label>
                      Confirm new password
                      <input name="confirm_password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required />
                    </label>
                    <button className="btn" disabled={busy}>Update password</button>
                  </form>
                )}
                {accountError && <p className="error" role="alert">{accountError}</p>}
                {!demo && (
                  <button type="button" className="plain danger-action" disabled={busy} onClick={() => void deleteAccount()}>
                    <Trash2 size={15} /> Delete account and shared data
                  </button>
                )}
              </section>
              <form className="settings-form" onSubmit={saveSettings}>
                <h2>Time for two</h2>
                <Choice
                  name="timezone"
                  label="Shared timezone"
                  value={couple.timezone}
                  options={[
                    ...new Set([
                      couple.timezone,
                      "Asia/Almaty",
                      "Asia/Qyzylorda",
                      "Europe/London",
                      "Europe/Berlin",
                      "America/New_York",
                      "Asia/Dubai",
                      "Asia/Tokyo",
                      "UTC",
                    ]),
                  ].map((value) => ({
                    value,
                    label: value.replaceAll("_", " "),
                  }))}
                />
                <div className="form-row">
                  <label>
                    Day starts
                    <input
                      type="time"
                      name="day_start"
                      required
                      defaultValue={time(couple.day_start)}
                    />
                  </label>
                  <label>
                    Day ends
                    <input
                      type="time"
                      name="day_end"
                      required
                      defaultValue={time(couple.day_end)}
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Minimum window · minutes
                    <input
                      type="number"
                      name="minimum"
                      min={15}
                      max={240}
                      required
                      defaultValue={couple.minimum_window}
                    />
                  </label>
                  <label>
                    Buffer around events · minutes
                    <input
                      type="number"
                      name="buffer"
                      min={0}
                      max={120}
                      required
                      defaultValue={couple.buffer}
                    />
                  </label>
                </div>
                <h2>Commitments</h2>
                <label>
                  Default penalty · ₸
                  <input
                    type="number"
                    name="penalty"
                    min={0}
                    max={1000000}
                    required
                    defaultValue={couple.default_penalty}
                  />
                </label>
                <p className="meta">
                  New commitments use this amount. Existing agreements stay
                  unchanged.
                </p>
                <button className="btn dark" disabled={busy}>
                  Save shared preferences
                </button>
              </form>
              <section className="settings-form">
                <h2>Your pair</h2>
                <div className="pair-members">
                  {data.profiles.map((p) => (
                    <div key={p.id}>
                      <span className={"avatar " + color(p.id)}>
                        {p.name[0]}
                      </span>
                      <span>
                        {p.name}
                        <small>@{p.nickname}</small>
                      </span>
                    </div>
                  ))}
                </div>
                {!partner && (
                  <button
                    className="btn"
                    onClick={() => openModal({ kind: "invite" })}
                  >
                    <Link2 size={16} /> Invite your partner
                  </button>
                )}
                {partner && !demo && (
                  <button type="button" className="plain danger-action" disabled={busy} onClick={() => void leavePair()}>
                    <Users size={15} /> Leave shared space
                  </button>
                )}
                <button className="plain" onClick={onExit}>
                  <LogOut size={15} />
                  {demo ? "Leave sample workspace" : "Sign out"}
                </button>
              </section>
            </div>
          )}
        </main>
        <aside className="personal-column">
          {notesPanel()}
          <div className="personal-divider" />
          {chatPanel()}
        </aside>
      </div>
      <nav className="mobile-nav" aria-label="Main navigation">
        {nav.map((n) => (
          <button
            key={n.id}
            className={
              (view === n.id ? "active " : "") +
              (n.id === "notes" || n.id === "settings" ? "group-start" : "")
            }
            onClick={() => setView(n.id)}
            aria-current={view === n.id ? "page" : undefined}
            aria-label={n.label}
          >
            <n.icon size={20} />
            <span>
              {n.id === "tasks"
                ? "Tasks"
                : n.id === "schedule"
                  ? "Schedule"
                : n.label}
              {n.id === "chat" && unreadMessages > 0 && (
                <span className="nav-badge">{unreadMessages}</span>
              )}
              {n.id === "settings" && incomingRequests.length > 0 && (
                <span className="nav-badge">{incomingRequests.length}</span>
              )}
            </span>
          </button>
        ))}
      </nav>
      <Dialog
        open={!!modal}
        onOpenChange={(open) => {
          if (!open && !busy) setModal(null);
        }}
      >
        {modal && (
          <DialogContent className="hadzar-dialog">
            <DialogTitle>
              {modal?.kind === "event"
                ? modal.event
                  ? "A moment in the day."
                  : "Block your busy time."
                : modal?.kind === "task"
                  ? "Make a commitment."
                  : modal?.kind === "note"
                    ? modal.note
                      ? "A little reminder."
                      : "Save it for later."
                    : modal?.kind === "plan"
                      ? "Make time yours."
                      : modal?.kind === "request"
                        ? "Ask to share a space."
                        : modal?.kind === "requests"
                          ? "Incoming requests."
                          : "Invite your person."}
            </DialogTitle>
            <DialogDescription>
              {modal?.kind === "invite"
                ? "One invitation. One person. Your space stays private."
                : modal?.kind === "event" || modal?.kind === "plan"
                  ? `${dateLabel} · ${couple.timezone.replaceAll("_", " ")}`
                  : modal?.kind === "task"
                    ? "Agree on who, when, and what’s at stake."
                    : modal?.kind === "request"
                      ? "Use your partner’s hadzar nickname to send a request."
                      : modal?.kind === "requests"
                        ? "Accept a request to connect your two spaces."
                        : "A small place for something worth remembering."}
            </DialogDescription>
            {modal?.kind === "requests" ? (
              <div className="dialog-body">
                <div>
                  <h3>Incoming</h3>
                  <PairRequestList requests={incomingRequests} busy={busy} onRespond={respondToRequest} />
                </div>
                <div>
                  <h3>Sent</h3>
                  <OutgoingPairRequestList requests={outgoingRequests} busy={busy} onCancel={cancelRequest} />
                </div>
              </div>
            ) : modal?.kind === "invite" ? (
              <div className="dialog-body">
                <div className="invitation-art">
                  <span className="avatar a">{me.name[0]}</span>
                  <span>+</span>
                  <span className="avatar vacant">?</span>
                </div>
                {inviteLink ? (
                  <>
                    <label>
                      Your invitation
                      <input readOnly value={inviteLink} />
                    </label>
                    <button
                      className="btn dark"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(inviteLink);
                          toast.success("Invitation copied");
                        } catch {
                          toast.error("Select and copy the invitation above.");
                        }
                      }}
                    >
                      <Copy size={16} /> Copy invitation
                    </button>
                    <p className="meta">
                      Expires in 7 days. Creating another link invalidates this
                      one.
                    </p>
                  </>
                ) : (
                  <p className="muted">
                    Send the link to your partner. They can sign in with their
                    existing account or create one to join you.
                  </p>
                )}
                <button className="btn" disabled={busy} onClick={makeInvite}>
                  {inviteLink ? "Create a new link" : "Create invitation link"}
                </button>
              </div>
            ) : modal?.event ? (
              <div className="dialog-body">
                <h2>{modal.event.title}</h2>
                <p>
                  {time(modal.event.start_min)}–{time(modal.event.end_min)}
                </p>
                <p className="meta">
                  {modal.event.shared ? "Planned by" : "Busy time for"}{" "}
                  {name(modal.event.user_id)}
                </p>
                {modal.event.shared && (modal.event.plan_status || "accepted") === "proposed" && modal.event.user_id !== userId && (
                  <div className="plan-response">
                    <p className="meta">Your partner proposed this moment. What feels right?</p>
                    <div className="dialog-actions">
                      <button className="btn dark" disabled={busy} onClick={() => void respondToPlan(modal.event!, "accept")}>Accept plan</button>
                      <button className="plain" disabled={busy} onClick={() => void respondToPlan(modal.event!, "reschedule")}>Ask to reschedule</button>
                      <button className="plain muted" disabled={busy} onClick={() => void respondToPlan(modal.event!, "decline")}>Decline</button>
                    </div>
                  </div>
                )}
                {modal.event.shared && modal.event.user_id === userId && modal.event.plan_status === "proposed" && (
                  <p className="meta">Waiting for your partner to accept this plan.</p>
                )}
                {modal.event.shared && modal.event.plan_status === "reschedule_requested" && (
                  <p className="meta">Your partner asked to find another time.</p>
                )}
                {modal.event.user_id === userId && (
                  <div className="dialog-actions">
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => removeEvent(modal.event!)}
                    >
                      <Trash2 size={15} /> Remove event
                    </button>
                    {modal.event.series_id && (
                      <button
                        className="plain"
                        disabled={busy}
                        onClick={() => removeEventSeries(modal.event!)}
                      >
                        Remove whole series
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <form className="dialog-body" onSubmit={saveModal}>
                {modal?.kind === "request" ? (
                  <label>
                    Partner nickname
                    <input
                      autoFocus
                      name="nickname"
                      required
                      minLength={3}
                      maxLength={25}
                      pattern="@?[a-zA-Z0-9_]{3,24}"
                      placeholder="azhar"
                    />
                  </label>
                ) : (
                  <label>
                    {modal?.kind === "plan"
                      ? "What would you like to do?"
                      : "Title"}
                    <input
                      autoFocus
                      name="title"
                      required
                      maxLength={120}
                      defaultValue={modal?.note?.title || ""}
                      placeholder={
                        modal?.kind === "plan"
                          ? "Lunch in the little square"
                          : modal?.kind === "task"
                            ? "Pick up the parcel"
                            : modal?.kind === "note"
                              ? "A little weekend idea"
                              : "Work, an appointment, the way home…"
                      }
                    />
                  </label>
                )}
                {modal?.kind === "event" && (
                  <div className="form-row">
                    <label>
                      Starts
                      <input
                        name="start"
                        type="time"
                        defaultValue="09:00"
                        required
                      />
                    </label>
                    <label>
                      Ends
                      <input
                        name="end"
                        type="time"
                        defaultValue="10:00"
                        required
                      />
                    </label>
                  </div>
                )}
                {modal?.kind === "event" && (
                  <label>
                    Repeat this busy block
                    <select name="repeat" defaultValue="none">
                      <option value="none">Only this day</option>
                      <option value="daily">Every day for one week</option>
                      <option value="weekdays">Weekdays for two weeks</option>
                      <option value="weekly">Weekly for four weeks</option>
                    </select>
                  </label>
                )}
                {modal?.kind === "plan" && (
                  <p>
                    {time(modal.start!)}–{time(modal.end!)} ·{" "}
                    {duration(modal.end! - modal.start!)}
                  </p>
                )}
                {modal?.kind === "note" && (
                  <>
                    <label>
                      Details
                      <textarea
                        name="body"
                        rows={5}
                        maxLength={10000}
                        defaultValue={modal.note?.body || ""}
                        placeholder="Something to remember…"
                      />
                    </label>
                    <label className="check-label">
                      <Checkbox
                        name="pinned"
                        defaultChecked={modal.note?.pinned}
                      />{" "}
                      Keep at the top
                    </label>
                    <Choice
                      name="visibility"
                      label="Who can see it?"
                      value={modal.note?.visibility || "shared"}
                      options={[
                        { value: "shared", label: "Both of us" },
                        { value: "private", label: "Only me" },
                      ]}
                    />
                    <label>
                      Remind me (optional)
                      <input
                        name="remind_at"
                        type="datetime-local"
                        defaultValue={modal.note?.remind_at ? new Date(modal.note.remind_at).toISOString().slice(0, 16) : ""}
                      />
                    </label>
                  </>
                )}
                {modal?.kind === "task" && (
                  <>
                    <label>
                      A little context
                      <textarea name="description" rows={2} maxLength={2000} />
                    </label>
                    <Choice
                      name="assignee"
                      label="Who’s responsible?"
                      value={userId}
                      options={data.profiles.map((p) => ({
                        value: p.id,
                        label: p.name + (p.id === userId ? " (you)" : ""),
                      }))}
                    />
                    <label>
                      Deadline · your device timezone
                      <input name="due" type="datetime-local" required />
                    </label>
                    <label>
                      Penalty if missed · ₸
                      <input
                        name="penalty"
                        type="number"
                        min={0}
                        max={1000000}
                        required
                        defaultValue={couple.default_penalty}
                      />
                    </label>
                    <p className="meta">
                      If assigned to your partner, they must accept before the
                      penalty applies.
                    </p>
                  </>
                )}
                <div className="dialog-actions">
                  {modal?.kind === "plan" && (
                    <>
                      <button type="button" className="plain" onClick={() => { setModal(null); setView("chat"); }}>
                        Open chat
                      </button>
                      <button type="button" className="plain" onClick={() => setModal({ kind: "note" })}>
                        Keep a note
                      </button>
                    </>
                  )}
                  {modal?.note && (
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={busy}
                      aria-label="Delete note"
                      onClick={() => removeNote(modal.note!)}
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                  <button type="submit" className="btn dark" disabled={busy}>
                    {busy
                      ? "Saving…"
                      : modal?.kind === "request"
                        ? "Send request"
                      : modal?.kind === "task"
                        ? "Save commitment"
                        : modal?.kind === "plan"
                          ? "Add our plan"
                          : "Save"}
                  </button>
                </div>
              </form>
            )}
            {formError && (
              <p className="error" role="alert">
                {formError}
              </p>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
