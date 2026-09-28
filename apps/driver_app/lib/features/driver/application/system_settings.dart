part of '../../../main.dart';

/// Jembatan ke pengaturan sistem Android — HANYA notifikasi untuk saat ini.
///
/// Sengaja bukan lewat url_launcher: membuka layar Pengaturan sistem
/// (android.settings.APP_NOTIFICATION_SETTINGS) memerlukan Intent asli,
/// bukan URL, jadi dijembatani MethodChannel tipis ke MainActivity.kt.
/// Web/demo TIDAK memiliki channel ini sama sekali (lihat [openSystemNotificationSettings]).
const MethodChannel _systemSettingsChannel = MethodChannel('tapgo.driver/settings');

/// Seam uji: mengganti pemanggilan MethodChannel sungguhan.
@visibleForTesting
Future<bool> Function()? tapGoOpenNotificationSettingsForTests;

/// Membuka layar notifikasi bawaan Android untuk aplikasi ini. Best-effort:
/// kegagalan (mis. web, emulator tanpa Settings, API tak terduga) tidak
/// pernah melempar — pemanggil menampilkan pesan sendiri berdasarkan hasilnya.
Future<bool> openSystemNotificationSettings() async {
  final override = tapGoOpenNotificationSettingsForTests;
  if (override != null) return override();
  if (kIsWeb || kDriverDemoMode) return false;
  try {
    final ok = await _systemSettingsChannel.invokeMethod<bool>('openNotificationSettings');
    return ok ?? false;
  } catch (_) {
    return false;
  }
}
