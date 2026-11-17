import type { Paise } from "./money.ts";

/**
 * Tiny, safe calculator for amount fields: "12+13.5+16" → 4150 paise.
 * Supports + − x * / ( ) and decimals. Never uses eval.
 * Money stays integer: each typed number is converted to paise first (max 2 decimals),
 * multiplication/division happen on the paise value and the result is rounded once.
 */

const norm = (s: string) =>
  s.replace(/[×xX]/g, "*").replace(/[÷]/g, "/").replace(/[−–—]/g, "-").replace(/,/g, "").replace(/₹/g, "").replace(/\s+/g, "");

/** True when the text contains an operator (so we should show a live total). */
export const isExpression = (text: string) => /[+\-*/×÷xX−()]/.test(text.trim().replace(/^-/, ""));

/** Evaluates to a plain number in rupees (floating) or null if invalid. */
function evaluate(text: string): number | null {
  const s = norm(text);
  if (!s || !/^[0-9+\-*/().]+$/.test(s)) return null;
  let i = 0;

  const peek = () => s[i];
  const number = (): number | null => {
    const m = /^\d*\.?\d*/.exec(s.slice(i));
    const t = m?.[0] ?? "";
    if (t === "" || t === ".") return null;
    if ((t.split(".")[1] ?? "").length > 2) return null; // paise precision only
    i += t.length;
    return Number(t);
  };
  const factor = (): number | null => {
    if (peek() === "+") { i++; return factor(); }
    if (peek() === "-") { i++; const v = factor(); return v === null ? null : -v; }
    if (peek() === "(") {
      i++;
      const v = expr();
      if (v === null || peek() !== ")") return null;
      i++;
      return v;
    }
    return number();
  };
  const term = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === "*" || peek() === "/")) {
      const op = s[i++];
      const r = factor();
      if (r === null) return null;
      if (op === "/" && r === 0) return null;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number | null => {
    let v = term();
    while (v !== null && (peek() === "+" || peek() === "-")) {
      const op = s[i++];
      const r = term();
      if (r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };

  const v = expr();
  if (v === null || i !== s.length || !Number.isFinite(v)) return null;
  return v;
}

/** "12+13.5+16" → paise (integer) or null when invalid / negative / zero-length. */
export function evalAmount(text: string): Paise | null {
  const v = evaluate(text);
  if (v === null) return null;
  const p = Math.round(v * 100 + 1e-9);
  return p >= 0 ? p : null;
}

/** Same, but as a rupee string suitable for the existing strict `parseRupees` ("41.50"). */
export function evalToRupeesString(text: string): string | null {
  const p = evalAmount(text);
  return p === null ? null : (p / 100).toFixed(2);
}

/** Convert whatever the person typed (plain number or expression) into a plain rupee string, else keep the text. */
export const resolveAmountText = (text: string): string => (text.trim() === "" ? "" : evalToRupeesString(text) ?? text);
