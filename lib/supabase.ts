import { createClient, type SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient | null = null;
export async function getClient() {
  if (client) return client;
  const response = await fetch("/api/config");
  if (!response.ok)
    throw new Error("Cannot connect right now. Please try again.");
  const config = (await response.json()) as {
    url: string | null;
    key: string | null;
  };
  if (!config.url || !config.key) return null;
  client = createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}
