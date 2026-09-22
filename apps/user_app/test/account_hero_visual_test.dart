import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/main.dart';

import 'ppob_visual_evidence_test.dart' show loadRealFonts;

/// Bukti visual: kartu identitas "Akun" (_AccountHero, mode Play) setelah
/// diselaraskan dengan emas Kartu Anggota resmi (D4AF37), bukan kuning
/// (FFD166) — permintaan owner 22 Sep 2026. TIDAK berjalan pada
/// `flutter test` biasa:
///
///   flutter test test/account_hero_visual_test.dart \
///     --dart-define=TAPGO_ACCOUNT_VISUAL=true --update-goldens
const bool _enabled = bool.fromEnvironment('TAPGO_ACCOUNT_VISUAL');

void main() {
  testWidgets('kartu Akun (Play): emas TapGo, bukan kuning', (tester) async {
    tapGoDisablePersistenceForTests = true;
    addTearDown(() => tapGoDisablePersistenceForTests = false);
    expect(await loadRealFonts(), isTrue);
    tester.view.physicalSize = const Size(1080, 1400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tapGoSessionProviderForTest.overrideWith(
            (ref) => DemoClientSession.initial().copyWith(
              userName: 'Sandika TapGo',
              activePackageName: 'Basic',
            ),
          ),
        ],
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: tapGoReadableTheme(),
          home: const Scaffold(body: AccountScreen()),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('../../../docs/release-2/visual-review/r2.13-account/01_account_hero_gold.png'),
    );
  }, skip: !_enabled);
}
