import type { FixedCharge } from "./ledger.ts";
import type { Paise } from "./money.ts";

/** Number of roommates sharing the room. */
export const ROOMMATE_COUNT = 4;

/**
 * The fixed monthly charges, defined in code so the database can never change them.
 * Totals are for the whole room; each roommate pays total ÷ 4.
 *   Room rent  ₹16,000 → ₹4,000 each
 *   Cleaning   ₹400    → ₹100 each
 *   Water bill ₹200    → ₹50 each
 */
export const FIXED_CHARGES: readonly { key: string; name: string; totalPaise: Paise }[] = [
  { key: "rent", name: "Rent", totalPaise: 16000 * 100 },
  { key: "cleaning", name: "Cleaning", totalPaise: 400 * 100 },
  { key: "water", name: "Water", totalPaise: 200 * 100 },
];

export const eachPaise = (totalPaise: Paise): Paise => totalPaise / ROOMMATE_COUNT;
export const FIXED_TOTAL_PAISE: Paise = FIXED_CHARGES.reduce((s, c) => s + c.totalPaise, 0); // ₹16,600
export const FIXED_EACH_PAISE: Paise = eachPaise(FIXED_TOTAL_PAISE); // ₹4,150

/** The charges in the shape the ledger expects (per-person amounts, effective from the beginning). */
export function fixedChargeVersions(): FixedCharge[] {
  return FIXED_CHARGES.map((c) => ({
    id: `${c.key}_2000-01`, key: c.key, name: c.name, amountPaise: eachPaise(c.totalPaise), frequency: "monthly" as const,
    active: true, effectiveMonth: "2000-01", allocation: "each" as const, customShares: {}, note: "Per person", createdAtMs: 0,
  }));
}
export const FIXED_VERSIONS: readonly FixedCharge[] = fixedChargeVersions();
