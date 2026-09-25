package com.xavindo.tapgo

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createDefaultNotificationChannel()
    }

    // Android 8+ wajib punya channel; backend mengirim ke "tapgo_default".
    private fun createDefaultNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            "tapgo_default",
            "Notifikasi TapGo",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Pembaruan perjalanan, saldo, dan pembayaran"
        }
        manager.createNotificationChannel(channel)
    }
}
