# Room Ledger 2.0 — setup

Data + login → **Firebase** (Firestore + Auth). Receipt photos → a **new Supabase project** (storage only).

## 1. Firebase (≈10 min)

1. https://console.firebase.google.com → **Add project**.
2. **Build → Firestore Database → Create database** (production mode, pick a region near you).
3. **Build → Authentication → Get started → Email/Password → Enable.**
4. Authentication → **Users → Add user**: create one account per roommate (email + password).
   Then **Settings → User actions → untick "Enable create (sign-up)"** so strangers can't register.
5. **Project settings → Your apps → Web (</>)** → copy the config into `.env` (see `.env.example`).
6. **Publish the security rules**: Firestore → Rules → paste `firestore.rules` → Publish
   (or `npm i -g firebase-tools && firebase login && firebase deploy --only firestore:rules`).

## 2. Receipts (new Supabase project, ≈3 min)

1. Create a project at supabase.com. SQL editor → run `supabase/receipts-storage.sql`.
2. Project settings → API → copy **Project URL** and **anon public key** into `.env`
   (`VITE_RECEIPTS_SUPABASE_URL`, `VITE_RECEIPTS_SUPABASE_ANON_KEY`). Never use the service_role key in the app.

## 3. Smart Grocery Finder (optional)

1. Create a QuickCommerce API account and copy its API key from the provider dashboard.
2. Add **`QUICKCOMMERCE_API_KEY`** as a server environment variable in Vercel (do not prefix it with `VITE_`). For local development, add it to `.env`. Never put the key in client code or share it.
3. Publish the updated `firestore.rules` so household members can share grocery-list items.
4. Redeploy the app. In **Grocery**, allow location access or enter latitude/longitude; add your delivery PIN code if needed by a selected store.

The provider charges one credit per platform that answers. Comparing on all three supported apps can use up to 3 credits per search; 20–60 searches could use about 60–180 credits. Check the provider's current [API documentation](https://quickcommerceapi.com/docs) and account balance before relying on its advertised free credits. Prices and stock can change; delivery fees are not included. Purchases are added to Expenses only when a roommate records the actual amount paid.

## 4. Bring your old data across (needs Node ≥ 22.18)

Your old `.env` (from the zip you uploaded) holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Reading with that key still works.

1. Firebase console → Project settings → **Service accounts → Generate new private key**. Save as `serviceAccount.json` in the project root. **Do not commit it** (it is git-ignored below); delete it afterwards.
2. `npm install`
3. Preview: `DRY_RUN=1 OLD_SUPABASE_URL=… OLD_SUPABASE_KEY=… npm run migrate`
4. Real run:
   ```
   OLD_SUPABASE_URL=… OLD_SUPABASE_KEY=… GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json \
   ADMIN_NAMES=Vishal DEFAULT_ALLOCATION_RUPEES=5000 \
   NEW_SUPABASE_URL=… NEW_SUPABASE_ANON_KEY=… npm run migrate
   ```
   It converts every amount to integer paise, keeps roommate ids, rebuilds wallet ledgers, imports manager dues/settlements as payments, and seeds ₹9 / ₹50 rates, rent ₹4,000 / cleaning ₹100 / water ₹50 (each is per person), and all categories. Re-running is safe.
   `ADMIN_NAMES` = who may edit rates, charges, categories and vault allocations (comma-separated).
5. Each roommate opens the app, signs in, and picks their name once ("Which roommate are you?").

## 5. Run

```
cp .env.example .env   # fill in
npm install
npm test               # accounting unit tests
npm run dev            # or: npm run build
```

## Known limits (please read)

- Server routes handle push delivery and grocery search. Firestore rules verify who you are and the shape of data, but cannot recompute ledger totals. Balances are derived from ledger entries written atomically with each expense/payment, so honest use is always consistent; a roommate using browser dev-tools could still write bad data. Closing that gap needs Cloud Functions (Firebase Blaze plan). Don't describe this as production-grade security.
- Personal expenses are hidden in the UI from other roommates but are readable by any household member's account.
- Payment over-limit checks happen in the app, not in the database. Double-submits are prevented (idempotent ids).
- Receipt links are public-but-unguessable URLs; images can't be deleted from the app (orphans remain if an expense is deleted).
- "Verified" payments aren't wired to any bank/UPI API, so every payment shows as _recorded, not verified_.
- Fixed charges are included in each person's Personal Vault spend, matching the old "utilized" total; set allocations accordingly.
- Not tested against live Firebase/Supabase in the build environment. Please walk through the checklist in README.md after setup.
