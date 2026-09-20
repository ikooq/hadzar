import type { SupabaseClient } from "@supabase/supabase-js";
import type { Data, PairRequest, Profile } from "./types";
export async function profileFor(client: SupabaseClient, id: string) {
  const r = await client
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (r.error) throw r.error;
  return r.data as Profile | null;
}
export async function pendingPairRequests(client: SupabaseClient) {
  const r = await client
    .from("pair_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  // Request availability must not stop an existing workspace loading.
  if (r.error) {
    if (r.error.code === "42P01" || r.error.code === "PGRST205")
      return { requests: [] as PairRequest[], available: false };
    throw r.error;
  }
  return { requests: (r.data || []) as PairRequest[], available: true };
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
    client
      .from("message_reads")
      .select("*")
      .eq("couple_id", cid),
    client
      .from("notifications")
      .select("*")
      .eq("couple_id", cid)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  for (const [index, r] of results.entries()) {
    // The live table is installed by the product-improvements migration. Keep
    // existing spaces readable while an older Supabase project is being upgraded.
    if ((index === 6 || index === 7) && (r.error?.code === "42P01" || r.error?.code === "PGRST205")) continue;
    if (r.error) throw r.error;
  }
  return {
    couple: cr.data,
    profiles: results[0].data!,
    events: results[1].data!,
    ready: results[2].data!,
    tasks: results[3].data!,
    notes: results[4].data!,
    messages: results[5].data!.reverse(),
    messageReads: results[6].error ? [] : (results[6].data || []),
    notifications: results[7].error ? [] : (results[7].data || []),
  } as Data;
}
