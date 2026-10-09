package com.xavindo.tapgo

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import java.security.MessageDigest
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    // Nama dan method HARUS sama persis dengan sisi Dart
    // (lib/services/push_notifications.dart dan lib/services/alert_tone.dart).
    private val alertsChannel = "tapgo.user/alerts"
    private val alertSound by lazy { AlertSound(applicationContext) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Sebelum notifikasi apa pun dapat tampil.
        alertSound.createChannels()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, alertsChannel).setMethodCallHandler { call, result ->
            when (call.method) {
                // true bila bunyi dimulai. Argumen "sound": tapgo | lonceng | panggilan
                // (tak dikenal = tapgo). Dipakai pratinjau saat memilih nada dan
                // bunyi peringatan saat aplikasi di depan.
                "playNotificationSound" -> result.success(alertSound.play(call.argument<String>("sound")) == null)
                // Hash SHA-256 ANDROID_ID (tidak pernah mengirim ID mentah). null bila
                // kosong atau nilai bawaan rusak. Dipakai sebagai sidik perangkat saat daftar.
                "deviceHardwareId" -> result.success(hardwareDeviceId())
                "areNotificationsEnabled" -> result.success(alertSound.notificationsEnabled())
                "openNotificationSettings" -> result.success(openNotificationSettings())
                else -> result.notImplemented()
            }
        }
    }

    private fun hardwareDeviceId(): String? {
        return try {
            val raw = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
            if (raw.isNullOrBlank() || raw == "9774d56d682e549c") {
                null
            } else {
                MessageDigest.getInstance("SHA-256")
                    .digest("tapgo-user:$raw".toByteArray())
                    .joinToString("") { "%02x".format(it) }
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Membuka layar notifikasi bawaan Android untuk aplikasi ini (di sana suara,
     * getar, dan izin notifikasi diatur). Ada fallback berjenjang; false hanya
     * bila SEMUA cara gagal.
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
