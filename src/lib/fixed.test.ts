import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXED_CHARGES, FIXED_EACH_PAISE, FIXED_TOTAL_PAISE, FIXED_VERSIONS, ROOMMATE_COUNT, eachPaise } from "./fixed.ts";
import { buildBalances, buildFixedSnapshot, duesObligations, resolveFixedCharges } from "./ledger.ts";

const rupees = (p: number) => p / 100;

test("room totals 16,000 / 400 / 200; each of four pays 4,000 / 100 / 50", () => {
  assert.equal(ROOMMATE_COUNT, 4);
  assert.deepEqual(FIXED_CHARGES.map((c) => rupees(c.totalPaise)), [16000, 400, 200]);
  assert.deepEqual(FIXED_CHARGES.map((c) => rupees(eachPaise(c.totalPaise))), [4000, 100, 50]);
  assert.equal(rupees(FIXED_EACH_PAISE), 4150);
  assert.equal(rupees(FIXED_TOTAL_PAISE), 16600);
});

test("every month's snapshot charges each roommate rent 4000 + cleaning 100 + water 50", () => {
  const ids = ["a", "b", "c", "d"];
  for (const month of ["2026-10", "2027-03", "2031-12"]) {
    const items = buildFixedSnapshot(resolveFixedCharges([...FIXED_VERSIONS], month), ids);
    assert.deepEqual(items.map((i) => i.key), ["rent", "cleaning", "water"]);
    for (const id of ids) assert.equal(rupees(items.reduce((s, it) => s + (it.shares[id] ?? 0), 0)), 4150);
    assert.equal(rupees(items.reduce((s, it) => s + Object.values(it.shares).reduce((a, b) => a + b, 0), 0)), 16600);
  }
});

test("the three non-managers each owe the manager ₹4,150", () => {
  const ids = ["a", "b", "c", "d"];
  const items = buildFixedSnapshot(resolveFixedCharges([...FIXED_VERSIONS], "2026-10"), ids);
  const bal = buildBalances(duesObligations([], items, "a"), [], "dues");
  assert.equal(bal.length, 3);
  for (const b of bal) { assert.equal(b.toId, "a"); assert.equal(rupees(b.remainingPaise), 4150); }
});
