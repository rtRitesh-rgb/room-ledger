/** Turns raw Firebase errors into something a person can act on. */
export function friendlyError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (err?.code === "permission-denied" || /missing or insufficient permissions/i.test(err?.message ?? ""))
    return "Firestore refused this save. The security rules published in your Firebase project are out of date. Publish the latest firestore.rules (Firebase console → Firestore → Rules → Publish), then try again.";
  if (err?.code === "unavailable" || err?.code === "deadline-exceeded") return "You seem to be offline. Check your connection and try again.";
  return err?.message || "Couldn't save.";
}
