<<<<<<< HEAD
# Room Ledger 2.0
React + TypeScript + TanStack Start + Tailwind, **Firebase** (Firestore/Auth), receipts in **Supabase Storage**. See `SETUP.md`.

## Fixed charges
Rent ₹16,000 / Cleaning ₹400 / Water ₹200 per month for the room → **₹4,000 / ₹100 / ₹50 each** (₹4,150 per person). They are defined in `src/lib/fixed.ts`, not in the database: on every load the app checks the month's saved charges against them and repairs any mismatch automatically.

## Setup
Fill in `.env` (template included; see `SETUP.md`), then `npm install && npm run dev`.

## Design
- Money is integer paise everywhere (`src/lib/money.ts`). Equal splits give leftover paise to the first roommates in display order; totals always reconcile.
- **Personal Vault** = allocation − Σ `walletEntries`. Entries have deterministic ids (`<expenseId>_<roommateId>`) and are written in the same Firestore transaction as the expense, so edits replace (never stack) and deletes remove them. Payments never touch the vault.
- **Settlement** (`src/lib/ledger.ts`): shared-expense debts are netted per pair; rent/fixed/meter dues are a separate bucket owed to the manager. Payments are append-only; corrections are linked reversals.
- Rates and fixed charges are versioned by effective month; bills store the rate used; each month snapshots its fixed charges on first open.
- Routes: `/`, `/expenses`, `/settlement`, `/household?tab=…`; `/profile`, `/records`, `/manager`, `/utilities` redirect.

## Post-setup smoke test
1. Sign in as two roommates (two browsers). 2. Add ₹1,200 shared grocery equal across 4 → each vault −₹300. 3. Edit to ₹800 → vaults update once. 4. Pay ₹500 of a ₹1,500 debt → remaining ₹1,000; reverse it → ₹1,500. 5. Change electricity rate for next month; last month's bill is unchanged. 6. Toggle dark mode; reload (no flash).

`npm test` runs 13 tests (splits, rounding, wallet, settlement, rates, fixed charges, legacy-data migration).
=======
# room-ledger
>>>>>>> d3bb04ab36a8bf1be168635b1d64cfedcb1c458c
