package com.example.roomledger // TODO: change to YOUR app's package name

import android.Manifest
import android.app.Activity
import android.content.Context
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessaging

/** Exposed to the web app as `window.AndroidBridge` (see src/lib/push.ts). */
class AndroidBridge(private val activity: Activity) {
    private val prefs = activity.getSharedPreferences("push", Context.MODE_PRIVATE)

    @JavascriptInterface fun getFcmToken(): String = prefs.getString("token", "") ?: ""

    @JavascriptInterface fun hasPermission(): Boolean = NotificationManagerCompat.from(activity).areNotificationsEnabled()

    @JavascriptInterface fun requestPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            activity.runOnUiThread { activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001) }
        }
    }

    @JavascriptInterface fun show(title: String, body: String, link: String, tag: String) =
        NotificationHelper.show(activity, title, body, link, tag)

    companion object {
        /** Call once from MainActivity.onCreate so the token is ready before the web app asks for it. */
        fun refreshToken(ctx: Context) {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { t ->
                ctx.getSharedPreferences("push", Context.MODE_PRIVATE).edit().putString("token", t).apply()
            }
        }
    }
}
