// Pure conversion of the old Supabase rows into Firestore documents. Reuses the app's own ledger code
// so imported data obeys exactly the same rules as new data. Requires Node >= 22.18 (runs .ts directly).
import { DEFAULT_CATEGORIES, LEGACY_CATEGORY_IDS } from "../src/lib/categories.ts";
import { splitByWeights, splitEqual } from "../src/lib/money.ts";
import {
  buildFixedSnapshot, resolveFixedCharges, walletEntriesForExpense, walletEntriesForFixed,
} from "../src/lib/ledger.ts";

const paise = (n) => Math.round(Number(n) * 100);
const ms = (t) => (t ? Date.parse(t) : Date.now());

export function transform(old, opts = {}) {
  const warnings = [];
  const admins = (opts.admins ?? []).map((a) => a.toLowerCase());
  const roommates = [...old.roommates].sort((a, b) => ms(a.created_at) - ms(b.created_at)).map((r, i) => ({
    id: r.id, name: r.name, upiId: r.upi_id ?? "", order: i, authUid: null,
    role: (admins.length ? admins.includes(r.name.toLowerCase()) : i === 0) ? "admin" : "member",
  }));
  const ids = roommates.map((r) => r.id);
  const catById = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));

  const fixedVersions = [
    { key: "rent", name: "Rent", amountPaise: 400000 }, { key: "water", name: "Water", amountPaise: 5000 }, { key: "cleaning", name: "Cleaning", amountPaise: 10000 },
  ].map((c) => ({ id: `${c.key}_2000-01`, ...c, frequency: "monthly", active: true, effectiveMonth: "2000-01", allocation: "each", customShares: {}, note: "Per person", createdAtMs: 0 }));
  const rates = [
    { id: "electricity_default", kind: "electricity", ratePaise: 900, effectiveMonth: "2000-01", note: "Default ₹9/unit", createdAtMs: 0 },
    { id: "gas_default", kind: "gas", ratePaise: 5000, effectiveMonth: "2000-01", note: "Default ₹50/unit", createdAtMs: 0 },
  ];

  const billByExpense = new Map(old.bills.filter((b) => b.expense_id).map((b) => [b.expense_id, b]));
  const expenses = [];
  const mkExpense = (base, sharesRows, kind) => {
    let amountPaise = paise(base.amount);
    let shares = {};
    if (base.isPersonal) shares = { [base.payerId]: amountPaise };
    else if (sharesRows.length === 0) { shares = splitEqual(amountPaise, ids); warnings.push(`No shares for "${base.name}" — split equally.`); }
    else {
      for (const s of sharesRows) shares[s.roommate_id] = (shares[s.roommate_id] ?? 0) + paise(s.amount);
      const sum = Object.values(shares).reduce((a, b) => a + b, 0);
      if (sum !== amountPaise) {
        const keys = Object.keys(shares);
        if (Math.abs(sum - amountPaise) <= keys.length) shares[keys[0]] += amountPaise - sum; // pure rounding drift
        else { shares = splitByWeights(amountPaise, keys.map((id) => ({ id, weight: shares[id] }))); warnings.push(`Shares of "${base.name}" didn't match its total; redistributed proportionally.`); }
      }
    }
    const catId = LEGACY_CATEGORY_IDS[base.category] ?? base.categoryId ?? "other";
    const e = {
      id: base.id, name: base.name, amountPaise, categoryId: catId, categoryLabel: catById.get(catId)?.label ?? base.category,
      payerId: base.payerId, splitMode: base.splitMode, isPersonal: !!base.isPersonal, kind, spentOn: base.spentOn, month: base.month,
      receiptUrl: base.receiptUrl ?? null, note: "", shares, version: 1, createdBy: base.payerId, createdAtMs: ms(base.created_at), updatedAtMs: ms(base.created_at),
    };
    expenses.push(e);
    return e;
  };

  for (const e of old.expenses)
    mkExpense({ id: e.id, name: e.name, amount: e.amount, category: e.category, payerId: e.payer_id, splitMode: e.split_mode, isPersonal: e.is_personal, spentOn: e.spent_on, month: e.month, receiptUrl: e.receipt_url, created_at: e.created_at },
      old.shares.filter((s) => s.expense_id === e.id), billByExpense.has(e.id) ? "utility" : "expense");

  const bills = old.bills.map((b) => {
    let expenseId = b.expense_id;
    if (!expenseId) {
      expenseId = `legacy-bill-${b.id}`;
      mkExpense({ id: expenseId, name: b.kind === "electricity" ? "Electricity meter" : "Gas meter", amount: b.amount, category: b.kind === "electricity" ? "Electricity" : "Gas", payerId: b.payer_id, splitMode: "equal", isPersonal: false, spentOn: b.reading_date, month: b.month, created_at: b.created_at },
        old.shares.filter((s) => s.bill_id === b.id), "utility");
    }
    return { id: b.id, kind: b.kind, startMilli: Math.round(Number(b.start_reading) * 1000), endMilli: Math.round(Number(b.end_reading) * 1000), unitsMilli: Math.round(Number(b.units) * 1000), ratePaise: paise(b.rate), amountPaise: paise(b.amount), readingDate: b.reading_date, payerId: b.payer_id, month: b.month, expenseId, createdAtMs: ms(b.created_at) };
  });

  const managerOf = new Map(old.managers.map((m) => [m.month, m.roommate_id]));
  const monthSet = new Set([...old.expenses.map((e) => e.month), ...old.bills.map((b) => b.month), ...old.settlements.map((s) => s.month), ...old.managerPayments.map((p) => p.month), ...old.managers.map((m) => m.month)]);
  const months = [...monthSet].sort().map((month) => ({ month, managerId: managerOf.get(month) ?? null, fixed: buildFixedSnapshot(resolveFixedCharges(fixedVersions, month), ids) }));

  const wallet = [...expenses.flatMap((e) => walletEntriesForExpense(e)), ...months.flatMap((m) => walletEntriesForFixed(m.month, m.fixed))];

  const payments = old.settlements.filter((s) => Number(s.amount) > 0).map((s) => ({
    id: `legacy-sp-${s.id}`, month: s.month, fromId: s.from_id, toId: s.to_id, amountPaise: paise(s.amount), kind: "general", type: "payment",
    date: (s.created_at ?? "").slice(0, 10), method: "Imported", reference: "", note: "Imported from the old app", verified: false, reversesId: null, reversedById: null, createdBy: s.from_id, createdAtMs: ms(s.created_at),
  }));
  for (const p of old.managerPayments) {
    const to = managerOf.get(p.month);
    if (!to || to === p.roommate_id || Number(p.amount) <= 0) { if (to !== p.roommate_id) warnings.push(`Skipped manager payment ${p.id}: month ${p.month} has no manager.`); continue; }
    const m = months.find((x) => x.month === p.month);
    const fixedDue = m.fixed.reduce((s, it) => s + (it.shares[p.roommate_id] ?? 0), 0);
    const utilDue = expenses.filter((e) => e.kind === "utility" && e.month === p.month).reduce((s, e) => s + (e.shares[p.roommate_id] ?? 0), 0);
    let amountPaise = paise(p.amount);
    const exact = p.kind === "fixed" ? fixedDue : utilDue;
    if (Math.abs(exact - amountPaise) <= 5) amountPaise = exact; // old toggle meant "paid in full"; avoid a stray paisa
    payments.push({ id: `legacy-mp-${p.id}`, month: p.month, fromId: p.roommate_id, toId: to, amountPaise, kind: "dues", type: "payment", date: (p.created_at ?? "").slice(0, 10), method: "Imported", reference: "", note: `Imported (${p.kind})`, verified: false, reversesId: null, reversedById: null, createdBy: p.roommate_id, createdAtMs: ms(p.created_at) });
  }

  const allocations = [];
  if (opts.defaultAllocationRupees && months[0])
    for (const r of roommates) allocations.push({ id: `${months[0].month}_${r.id}`, month: months[0].month, roommateId: r.id, amountPaise: Math.round(opts.defaultAllocationRupees * 100) });

  return { roommates, fixedVersions, rates, categories: DEFAULT_CATEGORIES, expenses, bills, months, wallet, payments, allocations, settings: { carryForward: false }, warnings };
}
