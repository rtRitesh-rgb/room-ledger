import { test } from "node:test";
import assert from "node:assert/strict";
import { transform } from "./transform.mjs";

const R = ["r1", "r2", "r3", "r4"].map((id, i) => ({ id, name: ["Vishal", "Ritesh", "Aquib", "Yuvraj"][i], upi_id: "", created_at: `2026-09-0${i + 1}` }));
const old = {
  roommates: R,
  expenses: [
    { id: "e1", name: "Veg", amount: "100.000", category: "Vegetable", payer_id: "r1", split_mode: "equal", is_personal: false, spent_on: "2026-09-05", month: "2026-09", receipt_url: null, created_at: "2026-09-05T10:00:00Z" },
    { id: "e2", name: "Power", amount: "1111.104", category: "Electricity", payer_id: "r2", split_mode: "equal", is_personal: false, spent_on: "2026-09-06", month: "2026-09", receipt_url: null, created_at: "2026-09-06T10:00:00Z" },
    { id: "e3", name: "Snacks", amount: "50", category: "Others", payer_id: "r3", split_mode: "personal", is_personal: true, spent_on: "2026-09-07", month: "2026-09", receipt_url: null, created_at: "2026-09-07T10:00:00Z" },
  ],
  shares: [
    ...["r1", "r2", "r3"].map((r, i) => ({ expense_id: "e1", bill_id: null, roommate_id: r, amount: "33.333" })),
    ...R.map((r) => ({ expense_id: "e2", bill_id: null, roommate_id: r.id, amount: "277.776" })),
  ],
  bills: [{ id: "b1", kind: "electricity", start_reading: "10", end_reading: "133.456", units: "123.456", rate: "9", amount: "1111.104", reading_date: "2026-09-06", payer_id: "r2", month: "2026-09", expense_id: "e2", created_at: "2026-09-06T10:00:00Z" }],
  settlements: [{ id: "s1", month: "2026-09", from_id: "r3", to_id: "r1", amount: "10", created_at: "2026-09-10T00:00:00Z" }],
  managers: [{ month: "2026-09", roommate_id: "r2" }],
  managerPayments: [{ id: "m1", month: "2026-09", roommate_id: "r3", kind: "fixed", amount: "4150", created_at: "2026-09-11T00:00:00Z" }],
};

test("legacy data converts to integer paise that reconcile, keeping history", () => {
  const out = transform(old, { admins: ["Vishal"] });
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  for (const e of out.expenses) assert.equal(sum(e.shares), e.amountPaise, e.name);
  assert.equal(out.expenses.find((e) => e.id === "e1").shares.r1, 3334); // 33.333×3 → drift fixed deterministically
  assert.equal(out.expenses.find((e) => e.id === "e2").kind, "utility");
  assert.equal(out.expenses.find((e) => e.id === "e1").categoryId, "vegetables");
  assert.equal(out.roommates.find((r) => r.name === "Vishal").role, "admin");
  assert.equal(out.bills[0].amountPaise, 111110);
  // fixed charges are per person: each roommate owes rent 4000 + water 100 + cleaning 50 = ₹4,150
  assert.equal(out.months[0].fixed.reduce((s, f) => s + f.shares.r1, 0), 415000);
  assert.equal(out.months[0].fixed.find((f) => f.key === "rent").shares.r4, 400000);
  const mp = out.payments.find((p) => p.kind === "dues");
  assert.equal(mp.amountPaise, 415000);
  assert.equal(mp.toId, "r2");
  // wallet: fixed + expense entries exist, personal expense only hits its owner
  assert.ok(out.wallet.some((w) => w.id === "e3_r3" && w.type === "personal"));
  assert.ok(!out.wallet.some((w) => w.id === "e3_r1"));
});
