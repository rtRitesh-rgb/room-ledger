// One-time patch: make Rent / Water / Cleaning PER PERSON (₹4,000 / ₹50 / ₹100 each) in Firestore,
// rebuild every month's fixed-charge snapshot and the matching vault entries, and fix imported rent payments.
//
//   $env:GOOGLE_APPLICATION_CREDENTIALS="./serviceAccount.json"
//   $env:DRY_RUN="1"; node scripts/fix-fixed-charges.mjs      # preview
//   Remove-Item Env:DRY_RUN;   node scripts/fix-fixed-charges.mjs  # apply (safe to run again)
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { planFix } from "./fix-fixed-charges-lib.mjs";

const env = process.env;
initializeApp({ credential: env.GOOGLE_APPLICATION_CREDENTIALS ? cert(env.GOOGLE_APPLICATION_CREDENTIALS) : applicationDefault() });
const db = getFirestore();
const all = async (col, q) => (await (q ?? db.collection(col)).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

const [roommates, versions, monthDocs, fixedWallet, dues] = await Promise.all([
  all("roommates"), all("fixedCharges"), all("months"),
  all("walletEntries", db.collection("walletEntries").where("type", "==", "fixed")),
  all("payments", db.collection("payments").where("kind", "==", "dues")),
]);
console.log(`Found: ${roommates.length} roommates · ${monthDocs.length} months · ${fixedWallet.length} fixed vault entries · ${dues.length} dues payments`);
if (roommates.length === 0) { console.error("No roommates found — wrong Firebase project?"); process.exit(1); }

const plan = planFix({
  roommates, versions, months: monthDocs.map((m) => ({ month: m.id })), fixedWallet,
  duesPayments: dues.filter((p) => p.id.startsWith("legacy-mp-") && String(p.note ?? "").includes("(fixed)")).map((p) => ({ id: p.id, month: p.month, fromId: p.fromId, amountPaise: p.amountPaise })),
});
plan.warnings.forEach((w) => console.warn("⚠", w));
for (const s of plan.summary) console.log(`${s.month}: each person pays ₹${s.perPerson / 100} · totals`, Object.fromEntries(Object.entries(s.totals).map(([k, v]) => [k, `₹${v / 100}`])));
console.log(`Will write ${plan.sets.length} documents and delete ${plan.deletes.length}.`);
if (env.DRY_RUN) { console.log("DRY_RUN — nothing changed."); process.exit(0); }

const ops = [...plan.deletes.map(([c, id]) => ({ del: db.collection(c).doc(id) })), ...plan.sets.map(([c, id, data, opts]) => ({ ref: db.collection(c).doc(id), data, opts }))];
for (let i = 0; i < ops.length; i += 400) {
  const batch = db.batch();
  for (const o of ops.slice(i, i + 400)) o.del ? batch.delete(o.del) : batch.set(o.ref, o.data, o.opts ?? {});
  await batch.commit();
}
console.log("Done. Reload the app.");
