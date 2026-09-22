part of '../../../main.dart';

/// Koordinator refresh token — SATU-satunya jalur penukaran refresh token.
/// Port langsung dari token_refresh_coordinator.dart milik user_app (pola
/// terbukti, pure Dart, tanpa dependency Flutter/Riverpod).
///
/// Masalah yang diselesaikan (akar masalah "diminta login padahal tidak
/// logout"): refresh token bersifat sekali pakai (dirotasi di server).
/// driver_app menjalankan dua timer paralel selagi online — polling tawaran/
/// perjalanan tiap 12 detik (driver_controller.dart) dan kirim lokasi tiap 15
/// detik — yang bisa saja sama-sama menabrak access token yang baru
/// kedaluwarsa dan sama-sama mencoba refresh di waktu yang hampir
/// bersamaan. Tanpa koordinasi, kedua penukaran membawa refresh token yang
/// SAMA; server melihatnya sebagai pemakaian ulang dan bisa mencabut seluruh
/// sesi (lihat AuthService.refresh(), backend, komentar "TOKEN_ROTATED" —
/// endpoint itu sendiri sudah dirancang mengasumsikan klien menangani 409
/// dengan retry-dari-storage, bukan menganggapnya kegagalan).
///
/// Koordinator ini menjamin:
///  1. paling banyak SATU penukaran berjalan (pemanggil lain menunggu hasilnya);
///  2. token yang sudah dikonsumsi TIDAK PERNAH dikirim lagi — pemanggil basi
///     dijawab dari hasil penukaran terbaru;
///  3. pasangan token baru disimpan SEBELUM koordinator melepas kunci, sehingga
///     pembaca berikutnya tidak melihat token lama;
///  4. bila server menjawab "token baru saja dirotasi" (409), koordinator memakai
///     pasangan yang tersimpan, bukan menganggap sesi mati.
typedef DriverTokenPair = ({String accessToken, String refreshToken});

enum DriverRefreshStatus { refreshed, rejected, unreachable, conflict }

typedef DriverRefreshOutcome = ({
  DriverRefreshStatus status,
  DriverTokenPair? tokens,
});

class TokenRefreshCoordinator {
  TokenRefreshCoordinator({
    required this.network,
    this.persist,
    this.readStored,
    this.conflictRetryDelay = const Duration(milliseconds: 300),
  });

  /// Satu-satunya pemanggilan jaringan ke endpoint refresh.
  final Future<DriverRefreshOutcome> Function(String refreshToken) network;

  /// Menyimpan pasangan token baru (storage + header) — dijalankan di dalam kunci.
  final Future<void> Function(DriverTokenPair tokens)? persist;

  /// Pasangan token yang saat ini tersimpan (sumber kebenaran), atau null.
  final Future<DriverTokenPair?> Function()? readStored;

  final Duration conflictRetryDelay;

  final List<String> _consumed = [];
  DriverTokenPair? _latest;
  Future<DriverRefreshOutcome>? _inFlight;

  /// Token yang sudah pernah ditukar pada proses ini (untuk diagnosis/tes).
  bool wasConsumed(String refreshToken) => _consumed.contains(refreshToken);

  Future<DriverRefreshOutcome> refresh(String presented) {
    if (presented.isEmpty) {
      return Future.value(
        (status: DriverRefreshStatus.rejected, tokens: null),
      );
    }
    final latest = _latest;
    if (latest != null && _consumed.contains(presented)) {
      // Pemanggil memegang salinan basi: jangan kirim ke server.
      return Future.value(
        (status: DriverRefreshStatus.refreshed, tokens: latest),
      );
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

  Future<DriverRefreshOutcome> _run(String presented) async {
    // Storage adalah sumber kebenaran: bila sudah berisi token yang LEBIH BARU
    // daripada yang dibawa pemanggil, penukaran sudah terjadi di tempat lain.
    final stored = await _safeReadStored();
    if (stored != null &&
        stored.refreshToken.isNotEmpty &&
        stored.refreshToken != presented &&
        !_consumed.contains(stored.refreshToken)) {
      _remember(presented, stored);
      return (status: DriverRefreshStatus.refreshed, tokens: stored);
    }

    final outcome = await network(presented);
    switch (outcome.status) {
      case DriverRefreshStatus.refreshed:
        final tokens = outcome.tokens;
        if (tokens == null) {
          return (status: DriverRefreshStatus.unreachable, tokens: null);
        }
        _remember(presented, tokens);
        await _safePersist(tokens);
        return outcome;
      case DriverRefreshStatus.conflict:
        // Server: token ini baru saja dirotasi oleh permintaan lain yang sah.
        // Beri waktu pemenang menyimpan hasilnya, lalu pakai yang tersimpan.
        await Future<void>.delayed(conflictRetryDelay);
        final after = await _safeReadStored();
        if (after != null &&
            after.refreshToken.isNotEmpty &&
            after.refreshToken != presented) {
          _remember(presented, after);
          return (status: DriverRefreshStatus.refreshed, tokens: after);
        }
        return (status: DriverRefreshStatus.unreachable, tokens: null);
      case DriverRefreshStatus.rejected:
      case DriverRefreshStatus.unreachable:
        return outcome;
    }
  }

  void _remember(String consumedToken, DriverTokenPair latest) {
    _consumed.add(consumedToken);
    if (_consumed.length > 8) {
      _consumed.removeAt(0);
    }
    _latest = latest;
  }

  Future<DriverTokenPair?> _safeReadStored() async {
    try {
      return await readStored?.call();
    } catch (_) {
      return null;
    }
  }

  Future<void> _safePersist(DriverTokenPair tokens) async {
    try {
      await persist?.call(tokens);
    } catch (_) {
      // Kegagalan menyimpan tidak boleh membatalkan hasil penukaran: token baru
      // tetap dipakai di memori pada proses ini.
    }
  }
}
