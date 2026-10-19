// force-fixed-charges.mjs — ONE-FILE hard reset of Rent / Water / Cleaning in Firestore.
//   node force-fixed-charges.mjs --dry                 preview (changes nothing)
//   node force-fixed-charges.mjs                       apply for the current month
//   node force-fixed-charges.mjs --month=2026-11       choose which month gets "paid by everyone"
//   node force-fixed-charges.mjs --manager=Vishal      who collects, if the month has no manager yet
//   node force-fixed-charges.mjs --no-paid             fix amounts only, don't mark anyone as paid
// Needs serviceAccount.json next to this file. Safe to run again.
//
// PER PERSON: Rent ₹4,000 · Water ₹50 · Cleaning ₹100  →  totals for 4 people: ₹16,000 · ₹200 · ₹400
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const PER_PERSON = [
  { key: "rent", name: "Rent", amountPaise: 400000 },
  { key: "water", name: "Water", amountPaise: 5000 },
  { key: "cleaning", name: "Cleaning", amountPaise: 10000 },
];
const OURS = /rent|water|clean/i;

const applies = (c, m) => c.active && c.effectiveMonth <= m && (c.frequency === "one_time" ? c.effectiveMonth === m : c.frequency === "yearly" ? c.effectiveMonth.slice(5) === m.slice(5) : true);

function snapshotFor(versions, month, ids) {
  const latest = new Map();
  for (const v of versions.filter((v) => v.effectiveMonth <= month).sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth) || (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0))) latest.set(v.key, v);
  return [...latest.values()].filter((c) => applies(c, month)).map((c) => {
    const shares = {};
    if (c.allocation === "custom" && Object.keys(c.customShares ?? {}).length) { for (const id of ids) if (c.customShares[id] > 0) shares[id] = c.customShares[id]; }
    else for (const id of ids) shares[id] = c.amountPaise;
    return { key: c.key, name: c.name, amountPaise: c.amountPaise, shares };
  });
}

export function planForce({ roommates, versions, months, fixedWallet, duesPayments, targetMonth, managerName, markPaid = true, today }) {
  const sorted = [...roommates].sort((a, b) => a.order - b.order);
  const ids = sorted.map((r) => r.id);
  const sets = [], deletes = [], warnings = [];

  // 1. Charge settings: remove every rent/water/cleaning-like setting, then write the correct baseline.
  const baseline = PER_PERSON.map((c) => ({ id: `${c.key}_2000-01`, ...c, frequency: "monthly", active: true, effectiveMonth: "2000-01", allocation: "each", customShares: {}, note: "Per person", createdAtMs: 0 }));
  const baseIds = new Set(baseline.map((b) => b.id));
  const doomed = versions.filter((v) => !baseIds.has(v.id) && (OURS.test(v.key ?? "") || OURS.test(v.name ?? "")));
  for (const v of doomed) { deletes.push(["fixedCharges", v.id]); warnings.push(`Removing "${v.name}" (${v.id}): ₹${v.amountPaise / 100} per person from ${v.effectiveMonth}`); }
  for (const { id, ...d } of baseline) sets.push(["fixedCharges", id, d]);
  const kept = versions.filter((v) => !baseIds.has(v.id) && !doomed.includes(v));
  const merged = [...kept, ...baseline];

  // 2. Every month: rebuild snapshot; wipe + rewrite fixed vault entries.
  const monthIds = [...new Set([...months.map((m) => m.id), targetMonth])].sort();
  const mgrOf = Object.fromEntries(months.map((m) => [m.id, m.managerId ?? null]));
  let manager = null;
  const named = sorted.find((r) => r.name.toLowerCase() === (managerName ?? "").toLowerCase());
  for (const w of fixedWallet) deletes.push(["walletEntries", w.id]);
  const expected = {}; // `${month}|${rid}` → paise
  const snaps = {};
  for (const month of monthIds) {
    const snap = snapshotFor(merged, month, ids);
    snaps[month] = snap;
    const doc = { month, fixed: snap };
    if (month === targetMonth && !mgrOf[month]) {
      manager = named ?? sorted.find((r) => r.role === "admin") ?? sorted[0];
      doc.managerId = manager.id;
      warnings.push(`${month} had no manager — set to ${manager.name}.`);
      mgrOf[month] = manager.id;
    }
    sets.push(["months", month, doc, { merge: true }]);
    for (const it of snap) for (const [rid, amt] of Object.entries(it.shares)) if (amt > 0) {
      sets.push(["walletEntries", `fixed_${month}_${it.key}_${rid}`, { month, roommateId: rid, type: "fixed", refId: `fixed_${month}_${it.key}`, label: it.name, amountPaise: amt, date: `${month}-01` }]);
      expected[`${month}|${rid}`] = (expected[`${month}|${rid}`] ?? 0) + amt;
    }
  }

  // 3. Old imported "fixed" payments follow the corrected amount.
  for (const p of duesPayments.filter((p) => p.id.startsWith("legacy-mp-") && String(p.note ?? "").includes("(fixed)"))) {
    const due = (snaps[p.month] ?? []).reduce((s, it) => s + (it.shares[p.fromId] ?? 0), 0);
    if (due > 0 && due !== p.amountPaise) sets.push(["payments", p.id, { amountPaise: due }, { merge: true }]);
  }

  // 4. This month's fixed charges: marked paid by everyone except the manager.
  const paid = [];
  if (markPaid) {
    const mgr = mgrOf[targetMonth];
    if (!mgr) warnings.push(`No manager for ${targetMonth}, so nobody can be marked paid. Pass --manager=<name>.`);
    else for (const r of sorted) {
      if (r.id === mgr) continue;
      const due = (snaps[targetMonth] ?? []).reduce((s, it) => s + (it.shares[r.id] ?? 0), 0);
      if (due <= 0) continue;
      if (duesPayments.some((p) => p.month === targetMonth && p.fromId === r.id && p.id.startsWith("legacy-mp-") && String(p.note ?? "").includes("(fixed)") && !p.reversedById)) { warnings.push(`${r.name}: already marked paid from the old app — left as is.`); continue; }
      sets.push(["payments", `fixedpaid_${targetMonth}_${r.id}`, { month: targetMonth, fromId: r.id, toId: mgr, amountPaise: due, kind: "dues", type: "payment", date: today, method: "Marked paid", reference: "", note: "Fixed charges marked paid (bulk)", verified: false, reversesId: null, reversedById: null, createdBy: mgr, createdAtMs: Date.now() }]);
      paid.push({ name: r.name, due });
    }
  }
  const summary = monthIds.map((month) => ({ month, each: snaps[month].reduce((s, it) => s + (it.shares[ids[0]] ?? 0), 0), totals: Object.fromEntries(snaps[month].map((it) => [it.name, Object.values(it.shares).reduce((a, b) => a + b, 0)])) }));
  return { sets, deletes, warnings, summary, expected, paid, manager };
}

async function main() {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
  const dry = process.argv.includes("--dry");
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "./serviceAccount.json";
  if (!existsSync(keyFile)) { console.error(`Can't find ${keyFile}. Put serviceAccount.json next to this file.`); process.exit(1); }
  const { cert, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: cert(keyFile) });
  const db = getFirestore();
  const all = async (q) => (await q.get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const now = new Date();
  const targetMonth = arg("month") ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [roommates, versions, months, fixedWallet, duesPayments] = await Promise.all([
    all(db.collection("roommates")), all(db.collection("fixedCharges")), all(db.collection("months")),
    all(db.collection("walletEntries").where("type", "==", "fixed")), all(db.collection("payments").where("kind", "==", "dues")),
  ]);
  console.log(`Found: ${roommates.length} roommates · ${versions.length} charge settings · ${months.length} months · ${fixedWallet.length} fixed vault entries`);
  if (!roommates.length) { console.error("No roommates — wrong Firebase project?"); process.exit(1); }

  const plan = planForce({ roommates, versions, months, fixedWallet, duesPayments, targetMonth, managerName: arg("manager"), markPaid: !process.argv.includes("--no-paid"), today: now.toISOString().slice(0, 10) });
  plan.warnings.forEach((w) => console.warn("⚠", w));
  for (const s of plan.summary) console.log(`${s.month}: each person pays ₹${s.each / 100} | totals`, Object.fromEntries(Object.entries(s.totals).map(([k, v]) => [k, `₹${v / 100}`])));
  if (plan.paid.length) console.log(`Marked paid for ${targetMonth}:`, plan.paid.map((p) => `${p.name} ₹${p.due / 100}`).join(", "));
  console.log(`Will write ${plan.sets.length} documents and delete ${plan.deletes.length}.`);
  if (dry) return console.log("--dry: nothing changed.");

  const ops = [...plan.deletes.map(([c, id]) => ({ del: db.collection(c).doc(id) })), ...plan.sets.map(([c, id, data, opts]) => ({ ref: db.collection(c).doc(id), data, opts }))];
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const o of ops.slice(i, i + 400)) o.del ? batch.delete(o.del) : batch.set(o.ref, o.data, o.opts ?? {});
    await batch.commit();
  }

  // Read it back and check.
  const after = await all(db.collection("walletEntries").where("type", "==", "fixed"));
  const got = {};
  for (const w of after) got[`${w.month}|${w.roommateId}`] = (got[`${w.month}|${w.roommateId}`] ?? 0) + w.amountPaise;
  let bad = 0;
  for (const [k, want] of Object.entries(plan.expected)) {
    const [m, rid] = k.split("|");
    const ok = got[k] === want; if (!ok) bad++;
    console.log(`${ok ? "✔" : "✗"} ${m} ${roommates.find((r) => r.id === rid)?.name}: vault fixed = ₹${(got[k] ?? 0) / 100} (expected ₹${want / 100})`);
  }
  console.log(bad ? `✗ ${bad} mismatches — send me this output.` : "✔ Verified. Reload the app.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
