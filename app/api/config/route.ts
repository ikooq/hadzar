import { env } from "cloudflare:workers";
export function GET() {
  const settings = env as unknown as Record<string, string | undefined>;
  const url = settings.SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    settings.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  // Fail closed if an administrator accidentally supplies a privileged key.
  let publishable = key?.startsWith("sb_publishable_") || false;
  if (key?.split(".").length === 3) {
    try {
      publishable =
        JSON.parse(
          atob(key.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")),
        ).role === "anon";
    } catch {}
  }
  return Response.json(
    { url: publishable ? url || null : null, key: publishable ? key : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
