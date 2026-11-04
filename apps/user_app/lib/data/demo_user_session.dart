part of '../main.dart';

final _isAuthenticatedProvider = StateProvider<bool>((ref) => false);
final _demoSessionProvider = StateProvider<DemoClientSession>(
  (ref) => DemoClientSession.initial(),
);

/// Pintu masuk untuk test: provider sesi bersifat private, sehingga test
/// tidak bisa mengisi saldo wallet tanpa alias publik ini.
@visibleForTesting
final tapGoSessionProviderForTest = _demoSessionProvider;

/// Foto profil dibagikan antara ikon tab "Akun" dan halaman Profil supaya
/// keduanya konsisten dan tidak masing-masing menembak request sendiri.
/// null berarti belum ada foto (404) — pemanggil jatuh balik ke ikon generik.
///
/// Dua sifat yang disengaja:
/// - Dikunci pada userId: foto akun lain TIDAK PERNAH tampil setelah ganti akun
///   di HP yang sama (instansi per akun, bukan satu cache bersama).
/// - Kegagalan jaringan DILEMPAR, bukan diubah menjadi null: saat foto dimuat
///   ulang (aplikasi kembali ke layar depan) dan gagal, Riverpod mempertahankan
///   foto sebelumnya sehingga sinyal putus tidak menghapus foto dari layar.
/// autoDispose: foto dilepas dari memori begitu dashboard ditutup (keluar akun).
final _accountAvatarBytesProvider =
    FutureProvider.autoDispose.family<Uint8List?, String?>((ref, userId) async {
  if (tapGoDisablePersistenceForTests || userId == null) {
    return null;
  }
  return _apiClient.fetchAvatarBytes();
});

/// Foto milik akun yang sedang masuk (lihat [_accountAvatarBytesProvider]).
final _accountAvatarProvider =
    Provider.autoDispose<AsyncValue<Uint8List?>>((ref) {
  final userId = ref.watch(_demoSessionProvider.select((s) => s.userId));
  return ref.watch(_accountAvatarBytesProvider(userId));
});

@visibleForTesting
final tapGoAccountAvatarProviderForTest = _accountAvatarBytesProvider;

@visibleForTesting
final tapGoAccountAvatarValueProviderForTest = _accountAvatarProvider;
