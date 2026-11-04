import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Foto profil satu akun dibagi dengan web tapgolion.id. Foto yang diganti di web
/// harus tampil di aplikasi tanpa menutup aplikasi: dimuat ulang saat aplikasi
/// kembali ke layar depan. Tiga hal dijaga:
///  1. muat ulang benar-benar terjadi saat kembali ke layar depan;
///  2. muat ulang yang GAGAL (sinyal putus) tidak menghapus foto dari layar;
///  3. foto akun lain tidak pernah tampil setelah ganti akun di HP yang sama.
Future<void> pumpDashboard(
  WidgetTester tester,
  FutureOr<Uint8List?> Function(String? userId) load,
) async {
  tapGoDisablePersistenceForTests = true;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        tapGoAccountAvatarProviderForTest
            .overrideWith((ref, userId) => load(userId)),
      ],
      child: MaterialApp(
        theme: tapGoReadableTheme(brightness: Brightness.light),
        home: const TapGoDashboard(),
      ),
    ),
  );
  for (var index = 0; index < 12; index += 1) {
    await tester.pump(const Duration(milliseconds: 80));
  }
  tester.takeException();
}

Future<void> settle(WidgetTester tester) async {
  for (var index = 0; index < 5; index += 1) {
    await tester.pump(const Duration(milliseconds: 50));
  }
  tester.takeException();
}

void main() {
  testWidgets('foto profil dimuat ulang saat aplikasi kembali ke layar depan',
      (tester) async {
    var loads = 0;
    await pumpDashboard(tester, (_) {
      loads += 1;
      return Uint8List.fromList([loads]);
    });
    expect(loads, 1, reason: 'dimuat sekali saat dashboard terbuka');

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    expect(loads, 1, reason: 'masuk ke latar belakang tidak memuat ulang');
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await settle(tester);
    expect(loads, 2, reason: 'kembali ke layar depan memuat foto terbaru');
  });

  testWidgets('muat ulang yang gagal mempertahankan foto sebelumnya',
      (tester) async {
    var loads = 0;
    await pumpDashboard(tester, (_) {
      loads += 1;
      if (loads == 1) return Uint8List.fromList([7]);
      throw StateError('sinyal putus');
    });
    final container =
        ProviderScope.containerOf(tester.element(find.byType(TapGoDashboard)));
    expect(
      container.read(tapGoAccountAvatarValueProviderForTest).valueOrNull,
      Uint8List.fromList([7]),
    );

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await settle(tester);
    expect(loads, 2, reason: 'percobaan muat ulang terjadi dan gagal');
    expect(
      container.read(tapGoAccountAvatarValueProviderForTest).valueOrNull,
      Uint8List.fromList([7]),
      reason: 'foto lama tetap tampil, bukan hilang',
    );
  });

  test('foto akun lain tidak pernah tampil setelah ganti akun', () async {
    tapGoDisablePersistenceForTests = true;
    final slowB = Completer<Uint8List?>();
    final container = ProviderContainer(
      overrides: [
        tapGoAccountAvatarProviderForTest.overrideWith((ref, userId) {
          if (userId == 'A') return Uint8List.fromList([1]);
          return slowB.future;
        }),
      ],
    );
    addTearDown(container.dispose);
    container.listen(tapGoAccountAvatarValueProviderForTest, (_, __) {});

    final session = container.read(tapGoSessionProviderForTest.notifier);
    session.state = session.state.copyWith(userId: 'A');
    await container.read(tapGoAccountAvatarProviderForTest('A').future);
    expect(container.read(tapGoAccountAvatarValueProviderForTest).valueOrNull,
        Uint8List.fromList([1]));

    // Akun B masuk di HP yang sama; fotonya masih dimuat.
    session.state = session.state.copyWith(userId: 'B');
    expect(
      container.read(tapGoAccountAvatarValueProviderForTest).valueOrNull,
      isNull,
      reason: 'foto akun A tidak boleh tampil untuk akun B',
    );
    slowB.complete(Uint8List.fromList([2]));
    await container.read(tapGoAccountAvatarProviderForTest('B').future);
    expect(container.read(tapGoAccountAvatarValueProviderForTest).valueOrNull,
        Uint8List.fromList([2]));
  });
}
