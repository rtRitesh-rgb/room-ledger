# Android notifications

The Android app in this project is the Capacitor project in `android/`. Its package name is
`com.roomledger.app`. The Kotlin files in this folder are examples for a plain WebView wrapper;
do not copy them into the Capacitor app.

## Permission prompt and notifications

Capacitor Local Notifications and Push Notifications are registered as project dependencies.
`capacitor.config.ts` points the APK at the deployed Room Ledger site. Deploy web changes to that
site before testing the APK; otherwise it will keep loading the older deployed JavaScript. The
app requests Android notification permission after the user taps **Allow** or **Turn on** in the app.

If Android notifications were previously denied, enable them manually:
**Android Settings → Apps → Room Ledger → Notifications**.

## Firebase setup for pushes while the app is closed

1. In Firebase Console, add an Android app with package name `com.roomledger.app`.
2. Download its `google-services.json` and place it at
   `android/app/google-services.json`.
3. Configure `FIREBASE_SERVICE_ACCOUNT` on the server hosting `/api/push`, then redeploy.
   Keep the service-account JSON on the server only; never put it in the APK or commit it.
4. Build and install a new APK. Open Room Ledger, sign in, and allow notifications. The app
   registers its FCM token in Firestore; send a test notification from another roommate.

The web-push VAPID key is not used by the native Android APK.

## Build

From the project root, after deploying the web app:

```powershell
npm install
npm run build
npx cap sync android
```

Open the `android/` folder in Android Studio and build/install the app. Alternatively, with
Android Studio's bundled Java runtime available:

```powershell
cd android
.\gradlew.bat app:assembleDebug
```
