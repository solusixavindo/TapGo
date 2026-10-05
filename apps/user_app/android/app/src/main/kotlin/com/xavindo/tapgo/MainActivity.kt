package com.xavindo.tapgo

import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    // Nama dan method HARUS sama persis dengan sisi Dart
    // (lib/services/push_notifications.dart).
    private val alertsChannel = "tapgo.user/alerts"
    private var activeRingtone: Ringtone? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Sebelum notifikasi apa pun dapat tampil.
        createAlertNotificationChannel()
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
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

    // Channel BARU "tapgo_alerts_v2". Suara/prioritas channel yang sudah ada tidak
    // berubah oleh pemasangan baru dan createNotificationChannel ulang pada id yang
    // sama diabaikan; channel lama tapgo_default sudah terkunci (senyap) di HP
    // yang pernah memasang APK lama. Suara eksplisit (ringtone notifikasi bawaan),
    // tidak pernah dikosongkan. HP yang mode senyap/Jangan Ganggu tetap senyap.
    private fun createAlertNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            "tapgo_alerts_v2",
            "Peringatan TapGo",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Pembaruan perjalanan, pesan chat, saldo, dan pembayaran"
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
     * bunyi tidak bergantung pada notifikasi). false bila gagal, sehingga Dart
     * jatuh ke notifikasi di channel yang sama.
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
}
