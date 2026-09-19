part of '../main.dart';

final _isAuthenticatedProvider = StateProvider<bool>((ref) => false);
final _demoSessionProvider = StateProvider<DemoClientSession>(
  (ref) => DemoClientSession.initial(),
);

/// Foto profil dibagikan antara ikon tab "Akun" dan halaman Profil supaya
/// keduanya konsisten dan tidak masing-masing menembak request sendiri.
/// null berarti belum ada foto atau gagal dimuat — pemanggil jatuh balik ke
/// ikon generik, bukan menampilkan error.
final _accountAvatarBytesProvider = FutureProvider<Uint8List?>((ref) async {
  if (tapGoDisablePersistenceForTests) {
    return null;
  }
  try {
    return await _apiClient.fetchAvatarBytes();
  } catch (_) {
    return null;
  }
});
