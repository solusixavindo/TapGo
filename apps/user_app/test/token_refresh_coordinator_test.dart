import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/services/token_refresh_coordinator.dart';

/// Server tiruan yang meniru perilaku backend: refresh token sekali pakai,
/// pemakaian ulang mencabut sesi (kecuali jendela toleransi pada versi baru).
class _FakeServer {
  int generation = 0;
  String current = 'r0';
  bool revoked = false;
  final calls = <String>[];
  Duration latency = const Duration(milliseconds: 40);

  Future<RefreshOutcome> refresh(String token) async {
    calls.add(token);
    await Future<void>.delayed(latency);
    if (revoked) {
      return (status: RefreshStatus.rejected, tokens: null);
    }
    if (token != current) {
      revoked = true; // pemakaian ulang => sesi dicabut
      return (status: RefreshStatus.rejected, tokens: null);
    }
    generation += 1;
    current = 'r$generation';
    return (
      status: RefreshStatus.refreshed,
      tokens: (accessToken: 'a$generation', refreshToken: current),
    );
  }
}

void main() {
  test('sepuluh pemanggil serentak: SATU panggilan jaringan, semua dapat hasil sama',
      () async {
    final server = _FakeServer();
    final coordinator = TokenRefreshCoordinator(network: server.refresh);
    final results = await Future.wait(
      List.generate(10, (_) => coordinator.refresh('r0')),
    );
    expect(server.calls, ['r0']);
    expect(results.every((r) => r.status == RefreshStatus.refreshed), isTrue);
    expect(results.map((r) => r.tokens!.refreshToken).toSet(), {'r1'});
    expect(server.revoked, isFalse);
  });

  test('pemanggil BASI (membaca token sebelum penukaran selesai disimpan) tidak memicu reuse',
      () async {
    final server = _FakeServer();
    final coordinator = TokenRefreshCoordinator(network: server.refresh);

    final first = await coordinator.refresh('r0');
    expect(first.tokens!.refreshToken, 'r1');

    // Balapan yang menyebabkan logout paksa: pemanggil lain masih memegang 'r0'
    // padahal penukaran pertama sudah selesai dan `_inFlight` sudah dilepas.
    final stale = await coordinator.refresh('r0');
    expect(stale.status, RefreshStatus.refreshed);
    expect(stale.tokens!.refreshToken, 'r1');
    expect(server.calls, ['r0']); // tidak pernah mengirim 'r0' dua kali
    expect(server.revoked, isFalse);
  });

  test('penukaran berantai memakai token terbaru dan tetap tidak pernah reuse', () async {
    final server = _FakeServer();
    final coordinator = TokenRefreshCoordinator(network: server.refresh);
    var token = 'r0';
    for (var i = 0; i < 5; i++) {
      final r = await coordinator.refresh(token);
      token = r.tokens!.refreshToken;
      final stale = await coordinator.refresh('r$i');
      expect(stale.status, RefreshStatus.refreshed);
    }
    expect(server.revoked, isFalse);
    expect(server.calls, ['r0', 'r1', 'r2', 'r3', 'r4']);
  });

  test('pasangan baru disimpan SEBELUM kunci dilepas (pembaca berikutnya melihat token baru)',
      () async {
    final server = _FakeServer();
    TokenPair? stored = (accessToken: 'a0', refreshToken: 'r0');
    final coordinator = TokenRefreshCoordinator(
      network: server.refresh,
      persist: (t) async {
        await Future<void>.delayed(const Duration(milliseconds: 30));
        stored = t;
      },
      readStored: () async => stored,
    );
    await coordinator.refresh('r0');
    expect(stored!.refreshToken, 'r1');
  });

  test('storage sudah lebih baru dari token pemanggil: tidak ada panggilan jaringan',
      () async {
    final server = _FakeServer();
    final coordinator = TokenRefreshCoordinator(
      network: server.refresh,
      readStored: () async => (accessToken: 'a9', refreshToken: 'r9'),
    );
    final result = await coordinator.refresh('r0');
    expect(server.calls, isEmpty);
    expect(result.tokens!.refreshToken, 'r9');
  });

  test('409 (baru dirotasi pihak lain): pakai pasangan tersimpan, sesi TIDAK dianggap mati',
      () async {
    TokenPair? stored = (accessToken: 'a0', refreshToken: 'r0');
    final coordinator = TokenRefreshCoordinator(
      network: (token) async {
        // Pemenang menyimpan hasilnya sesaat setelah kita menerima 409.
        Future<void>.delayed(const Duration(milliseconds: 50), () {
          stored = (accessToken: 'a1', refreshToken: 'r1');
        });
        return (status: RefreshStatus.conflict, tokens: null);
      },
      readStored: () async => stored,
      conflictRetryDelay: const Duration(milliseconds: 150),
    );
    final result = await coordinator.refresh('r0');
    expect(result.status, RefreshStatus.refreshed);
    expect(result.tokens!.refreshToken, 'r1');
  });

  test('409 tanpa pasangan baru di storage: dianggap sementara (unreachable), bukan ditolak',
      () async {
    final coordinator = TokenRefreshCoordinator(
      network: (_) async => (status: RefreshStatus.conflict, tokens: null),
      readStored: () async => (accessToken: 'a0', refreshToken: 'r0'),
      conflictRetryDelay: const Duration(milliseconds: 10),
    );
    final result = await coordinator.refresh('r0');
    expect(result.status, RefreshStatus.unreachable);
  });

  test('penolakan server tegas diteruskan; token kosong ditolak tanpa jaringan', () async {
    var calls = 0;
    final coordinator = TokenRefreshCoordinator(network: (_) async {
      calls++;
      return (status: RefreshStatus.rejected, tokens: null);
    });
    expect((await coordinator.refresh('rx')).status, RefreshStatus.rejected);
    expect((await coordinator.refresh('')).status, RefreshStatus.rejected);
    expect(calls, 1);
  });

  test('gangguan jaringan diteruskan sebagai unreachable; kegagalan simpan tak membatalkan hasil',
      () async {
    final down = TokenRefreshCoordinator(
      network: (_) async => (status: RefreshStatus.unreachable, tokens: null),
    );
    expect((await down.refresh('r0')).status, RefreshStatus.unreachable);

    final server = _FakeServer();
    final flaky = TokenRefreshCoordinator(
      network: server.refresh,
      persist: (_) async => throw StateError('disk penuh'),
    );
    final ok = await flaky.refresh('r0');
    expect(ok.status, RefreshStatus.refreshed);
    expect(ok.tokens!.refreshToken, 'r1');
  });
}
