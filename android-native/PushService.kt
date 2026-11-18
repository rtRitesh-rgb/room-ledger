package com.example.roomledger // TODO: change to YOUR app's package name

import android.content.Context
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Receives FCM pushes (also when the app is closed) and shows a real Android notification. */
class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        getSharedPreferences("push", Context.MODE_PRIVATE).edit().putString("token", token).apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        NotificationHelper.show(
            this,
            d["title"] ?: "Room Ledger",
            d["body"] ?: "",
            d["link"] ?: "/",
            d["tag"] ?: System.currentTimeMillis().toString(),
        )
    }
}
