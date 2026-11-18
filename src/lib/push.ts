import { getApp } from "firebase/app";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

/**
 * Real push (works with the app closed): the browser gets a Firebase Cloud Messaging token, we store it in
 * `pushTokens`, and /api/push (a small server route) sends the push when someone nudges you or an activity happens.
 * Needs VITE_FIREBASE_VAPID_KEY (public) here and FIREBASE_SERVICE_ACCOUNT (secret) on the server. See PUSH_SETUP.md.
 */
const VAPID = import.meta.env["VITE_FIREBASE_VAPID_KEY"] as string | undefined;
export const pushConfigured = Boolean(VAPID);

export type PushResult = "ok" | "no-key" | "no-permission" | "unsupported" | "failed";

export async function pushSupported(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return false;
  try {
    const { isSupported } = await import("firebase/messaging");
    return await isSupported();
  } catch {
    return false;
  }
}

/** Gets this device's push token and saves it against the signed-in roommate. Safe to call on every launch. */
export async function registerPush(roommateId: string): Promise<PushResult> {
  if (!VAPID) return "no-key";
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return "no-permission";
  if (!(await pushSupported())) return "unsupported";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return "unsupported"; // the service worker only runs in the production build
    const { getMessaging, getToken } = await import("firebase/messaging");
    const token = await getToken(getMessaging(getApp()), { vapidKey: VAPID, serviceWorkerRegistration: reg });
    if (!token) return "failed";
    await setDoc(doc(db, "pushTokens", token), { roommateId, createdAtMs: Date.now(), agent: navigator.userAgent.slice(0, 120) });
    return "ok";
  } catch {
    return "failed";
  }
}

/** Asks the server to push the given notification ids. Best effort: the in-app bell never depends on it. */
export async function requestPush(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const t = await auth?.currentUser?.getIdToken();
    if (!t) return;
    await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify({ ids }) });
  } catch { /* offline or push not set up */ }
}
