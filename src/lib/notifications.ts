import { collection, deleteDoc, doc, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "./firebase";
import { formatPaise, type Paise } from "./money";

/**
 * In-app notifications, stored in Firestore (`notifications`). Only the recipient can read them
 * (see firestore.rules). Every send is best-effort: a notification failing must never break the
 * expense / payment / bill that triggered it.
 */

export type NotifType = "nudge" | "month_end" | "new_month" | "expense" | "payment" | "reversal" | "bill" | "wallet" | "manager";

export type AppNotification = {
  id: string;
  toId: string;
  fromId: string;
  type: NotifType;
  title: string;
  body: string;
  /** In-app route to open when tapped. */
  link: string;
  amountPaise: Paise | null;
  createdAtMs: number;
  readAtMs: number | null;
};

type NewNotification = Omit<AppNotification, "id" | "createdAtMs" | "readAtMs" | "amountPaise"> & { amountPaise?: Paise | null };

const COL = "notifications";
const now = () => Date.now();

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Writes one notification. With an explicit `id` it can only ever be created once (a rewrite is refused by the rules). */
export async function sendNotification(n: NewNotification, id?: string): Promise<void> {
  const ref = id ? doc(db, COL, id) : doc(collection(db, COL));
  await setDoc(ref, { ...n, amountPaise: n.amountPaise ?? null, createdAtMs: now(), readAtMs: null });
}

/** Fire-and-forget version used after saves: never throws. */
export function sendQuietly(list: NewNotification[]): void {
  for (const n of list) void sendNotification(n).catch(() => {});
}

export const markRead = (id: string) => updateDoc(doc(db, COL, id), { readAtMs: now() });
export const removeNotification = (id: string) => deleteDoc(doc(db, COL, id));

export async function markAllRead(ids: string[]) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    const t = now();
    for (const id of ids.slice(i, i + 400)) batch.update(doc(db, COL, id), { readAtMs: t });
    await batch.commit();
  }
}

export async function removeMany(ids: string[]) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + 400)) batch.delete(doc(db, COL, id));
    await batch.commit();
  }
}

// ───────────── Nudges ─────────────

export type NudgeTarget = { debtorId: string; amountPaise: Paise; what: string };

const NUDGED_KEY = "room-ledger-nudged";
const readNudged = (): Record<string, true> => { try { return JSON.parse(localStorage.getItem(NUDGED_KEY) ?? "{}"); } catch { return {}; } };

export type NudgeResult = "sent" | "already" | "failed";

/**
 * Sends one friendly reminder. The id is `nudge_<me>_<them>_<date>`, so each person can be nudged at most once per day
 * (a second attempt is refused by the database, which is what stops nudge-spam).
 */
export async function nudge(me: { id: string; name: string }, t: NudgeTarget, upiId?: string): Promise<NudgeResult> {
  const id = `nudge_${me.id}_${t.debtorId}_${dayKey()}`;
  const seen = readNudged();
  if (seen[id]) return "already";
  try {
    await sendNotification({
      toId: t.debtorId, fromId: me.id, type: "nudge", link: "/settlement",
      title: `${me.name} is waiting on ${formatPaise(t.amountPaise)}`,
      body: `Friendly reminder to settle ${t.what}.${upiId ? ` Pay on UPI: ${upiId}` : ""}`,
      amountPaise: t.amountPaise,
    }, id);
    try { localStorage.setItem(NUDGED_KEY, JSON.stringify({ ...Object.fromEntries(Object.keys(seen).slice(-200).map((k) => [k, true])), [id]: true })); } catch { /* storage full or blocked */ }
    return "sent";
  } catch (e) {
    // A refusal on a deterministic id almost always means today's nudge already exists.
    return (e as { code?: string }).code === "permission-denied" ? "already" : "failed";
  }
}

// ───────────── Activity notifications (best effort, after the main save succeeds) ─────────────

type Names = (id: string) => string;

export function notifyExpenseSaved(
  e: { name: string; amountPaise: Paise; shares: Record<string, Paise>; isPersonal: boolean },
  actor: { id: string; name: string }, edited: boolean,
) {
  if (e.isPersonal) return; // personal expenses are private: never announce them
  sendQuietly(Object.entries(e.shares).filter(([id, share]) => id !== actor.id && share > 0).map(([id, share]) => ({
    toId: id, fromId: actor.id, type: "expense" as const, link: "/expenses",
    title: `${actor.name} ${edited ? "updated" : "added"} “${e.name}”`,
    body: `${formatPaise(e.amountPaise)} in total · your share is ${formatPaise(share)}`,
    amountPaise: share,
  })));
}

export function notifyPayment(
  p: { fromId: string; toId: string; amountPaise: Paise }, actor: { id: string; name: string }, nameOf: Names, reversed: boolean,
) {
  const others = [p.fromId, p.toId].filter((id) => id !== actor.id);
  sendQuietly(others.map((id) => ({
    toId: id, fromId: actor.id, type: reversed ? "reversal" as const : "payment" as const, link: "/settlement",
    title: reversed ? `Payment of ${formatPaise(p.amountPaise)} was reversed` : p.toId === id ? `${nameOf(p.fromId)} paid you ${formatPaise(p.amountPaise)}` : `${formatPaise(p.amountPaise)} payment to ${nameOf(p.toId)} recorded`,
    body: reversed ? `${actor.name} reversed the payment between ${nameOf(p.fromId)} and ${nameOf(p.toId)}.` : `Recorded by ${actor.name}.`,
    amountPaise: p.amountPaise,
  })));
}

export function notifyBill(
  b: { kind: string; amountPaise: Paise; shares: Record<string, Paise> }, actor: { id: string; name: string },
) {
  sendQuietly(Object.entries(b.shares).filter(([id, share]) => id !== actor.id && share > 0).map(([id, share]) => ({
    toId: id, fromId: actor.id, type: "bill" as const, link: "/expenses",
    title: `${b.kind === "electricity" ? "Electricity" : "Gas"} bill added: ${formatPaise(b.amountPaise)}`,
    body: `Your share is ${formatPaise(share)}.`, amountPaise: share,
  })));
}

export function notifyManager(managerId: string, monthText: string, actor: { id: string; name: string }) {
  if (managerId === actor.id) return;
  sendQuietly([{ toId: managerId, fromId: actor.id, type: "manager", link: "/household?tab=manager", title: `You're the manager for ${monthText}`, body: `${actor.name} picked you to collect rent and fixed charges.` }]);
}
