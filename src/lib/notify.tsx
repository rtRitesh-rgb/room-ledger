import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { C } from "./db";
import { useLedger } from "./data";
import {
  buildBalances, currentMonth, duesObligations, expenseObligations, monthLabel, vaultSummary,
} from "./ledger";
import { formatPaise } from "./money";
import { markAllRead, markRead, removeMany, removeNotification, sendNotification, type AppNotification } from "./notifications";
import {
  getNativeNotificationPermission, isNativeAndroid, nativeBridge,
  registerPush, requestNativeNotificationPermission, showNativeNotification, type PushResult,
} from "./push";

type Permission = "unsupported" | "default" | "granted" | "denied";

type NotifyValue = {
  items: AppNotification[];
  unread: number;
  loaded: boolean;
  permission: Permission;
  enableAlerts: () => Promise<Permission>;
  /** "ok" once this phone is registered for real push (works with the app closed). */
  pushState: PushResult | "pending";
  sendTest: () => Promise<"sent" | "blocked" | "failed">;
  read: (id: string) => void;
  readAll: () => void;
  remove: (id: string) => void;
  clearRead: () => void;
};

const Ctx = createContext<NotifyValue>({
  items: [], unread: 0, loaded: false, permission: "unsupported",
  enableAlerts: async () => "unsupported", pushState: "pending", sendTest: async () => "failed", read: () => {}, readAll: () => {}, remove: () => {}, clearRead: () => {},
});

const MADE_KEY = "room-ledger-notif-made"; // ids of reminders this device already created (so deleted ones never come back)
const SHOWN_KEY = "room-ledger-notif-shown"; // ids already shown as a device alert
const THIRTY_DAYS = 30 * 24 * 3600 * 1000;

const loadSet = (key: string): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]); } catch { return new Set(); } };
const saveSet = (key: string, s: Set<string>) => { try { localStorage.setItem(key, JSON.stringify([...s].slice(-400))); } catch { /* ignore */ } };

const getPermission = async (): Promise<Permission> => {
  if (typeof window === "undefined") return "unsupported";
  const b = nativeBridge();
  if (b) return b.hasPermission() ? "granted" : "default";
  if (isNativeAndroid()) {
    const state = await getNativeNotificationPermission();
    return state === "prompt" ? "default" : state;
  }
  return !("Notification" in window) ? "unsupported" : (Notification.permission as Permission);
};

/** Shows an OS-level alert. Uses the service worker when available (needed on Android Chrome / installed PWAs). */
async function showDeviceAlert(n: AppNotification) {
  const b = nativeBridge();
  if (b) { try { b.show(n.title, n.body, n.link, n.id); } catch { /* ignore */ } return; } // Android app: native notification (same tag as the push, so it replaces instead of duplicating)
  if (isNativeAndroid()) {
    try { await showNativeNotification(n.title, n.body, n.link, n.id); }
    catch (error) { console.error("Could not show Android notification", error); }
    return;
  }
  const opts: NotificationOptions = { body: n.body, icon: "/icons/icon-192.png", badge: "/icons/favicon-32.png", tag: n.id, data: { url: n.link } };
  try {
    // Phones (Android Chrome / installed apps) only allow notifications through the service worker.
    const reg = "serviceWorker" in navigator
      ? (await navigator.serviceWorker.getRegistration()) ?? (await Promise.race([navigator.serviceWorker.ready, new Promise<undefined>((r) => setTimeout(r, 3000))]))
      : undefined;
    if (reg) await reg.showNotification(n.title, opts);
    else new Notification(n.title, opts);
  } catch { /* some browsers refuse; the in-app bell still works */ }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const L = useLedger();
  const { me, month, loading, expenses, payments, monthDoc, allocations, wallet, settings } = L;
  const meId = me?.id ?? null;
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [permission, setPermission] = useState<Permission>("unsupported");
  const firstLoad = useRef(true);
  const [pushState, setPushState] = useState<PushResult | "pending">("pending");

  useEffect(() => {
    void getPermission().then(setPermission).catch((error) => {
      console.error("Could not read notification permission", error);
      setPermission("unsupported");
    });
  }, []);

  // 1) Live feed: only my own notifications (the rules enforce the same).
  useEffect(() => {
    if (!meId) return;
    firstLoad.current = true;
    setLoaded(false);
    return onSnapshot(
      query(collection(db, "notifications"), where("toId", "==", meId)),
      (snap) => {
        const next = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as AppNotification).sort((a, b) => b.createdAtMs - a.createdAtMs);
        setItems(next);
        setLoaded(true);
      },
      () => setLoaded(true), // rules not published yet → just show an empty bell instead of breaking the app
    );
  }, [meId]);

  const unread = useMemo(() => items.filter((n) => !n.readAtMs).length, [items]);

  // 2) Housekeeping: drop read notifications older than 30 days.
  const pruned = useRef(false);
  useEffect(() => {
    if (!loaded || pruned.current) return;
    pruned.current = true;
    const old = items.filter((n) => n.readAtMs && Date.now() - n.createdAtMs > THIRTY_DAYS).slice(0, 100).map((n) => n.id);
    if (old.length) void removeMany(old).catch(() => {});
  }, [loaded, items]);

  // 3) Automatic reminders, generated on this device for me, once each (deterministic ids).
  useEffect(() => {
    if (!meId || !loaded || loading || !me) return;
    const made = loadSet(MADE_KEY);
    const have = new Set(items.map((n) => n.id));
    const make = (id: string, n: Parameters<typeof sendNotification>[0]) => {
      if (have.has(id) || made.has(id)) return;
      made.add(id); saveSet(MADE_KEY, made);
      void sendNotification(n, id).catch(() => { made.delete(id); saveSet(MADE_KEY, made); });
    };
    const base = { toId: meId, fromId: meId } as const;
    const cm = currentMonth();
    const today = new Date();
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysLeft = lastDay - today.getDate();

    // New month: nudge to review the private wallet (it silently inherits last month's amount).
    const vault = vaultSummary(meId, cm, allocations, wallet, settings.carryForward);
    make(`newmonth_${cm}_${meId}`, {
      ...base, type: "new_month", link: "/household", title: `Welcome to ${monthLabel(cm)}`,
      body: vault.allocation ? `Your wallet is ${formatPaise(vault.allocation)} (same as last month). Update it if your budget changed.` : "Set your wallet amount for this month to get a daily spending limit.",
    });

    // Private wallet warnings (only I can see these).
    if (vault.status === "over") make(`wallet_over_${cm}_${meId}`, { ...base, type: "wallet", link: "/household", title: "You're over your wallet", body: `You're ${formatPaise(-vault.remaining)} over for ${monthLabel(cm)}. Top it up or slow down on spending.` });
    else if (vault.status === "low") make(`wallet_low_${cm}_${meId}`, { ...base, type: "wallet", link: "/household", title: "Wallet running low", body: `Only ${formatPaise(vault.remaining)} left for ${monthLabel(cm)}.` });

    // Month-end settle-up reminders: 3 days out and on the last day. Needs the current month's data on screen.
    if (daysLeft <= 3 && month === cm) {
      const open = [
        ...buildBalances(expenseObligations(expenses), payments, "general"),
        ...buildBalances(duesObligations(expenses, monthDoc?.fixed ?? null, monthDoc?.managerId ?? null), payments, "dues"),
      ].filter((b) => !b.settled);
      const owe = open.filter((b) => b.fromId === meId).reduce((s, b) => s + b.remainingPaise, 0);
      const owed = open.filter((b) => b.toId === meId).reduce((s, b) => s + b.remainingPaise, 0);
      if (owe > 0 || owed > 0) {
        const parts = [owe > 0 ? `You still owe ${formatPaise(owe)}.` : "", owed > 0 ? `${formatPaise(owed)} is still to collect.` : ""].filter(Boolean).join(" ");
        make(`monthend_${cm}_${daysLeft === 0 ? "last" : "soon"}_${meId}`, {
          ...base, type: "month_end", link: "/settlement",
          title: daysLeft === 0 ? "Last day of the month: settle up" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left this month`,
          body: `${parts} Clear balances before the month closes.`, amountPaise: owe || owed,
        });
      }
    }
  }, [meId, me, loaded, loading, items, month, expenses, payments, monthDoc, allocations, wallet, settings.carryForward]);

  // 3b) Real push: once alerts are allowed, register this phone for push (re-checked on every launch).
  useEffect(() => {
    if (!meId || permission !== "granted") return;
    void registerPush(meId).then(setPushState);
  }, [meId, permission]);

  // 4) Device alerts + app-icon badge for anything new and unread.
  useEffect(() => {
    if (!loaded) return;
    try { void (navigator as Navigator & { setAppBadge?: (n: number) => Promise<void> }).setAppBadge?.(unread); } catch { /* unsupported */ }
    if (permission !== "granted") return; // (same tag as the background push, so the phone replaces instead of duplicating)
    const shown = loadSet(SHOWN_KEY);
    const fresh = items.filter((n) => !n.readAtMs && !shown.has(n.id));
    if (!fresh.length) return;
    for (const n of fresh) shown.add(n.id);
    saveSet(SHOWN_KEY, shown);
    if (fresh.length > 3 && firstLoad.current) {
      void showDeviceAlert({ ...fresh[0]!, id: "summary", title: `${fresh.length} new notifications`, body: "Open Room Ledger to see them.", link: "/" });
    } else {
      fresh.slice(0, 3).forEach((n) => void showDeviceAlert(n));
    }
    firstLoad.current = false;
  }, [items, loaded, permission, unread]);

  const enableAlerts = useCallback(async (): Promise<Permission> => {
    let res: Permission;
    try {
      if (typeof window === "undefined") return "unsupported";
      const b = nativeBridge();
      if (b) {
        b.requestPermission();
        for (let i = 0; i < 60 && !b.hasPermission(); i++) await new Promise((r) => setTimeout(r, 500));
        res = b.hasPermission() ? "granted" : "denied";
      } else if (isNativeAndroid()) {
        const nativePermission = await requestNativeNotificationPermission();
        res = nativePermission === "prompt" ? "default" : nativePermission;
      } else if (!("Notification" in window)) res = "unsupported";
      else res = (await Notification.requestPermission()) as Permission;
    } catch (error) {
      console.error("Could not request notification permission", error);
      res = "unsupported";
    }
    setPermission(res);
    return res;
  }, []);

  const sendTest = useCallback(async (): Promise<"sent" | "blocked" | "failed"> => {
    if (!meId) return "failed";
    try {
      await sendNotification({ toId: meId, fromId: meId, type: "test", link: "/", title: "Test notification", body: "If you can read this, notifications are working on this device. 🎉" });
      return "sent";
    } catch (e) {
      return (e as { code?: string }).code === "permission-denied" ? "blocked" : "failed";
    }
  }, [meId]);

  const value = useMemo<NotifyValue>(() => ({
    items, unread, loaded, permission, enableAlerts, pushState, sendTest,
    read: (id) => void markRead(id).catch(() => {}),
    readAll: () => void markAllRead(items.filter((n) => !n.readAtMs).map((n) => n.id)).catch(() => {}),
    remove: (id) => void removeNotification(id).catch(() => {}),
    clearRead: () => void removeMany(items.filter((n) => n.readAtMs).map((n) => n.id)).catch(() => {}),
  }), [items, unread, loaded, permission, enableAlerts, pushState, sendTest]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useNotifications = () => useContext(Ctx);
