import { test } from "node:test";
import assert from "node:assert/strict";
import { evalAmount, isExpression, resolveAmountText } from "./calc.ts";

test("adds partial amounts: 12+13.5+16 = 41.50", () => {
  assert.equal(evalAmount("12+13.5+16"), 4150);
  assert.equal(evalAmount("12 + 13.5 + 16"), 4150);
});
test("subtract, multiply, divide, brackets", () => {
  assert.equal(evalAmount("100-25.5"), 7450);
  assert.equal(evalAmount("12x3"), 3600);
  assert.equal(evalAmount("12*3+4"), 4000);
  assert.equal(evalAmount("100/4"), 2500);
  assert.equal(evalAmount("(10+5)*2"), 3000);
  assert.equal(evalAmount("10/3"), 333);
});
test("plain numbers still work, commas allowed", () => {
  assert.equal(evalAmount("1,200.5"), 120050);
  assert.equal(evalAmount("0.07"), 7);
});
test("invalid or unsafe input returns null", () => {
  for (const bad of ["", "12+", "+*3", "1/0", "abc", "1.234+1", "alert(1)", "2**3", "(1+2", "-5", "5-10"]) assert.equal(evalAmount(bad), null, bad);
});
test("isExpression / resolveAmountText", () => {
  assert.equal(isExpression("41.5"), false);
  assert.equal(isExpression("12+1"), true);
  assert.equal(resolveAmountText("12+13.5+16"), "41.50");
  assert.equal(resolveAmountText("garbage"), "garbage");
});
