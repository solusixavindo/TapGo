package com.xavindo.tapgo.driver

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentResolver
import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build

/**
 * Bunyi peringatan TapGo (order, chat, pembaruan perjalanan) dengan TIGA pilihan
 * nada yang dipilih driver (Akun > Notifikasi).
 *
 * - Suara channel notifikasi TIDAK dapat diubah setelah channel dibuat (Android
 *   8+), jadi setiap nada punya channel sendiri: tapgo_alerts_v3 (TapGo, bawaan),
 *   tapgo_alerts_v3_lonceng, tapgo_alerts_v3_panggilan. Server memilih channel
 *   per perangkat sesuai pilihan driver untuk notifikasi saat aplikasi tertutup.
 * - Saat aplikasi di depan, nada dipilih diputar langsung (MediaPlayer) dari
 *   berkas di res/raw, bukan dari nada bawaan HP yang bisa "Tanpa suara".
 * Suara tetap USAGE_NOTIFICATION: HP mode senyap/Jangan Ganggu tetap senyap.
 */
class AlertSound(private val context: Context) {
    enum class Tone(val key: String, val rawName: String, val channelId: String, val channelName: String) {
        TAPGO("tapgo", "tapgo_alert", "tapgo_alerts_v3", "Peringatan TapGo"),
        LONCENG("lonceng", "tapgo_alert_lonceng", "tapgo_alerts_v3_lonceng", "Peringatan TapGo (Lonceng)"),
        PANGGILAN("panggilan", "tapgo_alert_panggilan", "tapgo_alerts_v3_panggilan", "Peringatan TapGo (Panggilan)");

        companion object {
            /** Kunci tak dikenal atau kosong jatuh ke nada bawaan TapGo. */
            fun of(key: String?): Tone = entries.firstOrNull { it.key == key } ?: TAPGO
        }
    }

    private var player: MediaPlayer? = null
    private var fallback: Ringtone? = null

    private fun attributes(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

    private fun rawId(tone: Tone): Int =
        context.resources.getIdentifier(tone.rawName, "raw", context.packageName)

    private fun soundUri(tone: Tone): Uri =
        Uri.parse("${ContentResolver.SCHEME_ANDROID_RESOURCE}://${context.packageName}/raw/${tone.rawName}")

    /** Dipanggil di MainActivity.onCreate, sebelum notifikasi apa pun: satu channel per nada. */
    fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        for (tone in Tone.entries) {
            val channel = NotificationChannel(tone.channelId, tone.channelName, NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Order baru, pesan chat, dan pembaruan perjalanan yang harus berbunyi"
                enableVibration(true)
                setSound(soundUri(tone), attributes())
            }
            manager.createNotificationChannel(channel)
        }
    }

    fun notificationsEnabled(): Boolean =
        context.getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() ?: true

    /**
     * Memutar nada pilihan SEKALI lewat MediaPlayer (bukan notifikasi). null bila
     * berhasil dimulai, atau pesan galatnya. Bila berkas suara bermasalah, jatuh ke
     * nada notifikasi bawaan HP.
     */
    fun play(key: String?): String? {
        val tone = Tone.of(key)
        try {
            val id = rawId(tone)
            if (id == 0) throw IllegalStateException("berkas suara tidak ditemukan")
            val afd = context.resources.openRawResourceFd(id)
            val mp = MediaPlayer()
            try {
                mp.setAudioAttributes(attributes())
                mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
            } finally {
                afd.close()
            }
            mp.setOnCompletionListener { finished ->
                finished.release()
                if (player === finished) player = null
            }
            mp.setOnErrorListener { failed, _, _ ->
                failed.release()
                if (player === failed) player = null
                true
            }
            mp.prepare()
            val previous = player
            player = mp
            try { previous?.release() } catch (_: Exception) {}
            mp.start()
            return null
        } catch (error: Exception) {
            return playDefaultRingtone() ?: "fallback nada bawaan dipakai (${error.javaClass.simpleName})"
        }
    }

    private fun playDefaultRingtone(): String? {
        return try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION) ?: return "nada bawaan tidak ada"
            val ringtone = RingtoneManager.getRingtone(context, uri) ?: return "nada bawaan tidak dapat dibuka"
            ringtone.audioAttributes = attributes()
            fallback?.stop()
            fallback = ringtone
            ringtone.play()
            null
        } catch (error: Exception) {
            "nada bawaan gagal (${error.javaClass.simpleName})"
        }
    }
}
