import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Perbaikan tampilan dari uji HP 2.0.4+31: tanpa tombol cari, ikon Ubah
/// Password satu gaya dengan menu lain, latar terang tidak lagi hampir putih,
/// dan kartu Aktivitas ringkas serta mengikuti tema gelap.
Future<void> pumpDashboard(WidgetTester tester,
    {Brightness? brightness}) async {
  tapGoDisablePersistenceForTests = true;
  tapGoDashboardVisualFixtureEnabledForTests = true;
  addTearDown(() {
    tapGoDashboardVisualFixtureEnabledForTests = false;
    tapGoDisablePersistenceForTests = false;
  });
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        theme: tapGoReadableTheme(brightness: brightness ?? Brightness.light),
        home: const TapGoDashboard(),
      ),
    ),
  );
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  testWidgets('beranda tidak lagi punya kolom atau tombol cari',
      (tester) async {
    await pumpDashboard(tester);
    expect(find.text('Cari layanan TapGo'), findsNothing);
    expect(find.byIcon(Icons.search_rounded), findsNothing);
  });

  test('Ubah Password memakai ilustrasi yang sama gayanya dengan menu Akun',
      () {
    expect(PremiumTapGoIcon.assetFor('Ubah Password'),
        'assets/icons/basic_portal/change_password.png');
    expect(PremiumTapGoIcon.assetFor('Profil'), isNotNull);
  });

  test('latar terang lebih pekat dari kartu putih dan teks sekunder terbaca',
      () {
    final light = tapGoReadableTheme();
    expect(light.scaffoldBackgroundColor, isNot(const Color(0xFFF4F8FB)));
    // Kartu putih harus terlihat berbeda dari latar.
    expect(light.scaffoldBackgroundColor.computeLuminance(),
        lessThan(Colors.white.computeLuminance() - 0.05));
    // Teks sekunder: kontras minimal 4:1 terhadap latar.
    double ratio(Color a, Color b) {
      final l1 = a.computeLuminance() + 0.05;
      final l2 = b.computeLuminance() + 0.05;
      return l1 > l2 ? l1 / l2 : l2 / l1;
    }

    expect(
        ratio(
            light.colorScheme.onSurfaceVariant, light.scaffoldBackgroundColor),
        greaterThan(4.0));
  });

  group('kartu Aktivitas', () {
    setUp(() => tapGoDisablePersistenceForTests = true);
    tearDown(() {
      tapGoSetHttpAdapterForTests(null);
      tapGoDisablePersistenceForTests = false;
    });

    Future<void> openActivity(
        WidgetTester tester, Brightness brightness) async {
      tapGoSetHttpAdapterForTests(FakeApi({
        'GET /ppob/orders': (_) => FakeReply.ok({
              'items': [
                {
                  'id': 'o1',
                  'status': 'SUCCESS',
                  'sku': 'TSEL-10',
                  'productName': 'Telkomsel 10.000',
                  'categoryCode': 'PULSA',
                  'targetNumber': '081234567890',
                  'amount': '10500.00',
                  'benefitAmount': '0.00',
                  'balanceAmount': '10500.00',
                  'createdAt': '2026-09-20T10:00:00Z',
                }
              ],
            }),
        'GET /rides': (_) => FakeReply.ok([]),
        'GET /wallet/transactions': (_) => FakeReply.ok([]),
      }));
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            tapGoSessionProviderForTest.overrideWith(
              (ref) => DemoClientSession.initial().copyWith(
                accessToken: 'token-uji',
                isDemoMode: false,
              ),
            ),
          ],
          child: MaterialApp(
            theme: tapGoReadableTheme(brightness: brightness),
            home: const Scaffold(body: ActivityScreen()),
          ),
        ),
      );
      for (var i = 0; i < 15; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    testWidgets('ringkas: judul dan satu baris keterangan, tanpa nomor tujuan',
        (tester) async {
      await openActivity(tester, Brightness.light);
      expect(find.text('Telkomsel 10.000'), findsOneWidget);
      expect(find.textContaining('Berhasil'), findsOneWidget);
      expect(find.textContaining('081234567890'), findsNothing);
      final tile = tester.getSize(find
          .ancestor(
            of: find.text('Telkomsel 10.000'),
            matching: find.byType(Container),
          )
          .first);
      expect(tile.height, lessThan(80));
    });

    testWidgets('tema gelap: kartu memakai warna permukaan, bukan putih',
        (tester) async {
      await openActivity(tester, Brightness.dark);
      final container = tester.widget<Container>(find
          .ancestor(
            of: find.text('Telkomsel 10.000'),
            matching: find.byType(Container),
          )
          .first);
      final decoration = container.decoration! as BoxDecoration;
      expect(decoration.color, isNot(Colors.white));
      expect(decoration.color,
          tapGoReadableTheme(brightness: Brightness.dark).colorScheme.surface);
    });
  });

  testWidgets(
      'kebijakan privasi: menjelaskan notifikasi dan tidak mengaku mengumpulkan KTP',
      (tester) async {
    await pumpDashboard(tester);
    await tester.tap(find.text('Akun').last);
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.ensureVisible(find.text('Kebijakan Privasi'));
    await tester.tap(find.text('Kebijakan Privasi'));
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.textContaining('NOTIFIKASI'), findsOneWidget);
    expect(find.textContaining('Firebase Cloud Messaging'), findsOneWidget);
    expect(find.textContaining('Token dihapus dari akun saat Anda keluar'),
        findsOneWidget);
    expect(find.textContaining('Aplikasi Android tidak mengumpulkan KTP'),
        findsOneWidget);
    // Klaim lama yang tidak sesuai kenyataan aplikasi.
    expect(find.textContaining('foto KTP jika digunakan'), findsNothing);
    expect(find.textContaining('nomor KTP jika digunakan'), findsNothing);
  });
}
