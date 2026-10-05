package com.xavindo.tapgo.driver

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
    private val alertsChannel = "tapgo.driver/alerts"
    private val alertSound by lazy { AlertSound(applicationContext) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Sebelum notifikasi apa pun dapat tampil.
        alertSound.createChannel()
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
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, alertsChannel).setMethodCallHandler { call, result ->
            when (call.method) {
                // true bila bunyi dimulai (berkas suara aplikasi, atau nada bawaan HP sebagai cadangan).
                "playNotificationSound" -> result.success(alertSound.play() == null)
                // Untuk layar "Uji bunyi": keadaan HP + hasil pemutaran (galat atau null).
                "soundDiagnostics" -> {
                    val info = alertSound.diagnostics().toMutableMap()
                    info["playError"] = alertSound.play()
                    result.success(info)
                }
                "areNotificationsEnabled" -> result.success(alertSound.notificationsEnabled())
                else -> result.notImplemented()
            }
        }
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
