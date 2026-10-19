import {
  collection, doc, getDocs, limit, orderBy, query, runTransaction, setDoc, writeBatch,
  type DocumentData, type DocumentSnapshot,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  buildFixedSnapshot, resolveFixedCharges, walletEntriesForExpense, walletEntriesForFixed, walletEntryIdsForExpense,
  type Expense, type FixedCharge, type FixedSnapshotItem, type MonthDoc, type Payment, type Roommate, type Settings,
  type UtilityBill, type UtilityKind, type WalletEntry,
} from "./ledger";
import type { Paise, SplitMode } from "./money";
import type { Category } from "./categories";

export const C = {
  roommates: "roommates", members: "members", settings: "settings", rates: "rates", fixed: "fixedCharges",
  categories: "categories", allocations: "allocations", wallet: "walletEntries", expenses: "expenses",
  bills: "utilityBills", payments: "payments", months: "months", audit: "audit",
} as const;

export const fromDoc = <T>(snap: DocumentSnapshot<DocumentData>): T => ({ ...snap.data(), id: snap.id }) as T;
const strip = <T extends { id?: string }>(o: T): DocumentData => {
  const { id: _id, ...rest } = o;
  return rest;
};
const newId = (col: string) => doc(collection(db, col)).id;
const now = () => Date.now();

function audit(actorId: string, action: string, entity: string, entityId: string, summary: string, data?: unknown) {
  return {
    ref: doc(collection(db, C.audit)),
    data: { atMs: now(), actorId, action, entity, entityId, summary, data: data === undefined ? "" : JSON.stringify(data).slice(0, 4000) },
  };
}

// ───────────── Expenses ─────────────

export type ExpenseInput = {
  id?: string;
  name: string;
  amountPaise: Paise;
  categoryId: string;
  categoryLabel: string;
  payerId: string;
  splitMode: SplitMode;
  shares: Record<string, Paise>;
  spentOn: string;
  receiptUrl: string | null;
  note: string;
};

/** Atomically writes the expense and replaces its wallet ledger entries (ids are deterministic, so nothing double-counts). */
export async function saveExpense(input: ExpenseInput, actorId: string, existing?: Expense): Promise<string> {
  const id = existing?.id ?? input.id ?? newId(C.expenses);
  await runTransaction(db, async (tx) => {
    const ref = doc(db, C.expenses, id);
    let prev: Expense | null = null;
    if (existing) {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("This expense was deleted by someone else.");
      prev = fromDoc<Expense>(snap);
      if (prev.version !== existing.version) throw new Error("Someone else just changed this expense. Close and reopen it to see the latest.");
    }
    const next: Expense = {
      id, name: input.name.trim(), amountPaise: input.amountPaise, categoryId: input.categoryId, categoryLabel: input.categoryLabel,
      payerId: input.payerId, splitMode: input.splitMode, isPersonal: input.splitMode === "personal",
      kind: prev?.kind ?? "expense", spentOn: input.spentOn, month: input.spentOn.slice(0, 7), receiptUrl: input.receiptUrl,
      note: input.note.trim(), shares: input.shares, version: (prev?.version ?? 0) + 1,
      createdBy: prev?.createdBy ?? actorId, createdAtMs: prev?.createdAtMs ?? now(), updatedAtMs: now(),
    };
    if (prev) for (const wid of walletEntryIdsForExpense(prev)) tx.delete(doc(db, C.wallet, wid));
    tx.set(ref, strip(next));
    for (const w of walletEntriesForExpense(next)) tx.set(doc(db, C.wallet, w.id), strip(w));
    const a = audit(actorId, prev ? "update" : "create", "expense", id, `${prev ? "Edited" : "Added"} ${next.name}`, { before: prev && { amount: prev.amountPaise, shares: prev.shares }, after: { amount: next.amountPaise, shares: next.shares } });
    tx.set(a.ref, a.data);
  });
  return id;
}

export async function deleteExpense(e: Expense, actorId: string) {
  if (e.kind === "utility") throw new Error("Delete utility expenses from the Utility bills tab.");
  await runTransaction(db, async (tx) => {
    const ref = doc(db, C.expenses, e.id);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const cur = fromDoc<Expense>(snap);
    for (const wid of walletEntryIdsForExpense(cur)) tx.delete(doc(db, C.wallet, wid));
    tx.delete(ref);
    const a = audit(actorId, "delete", "expense", e.id, `Deleted ${cur.name}`, { amount: cur.amountPaise, shares: cur.shares });
    tx.set(a.ref, a.data);
  });
}

// ───────────── Utility bills ─────────────

export type BillInput = {
  kind: UtilityKind; startMilli: number; endMilli: number; unitsMilli: number; ratePaise: Paise; amountPaise: Paise;
  readingDate: string; payerId: string; shares: Record<string, Paise>;
};

export async function saveUtilityBill(input: BillInput, actorId: string) {
  const expenseId = newId(C.expenses);
  const billId = newId(C.bills);
  const month = input.readingDate.slice(0, 7);
  const name = input.kind === "electricity" ? "Electricity meter" : "Gas meter";
  const expense: Expense = {
    id: expenseId, name, amountPaise: input.amountPaise, categoryId: input.kind, categoryLabel: input.kind === "electricity" ? "Electricity" : "Gas",
    payerId: input.payerId, splitMode: "equal", isPersonal: false, kind: "utility", spentOn: input.readingDate, month, receiptUrl: null, note: "",
    shares: input.shares, version: 1, createdBy: actorId, createdAtMs: now(), updatedAtMs: now(),
  };
  const bill: UtilityBill = {
    id: billId, kind: input.kind, startMilli: input.startMilli, endMilli: input.endMilli, unitsMilli: input.unitsMilli, ratePaise: input.ratePaise,
    amountPaise: input.amountPaise, readingDate: input.readingDate, payerId: input.payerId, month, expenseId, createdAtMs: now(),
  };
  const batch = writeBatch(db);
  batch.set(doc(db, C.expenses, expenseId), strip(expense));
  batch.set(doc(db, C.bills, billId), strip(bill));
  for (const w of walletEntriesForExpense(expense)) batch.set(doc(db, C.wallet, w.id), strip(w));
  const a = audit(actorId, "create", "utilityBill", billId, `Recorded ${name} bill`, { units: input.unitsMilli, rate: input.ratePaise, amount: input.amountPaise });
  batch.set(a.ref, a.data);
  await batch.commit();
}

export async function deleteUtilityBill(bill: UtilityBill, expense: Expense | undefined, actorId: string) {
  const batch = writeBatch(db);
  if (expense) for (const wid of walletEntryIdsForExpense(expense)) batch.delete(doc(db, C.wallet, wid));
  batch.delete(doc(db, C.expenses, bill.expenseId));
  batch.delete(doc(db, C.bills, bill.id));
  const a = audit(actorId, "delete", "utilityBill", bill.id, `Deleted ${bill.kind} bill`, { amount: bill.amountPaise });
  batch.set(a.ref, a.data);
  await batch.commit();
}

export async function fetchLastReading(kind: UtilityKind): Promise<{ endMilli: number; readingDate: string } | null> {
  const snap = await getDocs(query(collection(db, C.bills), orderBy("readingDate", "desc"), limit(12)));
  const hit = snap.docs.map((d) => fromDoc<UtilityBill>(d)).find((b) => b.kind === kind);
  return hit ? { endMilli: hit.endMilli, readingDate: hit.readingDate } : null;
}

// ───────────── Payments ─────────────

export type PaymentInput = Pick<Payment, "month" | "fromId" | "toId" | "amountPaise" | "kind" | "date" | "method" | "reference" | "note">;

/** `requestId` becomes the document id, so a double-tap or retry can never record the payment twice. */
export async function recordPayment(requestId: string, input: PaymentInput, actorId: string) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, C.payments, requestId);
    if ((await tx.get(ref)).exists()) return;
    const p: Payment = { id: requestId, ...input, type: "payment", verified: false, reversesId: null, reversedById: null, createdBy: actorId, createdAtMs: now() };
    tx.set(ref, strip(p));
    const a = audit(actorId, "create", "payment", requestId, `Payment recorded`, { from: input.fromId, to: input.toId, amount: input.amountPaise });
    tx.set(a.ref, a.data);
  });
}

/** Corrections are reversals: the original is kept, flagged, and a linked reversal record is added. */
export async function reversePayment(original: Payment, reason: string, actorId: string) {
  const reversalId = `rev_${original.id}`;
  await runTransaction(db, async (tx) => {
    const ref = doc(db, C.payments, original.id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Payment not found.");
    if (fromDoc<Payment>(snap).reversedById) throw new Error("This payment was already reversed.");
    const rev: Payment = { ...original, id: reversalId, type: "reversal", reversesId: original.id, reversedById: null, note: reason, createdBy: actorId, createdAtMs: now() };
    tx.set(doc(db, C.payments, reversalId), strip(rev));
    tx.update(ref, { reversedById: reversalId });
    const a = audit(actorId, "reverse", "payment", original.id, "Payment reversed", { reason, amount: original.amountPaise });
    tx.set(a.ref, a.data);
  });
}

// ───────────── Months, manager, fixed charges ─────────────

export async function ensureMonth(month: string, roommates: Roommate[], versions: readonly FixedCharge[]) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, C.months, month);
    const snap = await tx.get(ref);
    const cur = snap.exists() ? (snap.data() as Partial<MonthDoc>) : {};
    if (cur.fixed) return;
    const items = buildFixedSnapshot(resolveFixedCharges([...versions], month), roommates.map((r) => r.id));
    tx.set(ref, { month, managerId: cur.managerId ?? null, fixed: items }, { merge: true });
    for (const w of walletEntriesForFixed(month, items)) tx.set(doc(db, C.wallet, w.id), strip(w));
  });
}

/** Admin action: replace this month's fixed-charge snapshot with the currently effective charges. */
export async function resnapshotMonth(month: string, roommates: Roommate[], versions: readonly FixedCharge[], actorId: string, staleWalletIds: string[] = []) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, C.months, month);
    const snap = await tx.get(ref);
    const old = ((snap.data() as Partial<MonthDoc> | undefined)?.fixed ?? []) as FixedSnapshotItem[];
    for (const w of walletEntriesForFixed(month, old)) tx.delete(doc(db, C.wallet, w.id));
    for (const id of staleWalletIds) tx.delete(doc(db, C.wallet, id));
    const items = buildFixedSnapshot(resolveFixedCharges([...versions], month), roommates.map((r) => r.id));
    tx.set(ref, { month, fixed: items }, { merge: true });
    for (const w of walletEntriesForFixed(month, items)) tx.set(doc(db, C.wallet, w.id), strip(w));
    const a = audit(actorId, "resnapshot", "month", month, `Fixed charges re-applied for ${month}`);
    tx.set(a.ref, a.data);
  });
}

export async function setManager(month: string, managerId: string, actorId: string) {
  const batch = writeBatch(db);
  batch.set(doc(db, C.months, month), { month, managerId }, { merge: true });
  const a = audit(actorId, "update", "month", month, "Manager changed", { managerId });
  batch.set(a.ref, a.data);
  await batch.commit();
}

export async function addRate(r: { kind: UtilityKind; ratePaise: Paise; effectiveMonth: string; note: string }, actorId: string) {
  const batch = writeBatch(db);
  const ref = doc(collection(db, C.rates));
  batch.set(ref, { ...r, createdAtMs: now() });
  const a = audit(actorId, "create", "rate", ref.id, `${r.kind} rate ₹${r.ratePaise / 100}/unit from ${r.effectiveMonth}`);
  batch.set(a.ref, a.data);
  await batch.commit();
}

// ───────────── Vault, categories, settings, profile ─────────────

export async function setAllocation(month: string, roommateId: string, amountPaise: Paise, previous: Paise, actorId: string) {
  const batch = writeBatch(db);
  const id = `${month}_${roommateId}`;
  batch.set(doc(db, C.allocations, id), { month, roommateId, amountPaise, updatedAtMs: now() });
  const a = audit(actorId, "upsert", "allocation", id, `Vault allocation ₹${previous / 100} → ₹${amountPaise / 100}`, { previous, amountPaise });
  batch.set(a.ref, a.data);
  await batch.commit();
}

export async function saveCategory(c: Category, actorId: string) {
  const batch = writeBatch(db);
  batch.set(doc(db, C.categories, c.id), strip(c));
  const a = audit(actorId, "upsert", "category", c.id, `Category ${c.label}`);
  batch.set(a.ref, a.data);
  await batch.commit();
}

export const saveSettings = (s: Settings, actorId: string) => {
  const batch = writeBatch(db);
  batch.set(doc(db, C.settings, "household"), s, { merge: true });
  const a = audit(actorId, "update", "settings", "household", `Carry-forward ${s.carryForward ? "on" : "off"}`);
  batch.set(a.ref, a.data);
  return batch.commit();
};

export const updateMyUpi = (roommateId: string, upiId: string) => setDoc(doc(db, C.roommates, roommateId), { upiId }, { merge: true });

export async function claimRoommate(uid: string, roommateId: string) {
  const batch = writeBatch(db);
  batch.set(doc(db, C.members, uid), { roommateId });
  batch.update(doc(db, C.roommates, roommateId), { authUid: uid });
  await batch.commit();
}

export type { WalletEntry };
