package com.xavindo.tapgo.driver

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
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
    private var activeRingtone: Ringtone? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Sebelum notifikasi apa pun dapat tampil.
        createAlertNotificationChannel()
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
                "playNotificationSound" -> result.success(playNotificationSound())
                else -> result.notImplemented()
            }
        }
    }

    private fun notificationAudioAttributes(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

    // Channel BARU "tapgo_alerts_v2". Sejak Android 8 suara dan prioritas channel
    // yang sudah ada TIDAK berubah oleh pemasangan baru dan createNotificationChannel
    // ulang pada id yang sama diabaikan; channel lama tapgo_default sudah
    // terkunci di HP yang pernah memasang APK lama (senyap). Karena itu order,
    // chat, dan pembaruan perjalanan memakai id baru ini. Suara eksplisit
    // (ringtone notifikasi bawaan), tidak pernah dikosongkan. HP yang mode
    // senyap/Jangan Ganggu tetap senyap: USAGE_NOTIFICATION mengikuti aturan itu.
    private fun createAlertNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            "tapgo_alerts_v2",
            "Peringatan TapGo",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Order baru, pesan chat, dan pembaruan perjalanan yang harus berbunyi"
            enableVibration(true)
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                notificationAudioAttributes()
            )
        }
        manager.createNotificationChannel(channel)
    }

    /**
     * Memutar ringtone notifikasi bawaan HP SEKALI (saat aplikasi di depan,
     * bunyi tidak bergantung pada notifikasi). Mengembalikan false bila gagal
     * sehingga Dart dapat jatuh ke notifikasi di channel yang sama.
     */
    private fun playNotificationSound(): Boolean {
        return try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                ?: return false
            val ringtone = RingtoneManager.getRingtone(applicationContext, uri)
                ?: return false
            ringtone.audioAttributes = notificationAudioAttributes()
            activeRingtone?.stop()
            activeRingtone = ringtone
            ringtone.play()
            true
        } catch (_: Exception) {
            false
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
