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
  required double height,
  double textScale = 1.0,
  Brightness brightness = Brightness.light,
  bool fixture = false,
}) async {
  tapGoDisablePersistenceForTests = true;
  tapGoDashboardVisualFixtureEnabledForTests = fixture;
  addTearDown(() => tapGoDashboardVisualFixtureEnabledForTests = false);

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

  tester.view.physicalSize = Size(width * 3, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        theme: tapGoReadableTheme(brightness: brightness),
        home: MediaQuery(
          data: MediaQueryData(
            size: Size(width, height),
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
    for (final viewport in const <(double, double)>[
      (320, 640),
      (360, 800),
      (412, 915),
    ]) {
      testWidgets('${viewport.$1.toInt()}x${viewport.$2.toInt()} dp bersih',
          (tester) async {
        final overflows = await renderDashboard(
          tester,
          width: viewport.$1,
          height: viewport.$2,
        );
        expect(overflows, isEmpty);
      });
    }

    testWidgets('320 dp dengan text scale 1.8 bersih', (tester) async {
      final overflows = await renderDashboard(
        tester,
        width: 320,
        height: 640,
        textScale: 1.8,
      );
      expect(overflows, isEmpty);
    });

    testWidgets('320 dp tema gelap bersih', (tester) async {
      final overflows = await renderDashboard(
        tester,
        width: 320,
        height: 640,
        brightness: Brightness.dark,
      );
      expect(overflows, isEmpty);
    });

    testWidgets('320 dp dengan fixture visual bersih', (tester) async {
      final overflows = await renderDashboard(
        tester,
        width: 320,
        height: 640,
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
        height: 915,
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
      final overflows = await renderDashboard(tester, width: 320, height: 640);
      expect(overflows, isEmpty);
      expect(serviceTile('Motor'), findsOneWidget);

      await tapTile(tester, 'Motor');
      final gate = tester.widget<RideEntryScreen>(find.byType(RideEntryScreen));
      expect(gate.service, RideServiceKind.motorcycle);
    });

    testWidgets('Mobil terlihat dan dapat ditap pada 320 dp', (tester) async {
      final overflows = await renderDashboard(tester, width: 320, height: 640);
      expect(overflows, isEmpty);
      expect(serviceTile('Mobil'), findsOneWidget);

      await tapTile(tester, 'Mobil');
      final gate = tester.widget<RideEntryScreen>(find.byType(RideEntryScreen));
      expect(gate.service, RideServiceKind.car);
    });

    testWidgets('label kartu layanan tidak dihapus pada 320 dp', (
      tester,
    ) async {
      await renderDashboard(tester, width: 320, height: 640);
      for (final label in const [
        'Motor',
        'Mobil',
        'Kartu Anggota',
      ]) {
        expect(serviceTile(label), findsOneWidget, reason: 'hilang: $label');
      }
    });
  });

  group('tap target minimum', () {
    testWidgets('kartu layanan minimal 48 dp pada 320 dp', (tester) async {
      await renderDashboard(tester, width: 320, height: 640);
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
      await renderDashboard(tester, width: 320, height: 640);
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

  group('kartu saldo PPOB menggantikan kartu Paket aktif pada Play', () {
    testWidgets('kartu saldo PPOB tampil, kartu Paket aktif sudah hilang', (
      tester,
    ) async {
      await renderDashboard(tester, width: 360, height: 800, fixture: true);
      // Permintaan Owner: kartu "Paket aktif: Basic" dihapus dari Beranda
      // Play (Akun sudah menampilkan tier & status, kartu ini cuma
      // mengulanginya) dan digantikan kartu saldo PPOB yang lebih berguna.
      expect(find.text('Saldo PPOB'), findsOneWidget);
      expect(find.text('Buka PPOB'), findsOneWidget);
      expect(find.textContaining('Paket aktif:'), findsNothing);
      expect(find.text('Detail Basic'), findsNothing);
      // Baris Referral/Mitra tetap TIDAK boleh muncul pada Play.
      expect(find.text('Referral Saya'), findsNothing);
      expect(find.text('Mitra Saya'), findsNothing);
    });

    testWidgets('card Membership biru sudah dihapus dari Beranda', (
      tester,
    ) async {
      await renderDashboard(tester, width: 360, height: 800, fixture: true);
      // Akun (_AccountHero) sudah menampilkan tier & status; kartu ini dulu
      // mengulang info yang sama di Beranda, jadi dihapus atas permintaan
      // Owner. Kartu wallet TapGoPay menempati slot yang sama sekarang.
      expect(find.text('Memuat membership'), findsNothing);
      expect(find.text('Klik untuk detail'), findsNothing);
      expect(find.text('Klik untuk riwayat'), findsOneWidget);
      expect(find.text('TapGoPay'), findsOneWidget);
    });

    testWidgets(
      'tap kartu saldo membuka Kartu Anggota (tidak ada layar wallet terpisah)',
      (tester) async {
        await renderDashboard(tester, width: 360, height: 800, fixture: true);
        // Pada viewport nyata kartu bisa berada di bawah lipatan atau tertutup
        // bottom navigation, jadi digulir dulu seperti pengguna.
        await tester.ensureVisible(find.text('Klik untuk riwayat'));
        for (var index = 0; index < 8; index += 1) {
          await tester.pump(const Duration(milliseconds: 80));
        }
        await tester.tap(find.text('Klik untuk riwayat'));
        for (var index = 0; index < 14; index += 1) {
          await tester.pump(const Duration(milliseconds: 80));
        }
        // Tidak ada layar wallet terpisah: kartu saldo membuka Kartu Anggota.
        expect(find.byType(BasicMemberCardScreen), findsOneWidget);
      },
    );

    testWidgets('status Basic pada header akun tetap tampil', (tester) async {
      await renderDashboard(tester, width: 360, height: 800, fixture: true);
      // Chip Basic pada header, tidak lagi bergantung pada kartu Membership.
      expect(find.text('Basic'), findsWidgets);
      expect(find.textContaining('Halo,'), findsOneWidget);
    });

    testWidgets('tidak ada ruang kosong berlebih menuju grid layanan', (
      tester,
    ) async {
      await renderDashboard(tester, width: 360, height: 800, fixture: true);
      // Kartu saldo PPOB (_PpobBalanceCard, tombol "Buka PPOB" adalah elemen
      // terakhirnya) sekarang langsung diikuti grid layanan — jaraknya hanya
      // SizedBox(height: 22) di dashboard_screen.dart, jadi seharusnya jauh
      // lebih kecil daripada tinggi satu kartu penuh.
      final gridTop = tester.getRect(find.byType(GridView)).top;
      final cardBottom = tester.getRect(find.text('Buka PPOB')).bottom;
      final gap = gridTop - cardBottom;
      expect(
        gap,
        lessThan(140),
        reason: 'jarak menuju grid layanan tidak boleh menyisakan ruang kosong',
      );
    });
  });

  group('viewport Android nyata', () {
    testWidgets('dashboard dapat digulir pada 320x640', (tester) async {
      await renderDashboard(tester, width: 320, height: 640, fixture: true);
      final position =
          tester.state<ScrollableState>(find.byType(Scrollable).first).position;

      // Konten memang lebih tinggi daripada viewport, jadi dashboard nyata
      // memang perlu digulir.
      expect(position.maxScrollExtent, greaterThan(0));
      expect(position.viewportDimension, closeTo(640, 1));
      expect(position.pixels, 0);

      await tester.drag(
        find.byType(SingleChildScrollView).first,
        const Offset(0, -400),
      );
      for (var index = 0; index < 10; index += 1) {
        await tester.pump(const Duration(milliseconds: 80));
      }
      expect(position.pixels, greaterThan(0));
    });

    testWidgets('bottom navigation tetap terlihat pada viewport', (
      tester,
    ) async {
      for (final viewport in const <(double, double)>[
        (320, 640),
        (360, 800),
        (412, 915),
      ]) {
        await renderDashboard(
          tester,
          width: viewport.$1,
          height: viewport.$2,
          fixture: true,
        );
        for (final label in const ['Beranda', 'Aktivitas', 'Chat', 'Akun']) {
          final rect = tester.getRect(find.text(label));
          expect(
            rect.bottom,
            lessThanOrEqualTo(viewport.$2),
            reason: '$label keluar viewport ${viewport.$1}x${viewport.$2}',
          );
        }
      }
    });

    testWidgets('text scale 1.8 dapat digulir tanpa overflow', (tester) async {
      final overflows = await renderDashboard(
        tester,
        width: 320,
        height: 640,
        textScale: 1.8,
        fixture: true,
      );
      expect(overflows, isEmpty);

      final position =
          tester.state<ScrollableState>(find.byType(Scrollable).first).position;
      expect(position.maxScrollExtent, greaterThan(0));
      await tester.drag(
        find.byType(SingleChildScrollView).first,
        const Offset(0, -500),
      );
      for (var index = 0; index < 10; index += 1) {
        await tester.pump(const Duration(milliseconds: 80));
      }
      expect(position.pixels, greaterThan(0));
    });

    testWidgets('tema gelap tetap terbaca pada 320x640', (tester) async {
      final overflows = await renderDashboard(
        tester,
        width: 320,
        height: 640,
        brightness: Brightness.dark,
        fixture: true,
      );
      expect(overflows, isEmpty);
      expect(find.text('TapGoPay'), findsOneWidget);
      expect(find.text('Saldo PPOB'), findsOneWidget);
    });
  });
}
