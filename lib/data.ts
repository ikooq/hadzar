import type { SupabaseClient } from "@supabase/supabase-js";
import type { Data, Profile } from "./types";
export async function profileFor(client: SupabaseClient, id: string) {
  const r = await client
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (r.error) throw r.error;
  return r.data as Profile | null;
}
export async function loadData(
  client: SupabaseClient,
  day: string,
): Promise<Data | null> {
  const cr = await client.from("couples").select("*").maybeSingle();
  if (cr.error) throw cr.error;
  if (!cr.data) return null;
  const cid = cr.data.id;
  const results = await Promise.all([
    client.from("profiles").select("id,name,nickname"),
    client
      .from("events")
      .select("*")
      .eq("couple_id", cid)
      .eq("day", day)
      .order("start_min"),
    client
      .from("schedule_days")
      .select("*")
      .eq("couple_id", cid)
      .eq("day", day),
    client.from("tasks").select("*").eq("couple_id", cid).order("due_at"),
    client
      .from("notes")
      .select("*")
      .eq("couple_id", cid)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false }),
    client
      .from("messages")
      .select("*")
      .eq("couple_id", cid)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  for (const r of results) if (r.error) throw r.error;
  return {
    couple: cr.data,
    profiles: results[0].data!,
    events: results[1].data!,
    ready: results[2].data!,
    tasks: results[3].data!,
    notes: results[4].data!,
    messages: results[5].data!.reverse(),
  } as Data;
}
