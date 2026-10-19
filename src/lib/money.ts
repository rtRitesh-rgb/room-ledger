// All money is handled as integer paise (₹1 = 100 paise). Never use floats for balances.

export type Paise = number;

/** Parse a user-typed rupee string ("1,200.5") into integer paise. Returns null if invalid. */
export function parseRupees(input: string): Paise | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Parse a decimal with up to 3 places (meter readings) into integer thousandths. */
export function parseMilli(input: string): number | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  return Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
}

export const paiseToRupeesString = (p: Paise): string => (p / 100).toFixed(2);

export function formatPaise(p: Paise, opts: { sign?: boolean } = {}): string {
  const neg = p < 0;
  const abs = Math.abs(p);
  const text = (abs / 100).toLocaleString("en-IN", {
    minimumFractionDigits: abs % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${neg ? "−" : opts.sign && p > 0 ? "+" : ""}₹${text}`;
}

export const formatMilli = (m: number): string => (m / 1000).toFixed(3);

/** Electricity/gas bill: consumption (thousandths of a unit) × rate (paise per unit), rounded to the nearest paisa. */
export function billPaise(unitsMilli: number, ratePaise: number): Paise {
  return Math.round((unitsMilli * ratePaise) / 1000);
}

/**
 * Split `total` paise across weighted recipients using the largest-remainder method.
 * Deterministic: ties are broken by the order of `weights`. Result always sums to `total`.
 * Equal split = all weights 1, so the extra paise go to the first people in the given order.
 */
export function splitByWeights(
  total: Paise,
  weights: { id: string; weight: number }[],
): Record<string, Paise> {
  const out: Record<string, Paise> = {};
  const sum = weights.reduce((s, w) => s + w.weight, 0);
  if (weights.length === 0 || sum <= 0 || total < 0) return out;
  const parts = weights.map((w, index) => {
    const exact = (total * w.weight) / sum;
    const base = Math.floor(exact + 1e-9);
    return { id: w.id, index, base, frac: exact - base };
  });
  let remainder = total - parts.reduce((s, p) => s + p.base, 0);
  const byFrac = [...parts].sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const p of byFrac) {
    if (remainder <= 0) break;
    p.base += 1;
    remainder -= 1;
  }
  for (const p of parts) out[p.id] = p.base;
  return out;
}

export const splitEqual = (total: Paise, ids: string[]): Record<string, Paise> =>
  splitByWeights(
    total,
    ids.map((id) => ({ id, weight: 1 })),
  );

export type SplitMode = "equal" | "custom" | "percent" | "personal";

export type SplitInput = {
  mode: SplitMode;
  total: Paise;
  /** Roommates in display order (used for deterministic remainder allocation). */
  order: string[];
  payerId: string;
  /** equal: ids included. */
  included: string[];
  /** custom: raw text per roommate (rupees). percent: raw text per roommate (percent). */
  raw: Record<string, string>;
};

export type SplitResult = {
  shares: Record<string, Paise>;
  /** Errors keyed by roommate id, or "_form" for form-level problems. */
  errors: Record<string, string>;
  ok: boolean;
  /** custom mode: total − sum(entered). */
  difference: Paise;
};

export function computeSplit(input: SplitInput): SplitResult {
  const { mode, total, order, payerId, included, raw } = input;
  const errors: Record<string, string> = {};
  let shares: Record<string, Paise> = {};
  let difference = 0;

  if (!Number.isInteger(total) || total <= 0) {
    errors["_form"] = "Enter an amount greater than zero first.";
    return { shares, errors, ok: false, difference };
  }

  if (mode === "personal") {
    shares = { [payerId]: total };
  } else if (mode === "equal") {
    const ids = order.filter((id) => included.includes(id));
    if (ids.length === 0) errors["_form"] = "Select at least one roommate to split with.";
    else shares = splitEqual(total, ids);
  } else if (mode === "custom") {
    let sum = 0;
    for (const id of order) {
      const text = (raw[id] ?? "").trim();
      if (text === "") continue;
      if (text.startsWith("-")) {
        errors[id] = "Amount can't be negative.";
        continue;
      }
      const p = parseRupees(text);
      if (p === null) {
        errors[id] = "Enter a valid amount (up to 2 decimals).";
        continue;
      }
      if (p === 0) continue;
      shares[id] = p;
      sum += p;
    }
    difference = total - sum;
    if (Object.keys(errors).length === 0) {
      if (Object.keys(shares).length === 0) errors["_form"] = "Enter at least one share.";
      else if (difference !== 0)
        errors["_form"] =
          difference > 0
            ? `Shares are ₹${(difference / 100).toFixed(2)} short of the total.`
            : `Shares exceed the total by ₹${(-difference / 100).toFixed(2)}.`;
    }
  } else {
    // percent: parsed in hundredths of a percent (basis points)
    const weights: { id: string; weight: number }[] = [];
    let bp = 0;
    for (const id of order) {
      const text = (raw[id] ?? "").trim();
      if (text === "") continue;
      if (text.startsWith("-")) {
        errors[id] = "Percentage can't be negative.";
        continue;
      }
      if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        errors[id] = "Enter a valid percentage (up to 2 decimals).";
        continue;
      }
      const [w = "0", f = ""] = text.split(".");
      const v = Number(w) * 100 + Number(f.padEnd(2, "0"));
      if (v === 0) continue;
      weights.push({ id, weight: v });
      bp += v;
    }
    if (Object.keys(errors).length === 0) {
      if (bp !== 10000) errors["_form"] = `Percentages add up to ${(bp / 100).toFixed(2)}%, not 100%.`;
      else shares = splitByWeights(total, weights);
    }
  }

  const sum = Object.values(shares).reduce((s, v) => s + v, 0);
  if (Object.keys(errors).length === 0 && sum !== total) errors["_form"] = "Shares don't add up to the total.";
  return { shares, errors, ok: Object.keys(errors).length === 0, difference };
}
