import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/application/ppob_providers.dart';
import 'package:tapgo_user_app/features/ppob/data/ppob_demo_repository.dart';
import 'package:tapgo_user_app/main.dart';

/// Ketika server menegaskan sesi sudah berakhir, aplikasi harus keluar dengan
/// rapi ke layar masuk — bukan tetap tampak "sudah masuk" sambil menampilkan
/// error mentah di tiap layar (perilaku sebelumnya).
void main() {
  testWidgets('sesi berakhir: pesan tampil dan layar masuk terbuka', (tester) async {
    tapGoDisablePersistenceForTests = true;
    addTearDown(() => tapGoDisablePersistenceForTests = false);
    tester.view.physicalSize = const Size(1080, 2200);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          ppobRepositoryProvider.overrideWithValue(createDemoPpobRepository()),
        ],
        child: const TapGoUserApp(),
      ),
    );
    // Bootstrap selesai (persistensi dimatikan) sehingga penangan terdaftar.
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }

    tapGoTriggerSessionExpiredForTests();
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }

    expect(find.text('Sesi Anda berakhir. Silakan masuk kembali.'), findsOneWidget);
    expect(find.byType(AuthScreen), findsOneWidget);
  });
}
