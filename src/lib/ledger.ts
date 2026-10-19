import { billPaise, splitEqual, type Paise, type SplitMode } from "./money.ts";

// ───────────────────────── Types (mirror Firestore documents) ─────────────────────────

export type Roommate = {
  id: string;
  name: string;
  upiId: string;
  role: "admin" | "member";
  order: number;
  authUid: string | null;
};

export type Expense = {
  id: string;
  name: string;
  amountPaise: Paise;
  categoryId: string;
  categoryLabel: string;
  payerId: string;
  splitMode: SplitMode;
  isPersonal: boolean;
  kind: "expense" | "utility";
  spentOn: string; // yyyy-mm-dd
  month: string; // yyyy-mm
  receiptUrl: string | null;
  note: string;
  /** roommateId → paise. Always sums to amountPaise. */
  shares: Record<string, Paise>;
  version: number;
  createdBy: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type UtilityKind = "electricity" | "gas";

export type UtilityBill = {
  id: string;
  kind: UtilityKind;
  startMilli: number;
  endMilli: number;
  unitsMilli: number;
  /** Rate applied when the bill was saved. Never recalculated afterwards. */
  ratePaise: Paise;
  amountPaise: Paise;
  readingDate: string;
  payerId: string;
  month: string;
  expenseId: string;
  createdAtMs: number;
};

export type RateChange = {
  id: string;
  kind: UtilityKind;
  ratePaise: Paise; // paise per unit
  effectiveMonth: string;
  note: string;
  createdAtMs: number;
};

export type FixedCharge = {
  id: string; // `${key}_${effectiveMonth}`
  key: string;
  name: string;
  amountPaise: Paise;
  frequency: "monthly" | "yearly" | "one_time";
  active: boolean;
  effectiveMonth: string;
  /** each = every roommate pays `amountPaise` (per person). custom = per-person amounts in customShares. */
  allocation: "each" | "custom";
  customShares: Record<string, Paise>;
  note: string;
  createdAtMs: number;
};

export type FixedSnapshotItem = {
  key: string;
  name: string;
  amountPaise: Paise;
  shares: Record<string, Paise>;
};

export type MonthDoc = {
  month: string;
  managerId: string | null;
  fixed: FixedSnapshotItem[] | null;
};

export type Payment = {
  id: string;
  month: string;
  fromId: string;
  toId: string;
  amountPaise: Paise;
  /** general = expense settlement; dues = fixed charges / utility bills owed to the manager. */
  kind: "general" | "dues";
  type: "payment" | "reversal";
  date: string;
  method: string;
  reference: string;
  note: string;
  /** True only when independently confirmed by a bank/UPI provider. Manual entries are always false. */
  verified: boolean;
  reversesId: string | null;
  reversedById: string | null;
  createdBy: string;
  createdAtMs: number;
};

export type Allocation = { id: string; month: string; roommateId: string; amountPaise: Paise };

export type WalletEntry = {
  id: string;
  month: string;
  roommateId: string;
  type: "shared" | "personal" | "utility" | "fixed";
  refId: string;
  label: string;
  amountPaise: Paise; // positive = spend
  date: string;
};

export type Settings = { carryForward: boolean };
export const DEFAULT_SETTINGS: Settings = { carryForward: false };

export const DEFAULT_RATES: Record<UtilityKind, Paise> = { electricity: 900, gas: 5000 };

// ───────────────────────── Months ─────────────────────────

export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

export function shiftMonth(m: string, delta: number): string {
  const [y = 0, mo = 1] = m.split("-").map(Number);
  const idx = y * 12 + (mo - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleString("en-IN", { month: "long", year: "numeric" });

// ───────────────────────── Rates & fixed charges ─────────────────────────

/** Rate in force for `month`: the latest change whose effective month is ≤ month. */
export function resolveRate(rates: RateChange[], kind: UtilityKind, month: string) {
  const applicable = rates
    .filter((r) => r.kind === kind && r.effectiveMonth <= month)
    .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth) || a.createdAtMs - b.createdAtMs);
  const hit = applicable[applicable.length - 1];
  return hit
    ? { ratePaise: hit.ratePaise, effectiveMonth: hit.effectiveMonth, note: hit.note, isDefault: false }
    : { ratePaise: DEFAULT_RATES[kind], effectiveMonth: "", note: "", isDefault: true };
}

function appliesIn(c: FixedCharge, month: string): boolean {
  if (!c.active || c.effectiveMonth > month) return false;
  if (c.frequency === "monthly") return true;
  if (c.frequency === "one_time") return c.effectiveMonth === month;
  return c.effectiveMonth.slice(5) === month.slice(5); // yearly
}

/** For each charge key, the latest version at or before `month` (active ones only). */
export function resolveFixedCharges(versions: FixedCharge[], month: string): FixedCharge[] {
  const latest = new Map<string, FixedCharge>();
  const sorted = [...versions]
    .filter((v) => v.effectiveMonth <= month)
    .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth) || a.createdAtMs - b.createdAtMs);
  for (const v of sorted) latest.set(v.key, v);
  return [...latest.values()].filter((c) => appliesIn(c, month));
}

/** Fixed charges are PER PERSON: rent ₹4,000 means each roommate pays ₹4,000 (not ₹4,000 split four ways). */
export function buildFixedSnapshot(charges: FixedCharge[], roommateIds: string[]): FixedSnapshotItem[] {
  return charges.map((c) => {
    const shares: Record<string, Paise> = {};
    if (c.allocation === "custom" && Object.keys(c.customShares).length > 0) {
      for (const id of roommateIds) {
        const v = c.customShares[id];
        if (v && v > 0) shares[id] = v;
      }
    } else for (const id of roommateIds) shares[id] = c.amountPaise;
    return { key: c.key, name: c.name, amountPaise: c.amountPaise, shares };
  });
}

export function validateCustomShares(shares: Record<string, Paise>): string | null {
  const vals = Object.values(shares);
  if (vals.some((v) => !Number.isInteger(v) || v < 0)) return "Amounts must be zero or more.";
  return vals.some((v) => v > 0) ? null : "Enter an amount for at least one person.";
}

// ───────────────────────── Utility bill preview ─────────────────────────

export function previewBill(startMilli: number | null, endMilli: number | null, ratePaise: Paise) {
  if (startMilli === null || endMilli === null) return { error: "Enter both readings as numbers.", unitsMilli: 0, amountPaise: 0 };
  if (endMilli < startMilli) return { error: "Current reading can't be lower than the previous reading.", unitsMilli: 0, amountPaise: 0 };
  const unitsMilli = endMilli - startMilli;
  return { error: null as string | null, unitsMilli, amountPaise: billPaise(unitsMilli, ratePaise) };
}

// ───────────────────────── Wallet entries ─────────────────────────

export function walletEntriesForExpense(e: Pick<Expense, "id" | "name" | "month" | "spentOn" | "kind" | "isPersonal" | "shares">): WalletEntry[] {
  const type: WalletEntry["type"] = e.isPersonal ? "personal" : e.kind === "utility" ? "utility" : "shared";
  return Object.entries(e.shares)
    .filter(([, amt]) => amt > 0)
    .map(([rid, amt]) => ({
      id: `${e.id}_${rid}`,
      month: e.month,
      roommateId: rid,
      type,
      refId: e.id,
      label: e.name,
      amountPaise: amt,
      date: e.spentOn,
    }));
}

export const walletEntryIdsForExpense = (e: Pick<Expense, "id" | "shares">) =>
  Object.keys(e.shares).map((rid) => `${e.id}_${rid}`);

export function walletEntriesForFixed(month: string, items: FixedSnapshotItem[]): WalletEntry[] {
  const out: WalletEntry[] = [];
  for (const it of items)
    for (const [rid, amt] of Object.entries(it.shares))
      if (amt > 0)
        out.push({ id: `fixed_${month}_${it.key}_${rid}`, month, roommateId: rid, type: "fixed", refId: `fixed_${month}_${it.key}`, label: it.name, amountPaise: amt, date: `${month}-01` });
  return out;
}

// ───────────────────────── Personal Vault ─────────────────────────

/** Allocation for a month: explicit entry, else inherited from the latest earlier month, else 0. */
export function allocationFor(allocs: Allocation[], roommateId: string, month: string) {
  const mine = allocs.filter((a) => a.roommateId === roommateId && a.month <= month).sort((a, b) => a.month.localeCompare(b.month));
  const hit = mine[mine.length - 1];
  return hit ? { amountPaise: hit.amountPaise, inherited: hit.month !== month, from: hit.month } : { amountPaise: 0, inherited: true, from: "" };
}

export type VaultSummary = {
  allocation: Paise;
  inherited: boolean;
  carry: Paise;
  available: Paise;
  spent: Paise;
  remaining: Paise;
  byType: Record<WalletEntry["type"], Paise>;
  utilisation: number; // 0..∞ (1 = 100%)
  status: "ok" | "low" | "over" | "unset";
};

const LOW_THRESHOLD = 0.2;

export function vaultSummary(
  roommateId: string,
  month: string,
  allocs: Allocation[],
  entries: WalletEntry[],
  carryForward: boolean,
): VaultSummary {
  const mine = entries.filter((e) => e.roommateId === roommateId);
  const spentIn = (m: string) => mine.filter((e) => e.month === m).reduce((s, e) => s + e.amountPaise, 0);

  let carry = 0;
  if (carryForward) {
    const months = [...allocs.filter((a) => a.roommateId === roommateId).map((a) => a.month), ...mine.map((e) => e.month)].filter((m) => m < month).sort();
    const first = months[0];
    if (first) {
      let bal = 0;
      let m = first;
      for (let i = 0; i < 240 && m < month; i++, m = shiftMonth(m, 1)) bal = allocationFor(allocs, roommateId, m).amountPaise + bal - spentIn(m);
      carry = bal;
    }
  }

  const a = allocationFor(allocs, roommateId, month);
  const spent = spentIn(month);
  const byType: VaultSummary["byType"] = { shared: 0, personal: 0, utility: 0, fixed: 0 };
  for (const e of mine) if (e.month === month) byType[e.type] += e.amountPaise;
  const available = a.amountPaise + carry;
  const remaining = available - spent;
  const utilisation = available > 0 ? spent / available : spent > 0 ? Infinity : 0;
  const status: VaultSummary["status"] = available <= 0 && spent === 0 ? "unset" : remaining < 0 ? "over" : utilisation >= 1 - LOW_THRESHOLD ? "low" : "ok";
  return { allocation: a.amountPaise, inherited: a.inherited, carry, available, spent, remaining, byType, utilisation, status };
}

// ───────────────────────── Settlement ─────────────────────────

export type Obligation = { from: string; to: string; amountPaise: Paise; label: string; detail: string; date: string; kind: "expense" | "utility" | "fixed" };

export type Balance = {
  kind: "general" | "dues";
  fromId: string; // debtor (direction of remaining amount)
  toId: string;
  originalPaise: Paise;
  paidPaise: Paise;
  remainingPaise: Paise;
  settled: boolean;
  lines: Obligation[];
  reverseLines: Obligation[];
  /** Every payment recorded between these two people for this bucket (newest first), reversed ones included. */
  payments: Payment[];
};

export const activePayments = (ps: Payment[]) => ps.filter((p) => p.type === "payment" && !p.reversedById);

function sumBy<T>(xs: T[], f: (x: T) => number) {
  return xs.reduce((s, x) => s + f(x), 0);
}

/** Expense obligations: each non-payer share of a shared (non-utility) expense is owed to the payer. */
export function expenseObligations(expenses: Expense[]): Obligation[] {
  const out: Obligation[] = [];
  for (const e of expenses) {
    if (e.isPersonal || e.kind === "utility") continue;
    for (const [rid, amt] of Object.entries(e.shares)) {
      if (rid === e.payerId || amt <= 0) continue;
      out.push({ from: rid, to: e.payerId, amountPaise: amt, label: e.name, detail: e.categoryLabel, date: e.spentOn, kind: "expense" });
    }
  }
  return out;
}

/** Dues obligations: fixed-charge shares owed to the month's manager, utility shares owed to whoever fronted the bill. */
export function duesObligations(expenses: Expense[], fixed: FixedSnapshotItem[] | null, managerId: string | null): Obligation[] {
  const out: Obligation[] = [];
  for (const e of expenses) {
    if (e.kind !== "utility") continue;
    for (const [rid, amt] of Object.entries(e.shares))
      if (rid !== e.payerId && amt > 0) out.push({ from: rid, to: e.payerId, amountPaise: amt, label: e.name, detail: "Meter bill", date: e.spentOn, kind: "utility" });
  }
  if (managerId && fixed)
    for (const it of fixed)
      for (const [rid, amt] of Object.entries(it.shares))
        if (rid !== managerId && amt > 0) out.push({ from: rid, to: managerId, amountPaise: amt, label: it.name, detail: "Monthly fixed charge", date: "", kind: "fixed" });
  return out;
}

/** Net obligations pairwise (general) or keep one-directional (dues), then subtract active recorded payments. */
export function buildBalances(obligations: Obligation[], payments: Payment[], kind: "general" | "dues"): Balance[] {
  const paid = activePayments(payments).filter((p) => p.kind === kind);
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const keys = new Set<string>([...obligations.map((o) => pairKey(o.from, o.to)), ...paid.map((p) => pairKey(p.fromId, p.toId))]);
  const out: Balance[] = [];
  for (const key of [...keys].sort()) {
    const [a = "", b = ""] = key.split("|");
    const fwd = obligations.filter((o) => o.from === a && o.to === b);
    const bwd = obligations.filter((o) => o.from === b && o.to === a);
    const payFwd = sumBy(paid.filter((p) => p.fromId === a && p.toId === b), (p) => p.amountPaise);
    const payBwd = sumBy(paid.filter((p) => p.fromId === b && p.toId === a), (p) => p.amountPaise);
    const grossNet = sumBy(fwd, (o) => o.amountPaise) - sumBy(bwd, (o) => o.amountPaise); // + means a owes b
    const remaining = grossNet - (payFwd - payBwd);
    const aOwes = remaining > 0 || (remaining === 0 && grossNet >= 0);
    out.push({
      kind,
      fromId: aOwes ? a : b,
      toId: aOwes ? b : a,
      originalPaise: Math.abs(grossNet),
      paidPaise: aOwes === grossNet >= 0 ? Math.abs(payFwd - payBwd) : -Math.abs(payFwd - payBwd),
      remainingPaise: Math.abs(remaining),
      settled: remaining === 0,
      lines: aOwes ? fwd : bwd,
      reverseLines: aOwes ? bwd : fwd,
      payments: payments.filter((p) => p.kind === kind && p.type === "payment" && pairKey(p.fromId, p.toId) === key).sort((x, y) => y.createdAtMs - x.createdAtMs),
    });
  }
  return out;
}

/** Payment validation: positive integer paise, not above what is still owed. */
export function validatePayment(amountPaise: number | null, remainingPaise: Paise): string | null {
  if (amountPaise === null) return "Enter a valid amount (up to 2 decimals).";
  if (amountPaise <= 0) return "Payment must be greater than zero.";
  if (amountPaise > remainingPaise) return "Payment can't be more than the remaining balance.";
  return null;
}

// ───────────────────────── Month summaries ─────────────────────────

export type PersonMonth = { paid: Paise; shared: Paise; utility: Paise; fixed: Paise; personal: Paise; total: Paise };

export function personMonthStats(roommateIds: string[], expenses: Expense[], fixed: FixedSnapshotItem[] | null): Record<string, PersonMonth> {
  const out: Record<string, PersonMonth> = {};
  for (const id of roommateIds) out[id] = { paid: 0, shared: 0, utility: 0, fixed: 0, personal: 0, total: 0 };
  for (const e of expenses) {
    const payer = out[e.payerId];
    if (payer && !e.isPersonal) payer.paid += e.amountPaise;
    for (const [rid, amt] of Object.entries(e.shares)) {
      const p = out[rid];
      if (!p) continue;
      if (e.isPersonal) p.personal += amt;
      else if (e.kind === "utility") p.utility += amt;
      else p.shared += amt;
    }
  }
  for (const it of fixed ?? []) for (const [rid, amt] of Object.entries(it.shares)) if (out[rid]) out[rid]!.fixed += amt;
  for (const p of Object.values(out)) p.total = p.shared + p.utility + p.fixed + p.personal;
  return out;
}

/** Shared + utility spending only. Fixed charges are individual, so they are not part of the shared total. */
export function householdTotal(expenses: Expense[]): Paise {
  return sumBy(expenses.filter((e) => !e.isPersonal), (e) => e.amountPaise);
}

export function categoryTotals(expenses: Expense[]): { categoryId: string; label: string; total: Paise }[] {
  const m = new Map<string, { categoryId: string; label: string; total: Paise }>();
  for (const e of expenses) {
    const row = m.get(e.categoryId) ?? { categoryId: e.categoryId, label: e.categoryLabel, total: 0 };
    row.total += e.amountPaise;
    m.set(e.categoryId, row);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
