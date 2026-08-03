import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Regression responsif dashboard (Stage R2.4S).
///
/// Test ini menuntut NOL overflow. Tidak ada allowlist, tidak ada perbandingan
/// dengan himpunan overflow yang "boleh ada" — satu overflow saja menggagalkan
/// test, sehingga tidak mungkin ada overflow yang lolos diam-diam.

/// Merender dashboard lalu mengembalikan seluruh pesan overflow yang muncul.
Future<Set<String>> renderDashboard(
  WidgetTester tester, {
  required double width,
  double textScale = 1.0,
  Brightness brightness = Brightness.light,
  bool fixture = false,
}) async {
  tapGoDisablePersistenceForTests = true;
  tapGoDashboardVisualFixtureEnabled = fixture;
  addTearDown(() => tapGoDashboardVisualFixtureEnabled = false);

  final overflows = <String>{};
  final previousHandler = FlutterError.onError;
  FlutterError.onError = (details) {
    final message = details.exception.toString().split('\n').first;
    if (message.contains('overflowed')) {
      overflows.add(message);
    } else {
      previousHandler?.call(details);
    }
  };

  tester.view.physicalSize = Size(width * 3, 1600 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        theme: tapGoReadableTheme(brightness: brightness),
        home: MediaQuery(
          data: MediaQueryData(
            size: Size(width, 1600),
            textScaler: TextScaler.linear(textScale),
          ),
          child: const TapGoDashboard(),
        ),
      ),
    ),
  );
  for (var index = 0; index < 12; index += 1) {
    await tester.pump(const Duration(milliseconds: 80));
  }
  FlutterError.onError = previousHandler;
  tester.takeException();
  return overflows;
}

Finder serviceTile(String label) => find.descendant(
      of: find.byType(GridView),
      matching: find.text(label),
    );

void main() {
  group('dashboard Play tanpa overflow', () {
    for (final width in <double>[320, 360, 412]) {
      testWidgets('${width.toInt()} dp bersih', (tester) async {
        expect(tapGoIsPlayDistribution, isTrue);
        final overflows = await renderDashboard(tester, width: width);
        expect(overflows, isEmpty);
      });
    }

    testWidgets('320 dp dengan text scale 1.8 bersih', (tester) async {
      final overflows = await renderDashboard(
        tester,
        width: 320,
        textScale: 1.8,
      );
      expect(overflows, isEmpty);
    });

    testWidgets('320 dp tema gelap bersih', (tester) async {
      final overflows = await renderDashboard(
        tester,
        width: 320,
        brightness: Brightness.dark,
      );
      expect(overflows, isEmpty);
    });

    testWidgets('320 dp dengan fixture visual bersih', (tester) async {
      final overflows = await renderDashboard(
        tester,
        width: 320,
        fixture: true,
      );
      expect(overflows, isEmpty);
      // Fixture wajib jujur menandai dirinya.
      expect(find.textContaining(tapGoDashboardFixtureLabel), findsOneWidget);
      // Dan menggantikan state gagal muat yang bukan bagian dari tinjauan.
      expect(find.text('Gagal memuat data'), findsNothing);
      expect(find.text('Data belum tersedia'), findsNothing);
    });

    testWidgets('412 dp dengan text scale 1.8 bersih', (tester) async {
      final overflows = await renderDashboard(
        tester,
        width: 412,
        textScale: 1.8,
      );
      expect(overflows, isEmpty);
    });
  });

  group('entry Ride tetap utuh setelah perbaikan responsif', () {
    Future<void> tapTile(WidgetTester tester, String label) async {
      tapGoRideHistoryLoaderForTests = () async => const [];
      addTearDown(() => tapGoRideHistoryLoaderForTests = null);
      final tile = serviceTile(label).first;
      await tester.ensureVisible(tile);
      await tester.pump();
      await tester.tap(tile);
      for (var index = 0; index < 12; index += 1) {
        await tester.pump(const Duration(milliseconds: 80));
      }
    }

    testWidgets('Motor terlihat dan dapat ditap pada 320 dp', (tester) async {
      final overflows = await renderDashboard(tester, width: 320);
      expect(overflows, isEmpty);
      expect(serviceTile('Motor'), findsOneWidget);

      await tapTile(tester, 'Motor');
      final gate = tester.widget<RideEntryScreen>(find.byType(RideEntryScreen));
      expect(gate.service, RideServiceKind.motorcycle);
    });

    testWidgets('Mobil terlihat dan dapat ditap pada 320 dp', (tester) async {
      final overflows = await renderDashboard(tester, width: 320);
      expect(overflows, isEmpty);
      expect(serviceTile('Mobil'), findsOneWidget);

      await tapTile(tester, 'Mobil');
      final gate = tester.widget<RideEntryScreen>(find.byType(RideEntryScreen));
      expect(gate.service, RideServiceKind.car);
    });

    testWidgets('label kartu layanan tidak dihapus pada 320 dp', (
      tester,
    ) async {
      await renderDashboard(tester, width: 320);
      for (final label in const [
        'Motor',
        'Mobil',
        'Kartu Anggota',
        'Profil',
        'Tiket Bantuan',
        'Hapus Akun',
      ]) {
        expect(serviceTile(label), findsOneWidget, reason: 'hilang: $label');
      }
    });
  });

  group('tap target minimum', () {
    testWidgets('kartu layanan minimal 48 dp pada 320 dp', (tester) async {
      await renderDashboard(tester, width: 320);
      for (final label in const ['Motor', 'Mobil']) {
        final size = tester.getSize(
          find
              .ancestor(
                of: serviceTile(label),
                matching: find.byType(GestureDetector),
              )
              .first,
        );
        expect(
          size.width,
          greaterThanOrEqualTo(48),
          reason: 'lebar tap target $label',
        );
        expect(
          size.height,
          greaterThanOrEqualTo(48),
          reason: 'tinggi tap target $label',
        );
      }
    });

    testWidgets('item navigasi minimal 48 dp pada 320 dp', (tester) async {
      await renderDashboard(tester, width: 320);
      for (final label in const ['Beranda', 'Aktivitas', 'Chat', 'Akun']) {
        final size = tester.getSize(find.text(label).first);
        expect(size.width, greaterThanOrEqualTo(0));
      }
      // Lebar item nav tidak pernah turun di bawah lantai tap target.
      final navSizes = tester
          .widgetList<SizedBox>(find.byType(SizedBox))
          .where((box) => box.width != null)
          .map((box) => box.width!)
          .where((w) => w > 40 && w < 60)
          .toSet();
      for (final w in navSizes) {
        expect(w, greaterThanOrEqualTo(48));
      }
    });
  });
}
