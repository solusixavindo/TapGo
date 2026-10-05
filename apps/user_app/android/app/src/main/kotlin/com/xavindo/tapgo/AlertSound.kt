package com.xavindo.tapgo

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentResolver
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build

/**
 * Bunyi peringatan TapGo (order, chat, pembaruan perjalanan).
 *
 * Mengapa channel BARU (tapgo_alerts_v3) dan suara bawaan aplikasi:
 * - Sejak Android 8, suara/prioritas channel yang sudah ada TIDAK berubah oleh
 *   pemasangan baru, dan membuat ulang channel dengan id yang sama diabaikan.
 *   tapgo_default dan tapgo_alerts_v2 sudah terkunci di HP uji (nada bawaan HP).
 * - Nada notifikasi bawaan HP bisa "Tanpa suara"; berkas suara di res/raw tidak.
 * Suara tetap USAGE_NOTIFICATION: HP mode senyap/Jangan Ganggu tetap senyap.
 */
class AlertSound(private val context: Context) {
    companion object {
        const val CHANNEL_ID = "tapgo_alerts_v3"
        const val CHANNEL_NAME = "Peringatan TapGo"
        private const val RAW_NAME = "tapgo_alert"
    }

    private var player: MediaPlayer? = null

    private fun attributes(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

    private fun rawId(): Int = context.resources.getIdentifier(RAW_NAME, "raw", context.packageName)

    fun soundUri(): Uri =
        Uri.parse("${ContentResolver.SCHEME_ANDROID_RESOURCE}://${context.packageName}/raw/$RAW_NAME")

    /** Dipanggil di MainActivity.onCreate, sebelum notifikasi apa pun. */
    fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Pembaruan perjalanan, pesan chat, saldo, dan pembayaran"
            enableVibration(true)
            setSound(soundUri(), attributes())
        }
        manager.createNotificationChannel(channel)
    }

    fun notificationsEnabled(): Boolean =
        context.getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() ?: true

    /**
     * Memutar bunyi peringatan SEKALI lewat MediaPlayer (bukan notifikasi).
     * Mengembalikan null bila berhasil dimulai, atau pesan galatnya. Bila berkas
     * suara bermasalah, jatuh ke nada notifikasi bawaan HP.
     */
    fun play(): String? {
        try {
            val id = rawId()
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

    private var fallback: Ringtone? = null

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

    /** Keadaan HP yang menentukan apakah bunyi terdengar (untuk layar "Uji bunyi"). */
    fun diagnostics(): Map<String, Any?> {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val manager = context.getSystemService(NotificationManager::class.java)
        val info = HashMap<String, Any?>()
        info["sdkInt"] = Build.VERSION.SDK_INT
        info["device"] = "${Build.MANUFACTURER} ${Build.MODEL}"
        info["notificationsEnabled"] = notificationsEnabled()
        info["soundResourceFound"] = rawId() != 0
        info["ringerMode"] = audio.ringerMode // 0 senyap, 1 getar, 2 normal
        info["volumeNotification"] = audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION)
        info["volumeNotificationMax"] = audio.getStreamMaxVolume(AudioManager.STREAM_NOTIFICATION)
        info["volumeMusic"] = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        info["volumeRing"] = audio.getStreamVolume(AudioManager.STREAM_RING)
        try {
            info["dndFilter"] = manager?.currentInterruptionFilter // 1 semua, 2 prioritas, 3 tidak ada, 4 alarm
        } catch (_: Exception) {}
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = manager?.getNotificationChannel(CHANNEL_ID)
            info["channelExists"] = channel != null
            info["channelImportance"] = channel?.importance
            info["channelSound"] = channel?.sound?.toString()
            info["channelVibration"] = channel?.shouldVibrate()
        }
        try {
            val defaultUri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_NOTIFICATION)
            info["defaultToneUri"] = defaultUri?.toString()
            info["defaultToneTitle"] = defaultUri?.let { RingtoneManager.getRingtone(context, it)?.getTitle(context) }
        } catch (_: Exception) {}
        return info
    }
}
