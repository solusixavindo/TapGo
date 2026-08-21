import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Entry point PPOB dari dashboard pada distribusi direct (Stage R2.7).
///
/// `TAPGO_DISTRIBUTION` dibaca lewat String.fromEnvironment saat kompilasi,
/// jadi file ini dijalankan dengan:
///
///     flutter test test/ppob_direct_entry_test.dart \
///       --dart-define=TAPGO_DISTRIBUTION=direct
///
/// Pada build default (play) seluruh test ter-skip: surface aplikasi Play
/// sengaja tidak berubah pada stage ini (keputusan R2.9).

void useTallView(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 1700);
  tester.view.devicePixelRatio = 2.0;
  addTearDown(tester.view.reset);
}

Future<void> settleFrames(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  setUp(() {
    // Dashboard memuat persistent demo store; tanpa flag ini timer/IO-nya
    // membuat widget test gagal pada invariant binding.
    tapGoDisablePersistenceForTests = true;
  });

  tearDown(() {
    tapGoPpobCatalogLoaderForTests = null;
    tapGoPpobWalletLoaderForTests = null;
  });

  testWidgets('kartu Pulsa di dashboard membuka layar PPOB', (tester) async {
    expect(tapGoIsDirectDistribution, isTrue);

    tapGoPpobCatalogLoaderForTests = ({String? category}) async => [
          {
            'sku': 'PULSA_TSEL_10',
            'category': 'PULSA',
            'brand': 'Telkomsel',
            'name': 'Pulsa Telkomsel 10.000',
            'description': null,
            'price': 11500,
            'adminFee': 0,
          },
        ];
    tapGoPpobWalletLoaderForTests = () async => {'ppobBalance': '100000.00'};

    useTallView(tester);
    await tester.pumpWidget(
      const ProviderScope(child: MaterialApp(home: TapGoDashboard())),
    );
    await settleFrames(tester);

    // Overflow pre-existing pada kartu promo dashboard direct (dibuktikan pada
    // Stage R2.4) dikeluarkan dari antrean — test ini menguji navigasi, bukan
    // layout dashboard.
    final pending = tester.takeException();
    if (pending != null) {
      expect(
        pending.toString(),
        contains('overflowed'),
        reason: 'hanya overflow pre-existing yang boleh diabaikan',
      );
    }

    // Menyentuh kartu layanan pada grid, bukan teks lain dengan label sama.
    final tile = find
        .descendant(of: find.byType(GridView), matching: find.text('Pulsa'))
        .first;
    await tester.ensureVisible(tile);
    await settleFrames(tester);
    await tester.tap(tile);
    await settleFrames(tester);

    expect(find.byType(PpobHomeScreen), findsOneWidget);
    expect(find.text('Saldo PPOB & Benefit'), findsOneWidget);
    expect(find.text('Pulsa Telkomsel 10.000'), findsOneWidget);

    // Flush Future.delayed animasi entrance tile dashboard yang masih pending
    // agar invariant binding (nol timer tersisa) terpenuhi saat tree dibongkar.
    await tester.pump(const Duration(seconds: 2));
  }, skip: !tapGoIsDirectDistribution);
}
