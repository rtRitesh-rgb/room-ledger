import { test } from "node:test";
import assert from "node:assert/strict";
import { planFix } from "./fix-fixed-charges-lib.mjs";

test("patch makes every month per person: rent 16000 / water 200 / cleaning 400 in total", () => {
  const roommates = ["a", "b", "c", "d"].map((id, order) => ({ id, order }));
  const stale = { id: "rent_2000-01", key: "rent", name: "Rent", amountPaise: 400000, frequency: "monthly", active: true, effectiveMonth: "2000-01", allocation: "equal", customShares: {}, note: "", createdAtMs: 0 };
  const plan = planFix({
    roommates, versions: [stale],
    months: [{ month: "2026-09" }, { month: "2026-10" }],
    fixedWallet: [{ id: "fixed_2026-09_rent_a", month: "2026-09" }],
    duesPayments: [{ id: "legacy-mp-1", month: "2026-09", fromId: "b", amountPaise: 103750 }],
  });
  for (const s of plan.summary) {
    assert.equal(s.perPerson, 415000);
    assert.deepEqual(s.totals, { Rent: 1600000, Water: 20000, Cleaning: 40000 });
  }
  assert.ok(plan.deletes.some(([, id]) => id === "fixed_2026-09_rent_a"));
  assert.deepEqual(plan.sets.find(([c, id]) => c === "payments" && id === "legacy-mp-1")[2], { amountPaise: 415000 });
  assert.equal(plan.sets.find(([c, id]) => c === "fixedCharges" && id === "water_2000-01")[2].amountPaise, 5000);
});
