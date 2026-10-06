part of '../main.dart';

/// Tiga pilihan bunyi peringatan (Akun > Notifikasi), seperti memilih nada
/// dering; sama dengan aplikasi driver. Suara channel notifikasi Android TIDAK
/// bisa diubah setelah channel dibuat, jadi setiap bunyi punya channel sendiri.
/// Kunci, id channel, dan berkas suara HARUS sama dengan AlertSound.kt
/// (res/raw) dan whitelist backend (`PUSH_SOUNDS`).
enum TapGoAlertTone {
  tapgo('tapgo', 'TapGo', 'tapgo_alerts_v3'),
  lonceng('lonceng', 'Lonceng', 'tapgo_alerts_v3_lonceng'),
  panggilan('panggilan', 'Panggilan', 'tapgo_alerts_v3_panggilan');

  const TapGoAlertTone(this.key, this.label, this.channelId);

  /// Dikirim ke native (MethodChannel) dan ke backend.
  final String key;
  final String label;
  final String channelId;

  /// Kunci tak dikenal atau kosong jatuh ke bunyi bawaan TapGo.
  static TapGoAlertTone fromKey(String? key) =>
      TapGoAlertTone.values.firstWhere((tone) => tone.key == key,
          orElse: () => TapGoAlertTone.tapgo);
}

const _tapGoAlertTonePrefsKey = 'tapgo_user_alert_tone';

/// Bunyi pilihan pengguna. Berlaku langsung saat aplikasi terbuka, dan dikirim
/// ke server (lihat [tapGoReregisterPush]) supaya notifikasi saat aplikasi
/// tertutup memakai channel bunyi yang sama.
final ValueNotifier<TapGoAlertTone> tapGoAlertTone =
    ValueNotifier<TapGoAlertTone>(TapGoAlertTone.tapgo);

Future<void>? _tapGoAlertToneRestore;

/// Selesai setelah pilihan tersimpan terbaca. Dipanggil sebelum mendaftarkan
/// token push dan saat layar Akun dibuka; aman dipanggil berulang.
Future<void> tapGoAlertToneReady() =>
    _tapGoAlertToneRestore ??= _tapGoRestoreAlertTone();

Future<void> _tapGoRestoreAlertTone() async {
  try {
    final preferences = await SharedPreferences.getInstance();
    tapGoAlertTone.value =
        TapGoAlertTone.fromKey(preferences.getString(_tapGoAlertTonePrefsKey));
  } catch (_) {
    // Tidak terbaca: tetap bunyi bawaan.
  }
}

Future<void> tapGoSelectAlertTone(TapGoAlertTone tone) async {
  // Pilihan yang baru diketuk tidak boleh ditimpa oleh pembacaan lama yang
  // belum selesai.
  await tapGoAlertToneReady();
  tapGoAlertTone.value = tone;
  try {
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_tapGoAlertTonePrefsKey, tone.key);
  } catch (_) {
    // Tetap berlaku untuk sesi ini walau gagal disimpan permanen.
  }
}

/// Mengosongkan status bunyi antar uji.
@visibleForTesting
void tapGoResetAlertToneForTests() {
  _tapGoAlertToneRestore = null;
  tapGoAlertTone.value = TapGoAlertTone.tapgo;
}

/// Apakah notifikasi aplikasi ini menyala di pengaturan Android. true bila
/// tidak dapat ditentukan (tidak menampilkan peringatan yang keliru).
Future<bool> tapGoAreNotificationsEnabled() async {
  try {
    return await tapGoAlertsMethodChannel
            .invokeMethod<bool>('areNotificationsEnabled') ??
        true;
  } catch (_) {
    return true;
  }
}

/// Membuka pengaturan notifikasi Android untuk aplikasi ini.
Future<bool> tapGoOpenNotificationSettings() async {
  try {
    return await tapGoAlertsMethodChannel
            .invokeMethod<bool>('openNotificationSettings') ??
        false;
  } catch (_) {
    return false;
  }
}
