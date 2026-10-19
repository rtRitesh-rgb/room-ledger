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

## 3. Bring your old data across (needs Node ≥ 22.18)
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

## 4. Run
```
cp .env.example .env   # fill in
npm install
npm test               # accounting unit tests
npm run dev            # or: npm run build
```

## Known limits (please read)
- **No server code.** Firestore rules verify who you are and the shape of data, but cannot recompute totals. Balances are derived from ledger entries written atomically with each expense/payment, so honest use is always consistent; a roommate using browser dev-tools could still write bad data. Closing that gap needs Cloud Functions (Firebase Blaze plan). Don't describe this as production-grade security.
- Personal expenses are hidden in the UI from other roommates but are readable by any household member's account.
- Payment over-limit checks happen in the app, not in the database. Double-submits are prevented (idempotent ids).
- Receipt links are public-but-unguessable URLs; images can't be deleted from the app (orphans remain if an expense is deleted).
- "Verified" payments aren't wired to any bank/UPI API, so every payment shows as *recorded, not verified*.
- Fixed charges are included in each person's Personal Vault spend, matching the old "utilized" total; set allocations accordingly.
- Not tested against live Firebase/Supabase in the build environment. Please walk through the checklist in README.md after setup.
