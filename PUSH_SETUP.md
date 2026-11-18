# Notifications setup

## 1. Publish the Firestore rules (required for everything)
Firebase console → **Firestore Database → Rules** → paste the whole `firestore.rules` → **Publish**.
(Or: `npx firebase-tools login && npx firebase-tools deploy --only firestore:rules`.)
Without this, saving your wallet and sending nudges fail with "permission denied".

## 2. Phone push, works with the app closed (optional, ~5 min)
1. Firebase console → **Project settings → Cloud Messaging → Web Push certificates → Generate key pair**.
   Copy the key → Vercel env var **`VITE_FIREBASE_VAPID_KEY`**.
2. Firebase console → **Project settings → Service accounts → Generate new private key**.
   Paste the *entire JSON file contents* into the Vercel env var **`FIREBASE_SERVICE_ACCOUNT`** (keep it secret; never commit it).
3. Vercel → **Redeploy**.
4. On your phone open the app → tap **Turn on** on the banner → allow notifications → bell → **Send test**.

Without step 2 the app still works: notifications show in the bell and as pop-ups while the app is open.

Notes: iPhone needs the app added to the Home Screen first (Share → Add to Home Screen). The server route is `src/routes/api.push.ts`.
