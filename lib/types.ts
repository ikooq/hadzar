export type Profile = { id: string; name: string; nickname: string };
export type Couple = {
  id: string;
  member_one: string;
  member_two: string | null;
  timezone: string;
  day_start: number;
  day_end: number;
  minimum_window: number;
  buffer: number;
  default_penalty: number;
};
export type DayEvent = {
  id: string;
  couple_id: string;
  user_id: string;
  day: string;
  title: string;
  start_min: number;
  end_min: number;
  shared: boolean;
};
export type DayReady = { couple_id: string; user_id: string; day: string };
export type Task = {
  id: string;
  couple_id: string;
  creator_id: string;
  assignee_id: string;
  title: string;
  description: string;
  due_at: string;
  penalty: number;
  accepted_at: string | null;
  completed_at: string | null;
  paid_at: string | null;
  created_at: string;
};
export type Note = {
  id: string;
  couple_id: string;
  author_id: string;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
};
export type Message = {
  id: string;
  couple_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};
export type PairRequest = {
  id: string;
  sender_id: string;
  recipient_id: string;
  sender_name: string;
  sender_nickname: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  responded_at: string | null;
};
export type Data = {
  couple: Couple;
  profiles: Profile[];
  events: DayEvent[];
  ready: DayReady[];
  tasks: Task[];
  notes: Note[];
  messages: Message[];
};
export const money = (n: number) =>
  new Intl.NumberFormat("en-US").format(n).replaceAll(",", " ") + " ₸";
export const time = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const minutes = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
};
export function duration(n: number) {
  const h = Math.floor(n / 60),
    m = n % 60;
  return h
    ? `${h} ${h === 1 ? "hour" : "hours"}${m ? ` ${m} min` : ""}`
    : `${m} minutes`;
}
export const overdue = (t: Task, now = Date.now()) =>
  !!t.accepted_at &&
  Date.parse(t.due_at) < now &&
  (!t.completed_at || Date.parse(t.completed_at) > Date.parse(t.due_at));
export function dayInZone(zone: string, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
