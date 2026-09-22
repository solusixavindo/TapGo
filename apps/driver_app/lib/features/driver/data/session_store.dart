part of '../../../main.dart';

abstract class SessionStore {
  Future<void> save(DriverSession session);
  Future<DriverSession?> read();
  Future<void> clear();
}

class MemorySessionStore implements SessionStore {
  DriverSession? _session;
  @override
  Future<void> save(DriverSession session) async => _session = session;
  @override
  Future<DriverSession?> read() async => _session;
  @override
  Future<void> clear() async => _session = null;
}

class SecureSessionStore implements SessionStore {
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  static const _access = 'tapgo.driver.access.v1';
  static const _refresh = 'tapgo.driver.refresh.v1';
  static const _name = 'tapgo.driver.name.v1';
  static const _writeTimeout = Duration(seconds: 3);

  @override
  Future<void> save(DriverSession session) async {
    await _safeWrite(_access, session.accessToken);
    await _safeWrite(_refresh, session.refreshToken);
    await _safeWrite(_name, session.driverName);
  }

  @override
  Future<DriverSession?> read() async {
    final access = await _safeRead(_access);
    final refresh = await _safeRead(_refresh);
    if (access == null || refresh == null) return null;
    return DriverSession(
      accessToken: access,
      refreshToken: refresh,
      driverName: await _safeRead(_name) ?? 'Driver TapGo',
    );
  }

  @override
  Future<void> clear() async {
    await _safeDelete(_access);
    await _safeDelete(_refresh);
    await _safeDelete(_name);
  }

  /// Baca yang gagal (mis. Android Keystore belum siap saat cold start,
  /// bersaing dengan plugin native lain yang ikut inisialisasi di frame yang
  /// sama) dikembalikan sebagai null, BUKAN dilempar — supaya pemanggil bisa
  /// membedakan "belum pernah login" dari "storage gagal dibaca" dan
  /// memutuskan sendiri apakah perlu dicoba ulang (lihat
  /// _restoreLocalSessionWithRetry di api_driver_repository.dart). Pola sama
  /// dengan _TapGoPersistentStore._safeRead di user_app.
  Future<String?> _safeRead(String key) async {
    try {
      return await _storage.read(key: key);
    } catch (_) {
      return null;
    }
  }

  /// Penulisan PERTAMA ke Keystore/EncryptedSharedPreferences bisa memicu
  /// inisialisasi kunci yang pada sebagian perangkat nyata melewati beberapa
  /// detik. Dicoba dua kali dengan timeout sebelum benar-benar menyerah —
  /// tanpa ini, login terlihat berhasil di UI tapi token tidak pernah benar-
  /// benar tersimpan, sehingga sesi hilang begitu aplikasi ditutup padahal
  /// driver tidak pernah logout. Pola sama dengan _safeWrite di user_app.
  Future<void> _safeWrite(String key, String value) async {
    for (var attempt = 1; attempt <= 2; attempt++) {
      try {
        await _storage.write(key: key, value: value).timeout(_writeTimeout);
        return;
      } catch (_) {
        // Percobaan berikutnya, atau menyerah diam-diam setelah yang kedua —
        // sesi tetap hidup di memori proses ini, hanya penyimpanan permanen
        // yang tertunda.
      }
    }
  }

  Future<void> _safeDelete(String key) async {
    for (var attempt = 1; attempt <= 2; attempt++) {
      try {
        await _storage.delete(key: key).timeout(_writeTimeout);
        return;
      } catch (_) {
        // lihat catatan _safeWrite.
      }
    }
  }
}
