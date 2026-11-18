import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
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

const ANDROID_CHANNEL_ID = "room_ledger_alerts";

/** Bridge injected by the Android app (see android-native/README.md). Absent in a normal browser. */
type AndroidBridge = {
  getFcmToken(): string;
  hasPermission(): boolean;
  requestPermission(): void;
  show(title: string, body: string, link: string, tag: string): void;
};
declare global { interface Window { AndroidBridge?: AndroidBridge } }
export const nativeBridge = (): AndroidBridge | null => (typeof window !== "undefined" && window.AndroidBridge ? window.AndroidBridge : null);
export const isNativeAndroid = () => typeof window !== "undefined" && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

type NativePermission = "granted" | "prompt" | "denied";

const toNativePermission = (state: string): NativePermission =>
  state === "granted" ? "granted" : state === "denied" ? "denied" : "prompt";

export async function getNativeNotificationPermission(): Promise<NativePermission> {
  const { display } = await LocalNotifications.checkPermissions();
  return toNativePermission(display);
}

export async function requestNativeNotificationPermission(): Promise<NativePermission> {
  let local = await LocalNotifications.checkPermissions();
  if (local.display !== "granted") local = await LocalNotifications.requestPermissions();
  if (local.display !== "granted") return toNativePermission(local.display);

  let push = await PushNotifications.checkPermissions();
  if (push.receive !== "granted") push = await PushNotifications.requestPermissions();
  return toNativePermission(push.receive);
}

async function ensureAndroidNotificationChannels() {
  const channel = {
    id: ANDROID_CHANNEL_ID,
    name: "Room Ledger alerts",
    description: "Nudges, bills, payments, and reminders",
    importance: 5 as const,
    visibility: 1 as const,
    vibration: true,
  };
  await Promise.all([
    LocalNotifications.createChannel(channel),
    PushNotifications.createChannel(channel),
  ]);
}

function notificationId(tag: string): number {
  let hash = 0;
  for (const char of tag) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return (hash & 0x7fffffff) || 1;
}

export async function showNativeNotification(title: string, body: string, link: string, tag: string) {
  await ensureAndroidNotificationChannels();
  await LocalNotifications.schedule({
    notifications: [{
      id: notificationId(tag),
      title,
      body,
      channelId: ANDROID_CHANNEL_ID,
      extra: { url: link },
      autoCancel: true,
    }],
  });
}

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
  // Inside the Android app: use the native FCM token handed over by the bridge (WebView has no web push).
  const native = nativeBridge();
  if (native) {
    try {
      if (!native.hasPermission()) return "no-permission";
      let token = "";
      for (let i = 0; i < 20 && !token; i++) {
        token = native.getFcmToken();
        if (!token) await new Promise((r) => setTimeout(r, 500));
      }
      if (!token) return "failed";
      await setDoc(doc(db, "pushTokens", token), { roommateId, createdAtMs: Date.now(), agent: "android-app" });
      return "ok";
    } catch (error) {
      console.error("Native Android push registration failed", error);
      return "failed";
    }
  }
  if (isNativeAndroid()) {
    try {
      const { receive } = await PushNotifications.checkPermissions();
      if (receive !== "granted") return "no-permission";
      await ensureAndroidNotificationChannels();

      let resolveOutcome!: (outcome: { token: string } | { error: Error }) => void;
      const outcomePromise = new Promise<{ token: string } | { error: Error }>((resolve) => {
        resolveOutcome = resolve;
      });
      const listeners: PluginListenerHandle[] = [];
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        listeners.push(await PushNotifications.addListener("registration", ({ value }) => resolveOutcome({ token: value })));
        listeners.push(await PushNotifications.addListener("registrationError", ({ error }) => resolveOutcome({ error: new Error(error) })));
        const timeoutPromise = new Promise<{ error: Error }>((resolve) => {
          timeout = setTimeout(() => resolve({ error: new Error("Timed out waiting for an FCM registration token.") }), 15000);
        });
        await PushNotifications.register();
        const outcome = await Promise.race([outcomePromise, timeoutPromise]);
        if ("error" in outcome) throw outcome.error;
        await setDoc(doc(db, "pushTokens", outcome.token), { roommateId, createdAtMs: Date.now(), agent: "capacitor-android" });
        return "ok";
      } finally {
        if (timeout) clearTimeout(timeout);
        await Promise.all(listeners.map(async (listener) => {
          try { await listener.remove(); } catch (error) { console.error("Could not remove push registration listener", error); }
        }));
      }
    } catch (error) {
      console.error("Capacitor FCM registration failed", error);
      return "failed";
    }
  }
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
