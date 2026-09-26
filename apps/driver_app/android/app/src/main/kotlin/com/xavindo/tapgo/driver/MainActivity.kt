package com.xavindo.tapgo.driver

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
            "Pesanan dan pemberitahuan",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Pesanan baru di dekat Anda, pembatalan, dan pembaruan akun"
        }
        manager.createNotificationChannel(channel)
    }
}
