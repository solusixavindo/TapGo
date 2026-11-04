import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Foto profil satu akun dibagi dengan web tapgolion.id. Foto yang diganti di web
/// harus tampil di aplikasi tanpa menutup aplikasi: dimuat ulang saat aplikasi
/// kembali ke layar depan.
void main() {
  testWidgets('foto profil dimuat ulang saat aplikasi kembali ke layar depan',
      (tester) async {
    tapGoDisablePersistenceForTests = true;
    var loads = 0;

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tapGoAccountAvatarProviderForTest.overrideWith((ref) async {
            loads += 1;
            return Uint8List.fromList([loads]);
          }),
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
    expect(loads, 1, reason: 'dimuat sekali saat dashboard terbuka');

    // Aplikasi ke latar belakang lalu kembali (mis. foto diganti di web).
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    expect(loads, 1, reason: 'masuk ke latar belakang tidak memuat ulang');
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    for (var index = 0; index < 5; index += 1) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    tester.takeException();
    expect(loads, 2, reason: 'kembali ke layar depan memuat foto terbaru');
  });
}
