export function friendlyError(error: unknown, fallback = "Something went wrong. Please try again.") {
  const issue = error as { code?: string; message?: string; status?: number } | null;
  const message = issue?.message || (error instanceof Error ? error.message : "");
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (lower.includes("email not confirmed")) return "Confirm your email before signing in.";
  if (lower.includes("user already registered") || lower.includes("already been registered")) return "An account with this email already exists. Sign in instead.";
  if (lower.includes("duplicate key") && lower.includes("nickname")) return "That nickname is already taken. Try another.";
  if (lower.includes("rate limit") || issue?.status === 429) return "Too many attempts. Please wait a little and try again.";
  if (issue?.code === "PGRST202" || issue?.code === "PGRST205" || issue?.code === "42P01" || issue?.code === "42883") {
    return "This feature needs the latest hadzar Supabase migration.";
  }
  return message || fallback;
}
