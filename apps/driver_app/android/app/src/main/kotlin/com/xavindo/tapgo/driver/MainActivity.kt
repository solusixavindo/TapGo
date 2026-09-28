package com.xavindo.tapgo.driver

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    // Nama dan method HARUS sama persis dengan sisi Dart
    // (lib/features/driver/application/system_settings.dart).
    private val settingsChannel = "tapgo.driver/settings"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createDefaultNotificationChannel()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, settingsChannel).setMethodCallHandler { call, result ->
            when (call.method) {
                "openNotificationSettings" -> {
                    result.success(openNotificationSettings())
                }
                else -> result.notImplemented()
            }
        }
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

    /**
     * Membuka layar notifikasi bawaan Android untuk aplikasi ini — di situlah
     * driver mengatur suara/getar/prioritas notifikasi, karena sejak
     * Android 8 (Oreo) aplikasi tidak lagi bisa mengubah pengaturan itu
     * sendiri setelah channel dibuat. Ada fallback berjenjang (bukan hanya
     * satu Intent) supaya tombolnya tetap berfungsi di API lama maupun bila
     * pabrikan HP memodifikasi Settings; false hanya bila SEMUA cara gagal,
     * dan pemanggil di Dart memperlakukan itu sebagai kegagalan senyap.
     */
    private fun openNotificationSettings(): Boolean {
        val attempts = mutableListOf<Intent>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            attempts.add(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            )
        }
        attempts.add(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:$packageName"))
        )
        for (intent in attempts) {
            try {
                startActivity(intent)
                return true
            } catch (_: Exception) {
                continue
            }
        }
        return false
    }
}
