/// Koordinator refresh token — SATU-satunya jalur penukaran refresh token.
///
/// Masalah yang diselesaikan (akar masalah "diminta login padahal tidak logout"):
/// refresh token bersifat sekali pakai (dirotasi di server). Beberapa bagian
/// aplikasi (interceptor HTTP, bootstrap sesi, layar ride, ganti password,
/// beranda) masing-masing membaca refresh token lalu menukarnya. Bila dua
/// penukaran membawa token yang SAMA — karena berbarengan, atau karena salah
/// satunya membawa salinan basi yang dibaca sebelum penukaran pertama selesai
/// disimpan — server melihat pemakaian ulang dan mencabut seluruh sesi.
///
/// Koordinator ini menjamin:
///  1. paling banyak SATU penukaran berjalan (pemanggil lain menunggu hasilnya);
///  2. token yang sudah dikonsumsi TIDAK PERNAH dikirim lagi — pemanggil basi
///     dijawab dari hasil penukaran terbaru;
///  3. pasangan token baru disimpan SEBELUM koordinator melepas kunci, sehingga
///     pembaca berikutnya tidak melihat token lama;
///  4. bila server menjawab "token baru saja dirotasi" (409), koordinator memakai
///     pasangan yang tersimpan, bukan menganggap sesi mati.
library;

typedef TokenPair = ({String accessToken, String refreshToken});

enum RefreshStatus { refreshed, rejected, unreachable, conflict }

typedef RefreshOutcome = ({RefreshStatus status, TokenPair? tokens});

class TokenRefreshCoordinator {
  TokenRefreshCoordinator({
    required this.network,
    this.persist,
    this.readStored,
    this.conflictRetryDelay = const Duration(milliseconds: 300),
  });

  /// Satu-satunya pemanggilan jaringan ke endpoint refresh.
  final Future<RefreshOutcome> Function(String refreshToken) network;

  /// Menyimpan pasangan token baru (storage + header) — dijalankan di dalam kunci.
  final Future<void> Function(TokenPair tokens)? persist;

  /// Pasangan token yang saat ini tersimpan (sumber kebenaran), atau null.
  final Future<TokenPair?> Function()? readStored;

  final Duration conflictRetryDelay;

  final List<String> _consumed = [];
  TokenPair? _latest;
  Future<RefreshOutcome>? _inFlight;

  /// Token yang sudah pernah ditukar pada proses ini (untuk diagnosis/tes).
  bool wasConsumed(String refreshToken) => _consumed.contains(refreshToken);

  Future<RefreshOutcome> refresh(String presented) {
    if (presented.isEmpty) {
      return Future.value((status: RefreshStatus.rejected, tokens: null));
    }
    final latest = _latest;
    if (latest != null && _consumed.contains(presented)) {
      // Pemanggil memegang salinan basi: jangan kirim ke server.
      return Future.value((status: RefreshStatus.refreshed, tokens: latest));
    }
    final existing = _inFlight;
    if (existing != null) {
      return existing;
    }
    final future = _run(presented);
    _inFlight = future;
    future.whenComplete(() {
      if (identical(_inFlight, future)) {
        _inFlight = null;
      }
    });
    return future;
  }

  Future<RefreshOutcome> _run(String presented) async {
    // Storage adalah sumber kebenaran: bila sudah berisi token yang LEBIH BARU
    // daripada yang dibawa pemanggil, penukaran sudah terjadi di tempat lain.
    final stored = await _safeReadStored();
    if (stored != null &&
        stored.refreshToken.isNotEmpty &&
        stored.refreshToken != presented &&
        !_consumed.contains(stored.refreshToken)) {
      _remember(presented, stored);
      return (status: RefreshStatus.refreshed, tokens: stored);
    }

    final outcome = await network(presented);
    switch (outcome.status) {
      case RefreshStatus.refreshed:
        final tokens = outcome.tokens;
        if (tokens == null) {
          return (status: RefreshStatus.unreachable, tokens: null);
        }
        _remember(presented, tokens);
        await _safePersist(tokens);
        return outcome;
      case RefreshStatus.conflict:
        // Server: token ini baru saja dirotasi oleh permintaan lain yang sah.
        // Beri waktu pemenang menyimpan hasilnya, lalu pakai yang tersimpan.
        await Future<void>.delayed(conflictRetryDelay);
        final after = await _safeReadStored();
        if (after != null &&
            after.refreshToken.isNotEmpty &&
            after.refreshToken != presented) {
          _remember(presented, after);
          return (status: RefreshStatus.refreshed, tokens: after);
        }
        return (status: RefreshStatus.unreachable, tokens: null);
      case RefreshStatus.rejected:
      case RefreshStatus.unreachable:
        return outcome;
    }
  }

  void _remember(String consumedToken, TokenPair latest) {
    _consumed.add(consumedToken);
    if (_consumed.length > 8) {
      _consumed.removeAt(0);
    }
    _latest = latest;
  }

  Future<TokenPair?> _safeReadStored() async {
    try {
      return await readStored?.call();
    } catch (_) {
      return null;
    }
  }

  Future<void> _safePersist(TokenPair tokens) async {
    try {
      await persist?.call(tokens);
    } catch (_) {
      // Kegagalan menyimpan tidak boleh membatalkan hasil penukaran: token baru
      // tetap dipakai di memori pada proses ini.
    }
  }
}
