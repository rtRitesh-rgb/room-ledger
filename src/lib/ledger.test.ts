import { test } from "node:test";
import assert from "node:assert/strict";
import { billPaise, computeSplit, formatPaise, parseMilli, parseRupees, splitEqual } from "./money.ts";
import {
  buildBalances, buildFixedSnapshot, duesObligations, expenseObligations, previewBill, resolveFixedCharges, resolveRate,
  validatePayment, vaultSummary, walletEntriesForExpense, shiftMonth,
  type Allocation, type Expense, type FixedCharge, type Payment, type RateChange, type WalletEntry,
} from "./ledger.ts";

const IDS = ["a", "b", "c", "d"];

function exp(p: Partial<Expense> & { id: string; amountPaise: number; payerId: string; shares: Record<string, number> }): Expense {
  return { name: "x", categoryId: "dmart", categoryLabel: "Dmart", splitMode: "equal", isPersonal: false, kind: "expense", spentOn: "2026-10-05", month: "2026-10", receiptUrl: null, note: "", version: 1, createdBy: "a", createdAtMs: 0, updatedAtMs: 0, ...p };
}
function pay(p: Partial<Payment> & { id: string; fromId: string; toId: string; amountPaise: number }): Payment {
  return { month: "2026-10", kind: "general", type: "payment", date: "2026-10-10", method: "UPI", reference: "", note: "", verified: false, reversesId: null, reversedById: null, createdBy: "a", createdAtMs: 0, ...p };
}

test("parsing rejects bad input and negatives", () => {
  assert.equal(parseRupees("1,200.5"), 120050);
  assert.equal(parseRupees("-5"), null);
  assert.equal(parseRupees("abc"), null);
  assert.equal(parseRupees("1.234"), null);
  assert.equal(parseMilli("12.5"), 12500);
});

test("₹100 split three ways totals exactly ₹100, remainder to first in order", () => {
  const s = splitEqual(10000, ["a", "b", "c"]);
  assert.deepEqual(s, { a: 3334, b: 3333, c: 3333 });
  assert.equal(Object.values(s).reduce((x, y) => x + y, 0), 10000);
});

test("₹1,200 across four = ₹300 each", () => {
  assert.deepEqual(splitEqual(120000, IDS), { a: 30000, b: 30000, c: 30000, d: 30000 });
});

test("custom split: negative, invalid, mismatch are all reported, none silently dropped", () => {
  const base = { mode: "custom" as const, total: 10000, order: IDS, payerId: "a", included: [] };
  assert.match(computeSplit({ ...base, raw: { a: "-1", b: "101" } }).errors["a"]!, /negative/);
  assert.match(computeSplit({ ...base, raw: { a: "x" } }).errors["a"]!, /valid/);
  assert.match(computeSplit({ ...base, raw: { a: "40", b: "50" } }).errors["_form"]!, /short/);
  assert.match(computeSplit({ ...base, raw: { a: "60", b: "50" } }).errors["_form"]!, /exceed/);
  const ok = computeSplit({ ...base, raw: { a: "40", b: "60" } });
  assert.ok(ok.ok);
  assert.deepEqual(ok.shares, { a: 4000, b: 6000 });
});

test("percent split reconciles exactly", () => {
  const r = computeSplit({ mode: "percent", total: 10000, order: IDS, payerId: "a", included: [], raw: { a: "33.33", b: "33.33", c: "33.34" } });
  assert.ok(r.ok);
  assert.equal(Object.values(r.shares).reduce((x, y) => x + y, 0), 10000);
  assert.ok(!computeSplit({ mode: "percent", total: 10000, order: IDS, payerId: "a", included: [], raw: { a: "50" } }).ok);
});

test("utility bill uses integer maths and the rate that applies to the month", () => {
  assert.equal(billPaise(123456, 900), 111110); // 123.456 units × ₹9 = ₹1111.104 → ₹1111.10
  const rates: RateChange[] = [
    { id: "1", kind: "electricity", ratePaise: 900, effectiveMonth: "2000-01", note: "", createdAtMs: 0 },
    { id: "2", kind: "electricity", ratePaise: 1000, effectiveMonth: "2026-11", note: "", createdAtMs: 1 },
  ];
  assert.equal(resolveRate(rates, "electricity", "2026-10").ratePaise, 900);
  assert.equal(resolveRate(rates, "electricity", "2026-11").ratePaise, 1000);
  assert.equal(resolveRate([], "gas", "2026-10").ratePaise, 5000);
  assert.ok(previewBill(5000, 4000, 900).error);
  assert.equal(previewBill(1000, 11000, 900).amountPaise, 9000);
});

test("fixed charges keep history: new version only affects its effective month onward", () => {
  const mk = (key: string, amt: number, eff: string): FixedCharge => ({ id: `${key}_${eff}`, key, name: key, amountPaise: amt, frequency: "monthly", active: true, effectiveMonth: eff, allocation: "each", customShares: {}, note: "", createdAtMs: 0 });
  const v = [mk("rent", 400000, "2000-01"), mk("rent", 450000, "2026-12"), mk("water", 10000, "2000-01")];
  assert.equal(resolveFixedCharges(v, "2026-11").find((c) => c.key === "rent")!.amountPaise, 400000);
  assert.equal(resolveFixedCharges(v, "2026-12").find((c) => c.key === "rent")!.amountPaise, 450000);
  const snap = buildFixedSnapshot(resolveFixedCharges(v, "2026-11"), IDS);
  // per person: everyone pays the full ₹4,000 rent, it is NOT split four ways
  assert.deepEqual(snap.find((s) => s.key === "rent")!.shares, { a: 400000, b: 400000, c: 400000, d: 400000 });
  const custom = buildFixedSnapshot([{ ...mk("wifi", 0, "2000-01"), allocation: "custom", customShares: { a: 30000, c: 20000 } }], IDS);
  assert.deepEqual(custom[0]!.shares, { a: 30000, c: 20000 });
});

test("wallet: shared expense deducts each share exactly once; edit replaces entries by id", () => {
  const e = exp({ id: "e1", amountPaise: 120000, payerId: "a", shares: splitEqual(120000, IDS) });
  const entries = walletEntriesForExpense(e);
  assert.equal(entries.length, 4);
  const allocs: Allocation[] = IDS.map((id) => ({ id: `2026-10_${id}`, month: "2026-10", roommateId: id, amountPaise: 500000 }));
  assert.equal(vaultSummary("b", "2026-10", allocs, entries, false).remaining, 470000);
  // Edit to ₹800 split across two: ids are deterministic so the old entries are replaced, never stacked.
  const edited = exp({ id: "e1", amountPaise: 80000, payerId: "a", shares: splitEqual(80000, ["a", "b"]) });
  const map = new Map<string, WalletEntry>(entries.map((x) => [x.id, x]));
  for (const id of Object.keys(e.shares).map((r) => `e1_${r}`)) map.delete(id);
  for (const x of walletEntriesForExpense(edited)) map.set(x.id, x);
  const after = [...map.values()];
  assert.equal(vaultSummary("b", "2026-10", allocs, after, false).remaining, 460000);
  assert.equal(vaultSummary("c", "2026-10", allocs, after, false).remaining, 500000);
});

test("wallet: payments never touch the wallet; over-allocation flagged; carry-forward is opt-in", () => {
  const allocs: Allocation[] = [{ id: "1", month: "2026-09", roommateId: "a", amountPaise: 100000 }];
  const entries: WalletEntry[] = [{ id: "z", month: "2026-09", roommateId: "a", type: "shared", refId: "z", label: "", amountPaise: 30000, date: "" }];
  assert.equal(vaultSummary("a", "2026-10", allocs, entries, false).available, 100000); // inherited allocation, no carry
  assert.equal(vaultSummary("a", "2026-10", allocs, entries, true).available, 170000);
  const over: WalletEntry[] = [{ ...entries[0]!, month: "2026-10", amountPaise: 120000 }];
  assert.equal(vaultSummary("a", "2026-10", allocs, over, false).status, "over");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("settlement: netting, partial payments, history, and reversals", () => {
  const exps = [
    exp({ id: "e1", amountPaise: 1500, payerId: "a", shares: { a: 0, b: 1500 } }),
    exp({ id: "e2", amountPaise: 500, payerId: "b", shares: { a: 500 } }),
  ];
  const obs = expenseObligations(exps);
  let [bal] = buildBalances(obs, [], "general");
  assert.equal(bal!.fromId, "b");
  assert.equal(bal!.originalPaise, 1000); // 1500 − 500 netted
  assert.equal(bal!.lines[0]!.date, "2026-10-05");
  assert.equal(bal!.reverseLines.length, 1);
  const p1 = pay({ id: "p1", fromId: "b", toId: "a", amountPaise: 300 });
  [bal] = buildBalances(obs, [p1], "general");
  assert.deepEqual([bal!.originalPaise, bal!.paidPaise, bal!.remainingPaise], [1000, 300, 700]);
  assert.equal(validatePayment(800, 700), "Payment can't be more than the remaining balance.");
  assert.equal(validatePayment(-1, 700), "Payment must be greater than zero.");
  assert.equal(validatePayment(700, 700), null);
  // Reversing p1 restores the balance; the record is kept.
  [bal] = buildBalances(obs, [{ ...p1, reversedById: "r1" }], "general");
  assert.equal(bal!.remainingPaise, 1000);
  [bal] = buildBalances(obs, [p1, pay({ id: "p2", fromId: "b", toId: "a", amountPaise: 700 })], "general");
  assert.ok(bal!.settled);
});

test("utility dues and fixed dues are separate from expense settlement (no double counting)", () => {
  const util = exp({ id: "u1", kind: "utility", amountPaise: 400000, payerId: "a", shares: splitEqual(400000, IDS) });
  const shared = exp({ id: "e1", amountPaise: 100, payerId: "a", shares: { a: 50, b: 50 } });
  assert.equal(expenseObligations([util, shared]).length, 1);
  const dues = duesObligations([util, shared], [{ key: "rent", name: "Rent", amountPaise: 400000, shares: { a: 400000, b: 400000, c: 400000, d: 400000 } }], "a");
  assert.equal(dues.filter((d) => d.from === "b").reduce((s, d) => s + d.amountPaise, 0), 500000); // ₹1,000 meter share + ₹4,000 rent
  const [b] = buildBalances(dues.filter((d) => d.from === "b"), [pay({ id: "d1", kind: "dues", fromId: "b", toId: "a", amountPaise: 50000 })], "dues");
  assert.equal(b!.remainingPaise, 450000);
  // A dues payment must not reduce general balances.
  const gen = buildBalances(expenseObligations([shared]), [pay({ id: "d1", kind: "dues", fromId: "b", toId: "a", amountPaise: 50 })], "general");
  assert.equal(gen[0]!.remainingPaise, 50);
});

test("formatting", () => {
  assert.equal(formatPaise(120000), "₹1,200");
  assert.equal(formatPaise(12050), "₹120.50");
});
