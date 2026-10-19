// One-time import: OLD Supabase (read with the anon key already in your old .env) → Firestore.
// Safe to re-run: every document id is deterministic, so it overwrites instead of duplicating.
//
//   OLD_SUPABASE_URL=...  OLD_SUPABASE_KEY=...  GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json \
//   ADMIN_NAMES=Vishal  [DEFAULT_ALLOCATION_RUPEES=5000]  [DRY_RUN=1] \
//   [NEW_SUPABASE_URL=... NEW_SUPABASE_ANON_KEY=...  (copies receipt images to the new project)] \
//   node scripts/migrate-supabase-to-firestore.mjs
import { createClient } from "@supabase/supabase-js";
import { cert, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { transform } from "./transform.mjs";

const env = process.env;
for (const k of ["OLD_SUPABASE_URL", "OLD_SUPABASE_KEY"]) if (!env[k]) { console.error(`Missing ${k}`); process.exit(1); }
const dry = !!env.DRY_RUN;

const sb = createClient(env.OLD_SUPABASE_URL, env.OLD_SUPABASE_KEY, { auth: { persistSession: false } });
async function all(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

console.log("Reading old database…");
const old = {
  roommates: await all("roommates"), expenses: await all("expenses"), shares: await all("expense_shares"),
  bills: await all("utility_bills"), settlements: await all("settlement_payments"),
  managers: await all("monthly_managers"), managerPayments: await all("manager_payments"),
};
console.log(Object.entries(old).map(([k, v]) => `${k}: ${v.length}`).join(" · "));

const out = transform(old, {
  admins: (env.ADMIN_NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  ...(env.DEFAULT_ALLOCATION_RUPEES ? { defaultAllocationRupees: Number(env.DEFAULT_ALLOCATION_RUPEES) } : {}),
});
out.warnings.forEach((w) => console.warn("⚠", w));

// Optional: copy receipt images into the new Supabase project.
if (env.NEW_SUPABASE_URL && env.NEW_SUPABASE_ANON_KEY && !dry) {
  const dest = createClient(env.NEW_SUPABASE_URL, env.NEW_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  let copied = 0;
  for (const e of out.expenses) {
    if (!e.receiptUrl || e.receiptUrl.startsWith(env.NEW_SUPABASE_URL)) continue;
    try {
      const res = await fetch(e.receiptUrl);
      if (!res.ok) throw new Error(String(res.status));
      const type = res.headers.get("content-type") ?? "image/jpeg";
      const ext = type.split("/")[1]?.split(";")[0] ?? "jpg";
      const path = `${e.month}/${crypto.randomUUID()}.${ext}`;
      const { error } = await dest.storage.from("receipts").upload(path, await res.blob(), { contentType: type });
      if (error) throw error;
      e.receiptUrl = dest.storage.from("receipts").getPublicUrl(path).data.publicUrl;
      copied++;
    } catch (err) { console.warn(`⚠ Could not copy receipt for "${e.name}" (${err.message ?? err}); keeping old link.`); }
  }
  console.log(`Copied ${copied} receipts.`);
}

const plan = [
  ["roommates", out.roommates], ["fixedCharges", out.fixedVersions], ["rates", out.rates], ["categories", out.categories],
  ["expenses", out.expenses], ["utilityBills", out.bills], ["walletEntries", out.wallet], ["payments", out.payments],
  ["allocations", out.allocations], ["months", out.months.map((m) => ({ ...m, id: m.month }))],
  ["settings", [{ id: "household", ...out.settings }]],
];
console.log("Will write:", plan.map(([c, d]) => `${c} ${d.length}`).join(" · "));
if (dry) { console.log("DRY_RUN — nothing written."); process.exit(0); }

initializeApp({ credential: env.GOOGLE_APPLICATION_CREDENTIALS ? cert(env.GOOGLE_APPLICATION_CREDENTIALS) : applicationDefault() });
const db = getFirestore();
for (const [col, docs] of plan) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const { id, ...data } of docs.slice(i, i + 400)) batch.set(db.collection(col).doc(id), data);
    await batch.commit();
  }
  console.log(`✔ ${col}`);
}
console.log("Done. Now create the 4 Firebase Auth users (see SETUP.md).");
