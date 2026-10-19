// Pure planner: given what is in Firestore, work out every write needed to make fixed charges per person.
import { buildFixedSnapshot, resolveFixedCharges, walletEntriesForFixed } from "../src/lib/ledger.ts";

// Per PERSON, in paise.
export const PER_PERSON = [
  { key: "rent", name: "Rent", amountPaise: 400000 },       // ₹4,000 each
  { key: "water", name: "Water", amountPaise: 5000 },       // ₹50 each
  { key: "cleaning", name: "Cleaning", amountPaise: 10000 }, // ₹100 each
];

export function planFix({ roommates, versions, months, fixedWallet, duesPayments }) {
  const ids = [...roommates].sort((a, b) => a.order - b.order).map((r) => r.id);
  const sets = [];
  const deletes = [];
  const warnings = [];

  const baseline = PER_PERSON.map((c) => ({
    id: `${c.key}_2000-01`, ...c, frequency: "monthly", active: true, effectiveMonth: "2000-01",
    allocation: "each", customShares: {}, note: "Per person", createdAtMs: 0,
  }));
  const keys = new Set(PER_PERSON.map((c) => c.key));
  for (const v of versions)
    if (keys.has(v.key) && v.id !== `${v.key}_2000-01`) warnings.push(`Extra version "${v.id}" (${v.amountPaise / 100}) from ${v.effectiveMonth} is kept. Edit it in Household → Fixed charges if it's wrong.`);
  for (const b of baseline) { const { id, ...d } = b; sets.push(["fixedCharges", id, d]); }

  const merged = [...versions.filter((v) => !baseline.some((b) => b.id === v.id)), ...baseline];
  const perMonth = {};
  for (const m of months) {
    const snapshot = buildFixedSnapshot(resolveFixedCharges(merged, m.month), ids);
    perMonth[m.month] = snapshot;
    sets.push(["months", m.month, { fixed: snapshot }, { merge: true }]);
    for (const w of fixedWallet.filter((x) => x.month === m.month)) deletes.push(["walletEntries", w.id]);
    for (const w of walletEntriesForFixed(m.month, snapshot)) { const { id, ...d } = w; sets.push(["walletEntries", id, d]); }
  }

  for (const p of duesPayments) {
    const snap = perMonth[p.month];
    if (!snap) continue;
    const due = snap.reduce((s, it) => s + (it.shares[p.fromId] ?? 0), 0);
    if (due > 0 && due !== p.amountPaise) sets.push(["payments", p.id, { amountPaise: due }, { merge: true }]);
  }

  const summary = Object.entries(perMonth).map(([month, snap]) => ({
    month,
    perPerson: snap.reduce((s, it) => s + (it.shares[ids[0]] ?? 0), 0),
    totals: Object.fromEntries(snap.map((it) => [it.name, Object.values(it.shares).reduce((a, b) => a + b, 0)])),
  }));
  return { sets, deletes, warnings, summary };
}
