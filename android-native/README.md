# Android side (personal APK, no Play Store, all free)

Everything here is free: FCM has no limits and works on Firebase's free Spark plan.

## 1. Firebase
Firebase console → your project → **Add app → Android**. Use your app's package name (see `applicationId` in
`app/build.gradle`). Download **google-services.json** and put it in `app/`.

## 2. Gradle
Project-level `build.gradle` (or `build.gradle.kts`) plugins block:
    id 'com.google.gms.google-services' version '4.4.2' apply false
`app/build.gradle` plugins block:
    id 'com.google.gms.google-services'
`app/build.gradle` dependencies:
    implementation platform('com.google.firebase:firebase-bom:33.1.0')
    implementation 'com.google.firebase:firebase-messaging'
    implementation 'androidx.core:core-ktx:1.13.1'

## 3. Copy the 3 Kotlin files
Copy `PushService.kt`, `NotificationHelper.kt`, `AndroidBridge.kt` into `app/src/main/java/<your/package>/`
and change the `package` line at the top of each to your package name.

## 4. AndroidManifest.xml
Above `<application>`:
    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
Inside `<application>`:
    <service android:name=".PushService" android:exported="false">
      <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT"/></intent-filter>
    </service>
Also set `android:launchMode="singleTop"` on your MainActivity.

## 5. MainActivity (adapt to your code; BASE_URL = your deployed site, e.g. "https://your-app.vercel.app")
In onCreate, BEFORE `webView.loadUrl(...)`:
    webView.settings.javaScriptEnabled = true
    webView.settings.domStorageEnabled = true
    webView.addJavascriptInterface(AndroidBridge(this), "AndroidBridge")
    AndroidBridge.refreshToken(this)
Open the page from a notification tap (in onCreate after loadUrl, and also in onNewIntent):
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("link")?.let { webView.loadUrl(BASE_URL + it) }
    }
The app must load your deployed https site (not localhost), because the web app calls /api/push on its own origin.

## 6. Server (Vercel, free Hobby plan)
Set `FIREBASE_SERVICE_ACCOUNT` (service-account JSON, see PUSH_SETUP.md step 2) and redeploy.
`VITE_FIREBASE_VAPID_KEY` is NOT needed for the Android app.
Publish `firestore.rules` as described in PUSH_SETUP.md step 1.

## 7. Test
Rebuild the APK, install it, open the app, tap **Turn on** on the banner, allow notifications,
close the app completely, then ask another roommate to nudge you (or use bell → Send test while the app is open).
