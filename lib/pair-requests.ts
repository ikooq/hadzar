export function pairRequestError(error: unknown): Error {
  const issue = error as { code?: string; message?: string };
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(issue?.code || "")) {
    return new Error("Partner requests are temporarily unavailable. Please try again shortly, or invite your partner by link.");
  }
  return new Error(issue?.message || "We could not update this request. Please try again.");
}
