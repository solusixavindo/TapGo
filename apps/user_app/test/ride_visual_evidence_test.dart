import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Harness bukti visual Stage R2.4.
///
/// Setiap gambar dirender dari widget Flutter yang sama dengan yang dipakai
/// aplikasi — bukan mockup HTML dan bukan emulator. Font asli Roboto dan
/// MaterialIcons dimuat dari Flutter SDK supaya teks benar-benar terbaca;
/// tanpa itu `flutter test` menggambar teks sebagai kotak.
///
/// Harness ini TIDAK berjalan pada `flutter test` biasa. Jalankan eksplisit:
///
///   flutter test test/ride_visual_evidence_test.dart \
///     --dart-define=TAPGO_RIDE_DEMO_MODE=true \
///     --dart-define=TAPGO_RIDE_VISUAL=true \
///     --update-goldens
///
/// Alasan dijaga: perbandingan golden bergantung pada platform dan versi font,
/// sehingga menjalankannya otomatis akan membuat suite rapuh di mesin lain.

const bool _visualEnabled = bool.fromEnvironment('TAPGO_RIDE_VISUAL');

/// Path untuk `matchesGoldenFile`, yang diselesaikan relatif terhadap FILE test.
const String _outputDir = '../../../docs/release-2/visual-review/'
    'r2.4-customer-ride';

/// Path yang sama untuk akses filesystem, yang diselesaikan relatif terhadap
/// CWD proses test (apps/user_app) — bukan relatif terhadap file test.
const String _outputDirFromCwd = '../../docs/release-2/visual-review/'
    'r2.4-customer-ride';

/// Memuat font asli dari Flutter SDK yang sedang dipakai.
///
/// Path diambil dari FLUTTER_ROOT, bukan ditulis keras, supaya harness tetap
/// jalan di mesin lain.
Future<bool> loadRealFonts() async {
  final root = Platform.environment['FLUTTER_ROOT'];
  if (root == null || root.isEmpty) {
    return false;
  }
  final fontDir = Directory('$root/bin/cache/artifacts/material_fonts');
  if (!fontDir.existsSync()) {
    return false;
  }

  Future<void> load(String family, List<String> files) async {
    final loader = FontLoader(family);
    for (final file in files) {
      final handle = File('${fontDir.path}/$file');
      if (!handle.existsSync()) {
        continue;
      }
      loader.addFont(
        Future<ByteData>.value(
          ByteData.sublistView(handle.readAsBytesSync()),
        ),
      );
    }
    await loader.load();
  }

  await load('Roboto', const [
    'Roboto-Regular.ttf',
    'Roboto-Medium.ttf',
    'Roboto-Bold.ttf',
    'Roboto-Black.ttf',
  ]);
  await load('MaterialIcons', const ['MaterialIcons-Regular.otf']);
  return true;
}

Map<String, dynamic> orderPayload({
  required String status,
  bool isFinal = false,
  Map<String, dynamic>? driver,
  Map<String, dynamic>? vehicle,
  Map<String, dynamic>? cancellation,
  String reference = 'RID-A2B3C4D5E6',
  int totalFare = 18500,
}) {
  return {
    'reference': reference,
    'serviceType': 'MOTORCYCLE',
    'status': status,
    'isFinal': isFinal,
    'pickupAddress': 'LOKASI_DEMO_A — Titik Uji Utara',
    'dropoffAddress': 'LOKASI_DEMO_B — Titik Uji Tengah',
    'distanceMeters': 4200,
    'durationSeconds': 900,
    'fare': {'totalFare': totalFare, 'currency': 'IDR'},
    'payment': const {'method': 'CASH', 'state': 'PENDING'},
    'cancellation': cancellation,
    'timeline': const {},
    'driver': driver,
    'vehicle': vehicle,
    'createdAt': '2026-08-03T02:15:00.000Z',
  };
}

Map<String, dynamic> quotePayload() {
  return {
    'quoteId': 'quote-demo-1',
    'serviceType': 'MOTORCYCLE',
    'distanceMeters': 4200,
    'durationSeconds': 900,
    'etaSeconds': 300,
    'fare': const {
      'baseFare': 5000,
      'distanceFare': 12000,
      'serviceFee': 1500,
      'subtotalFare': 17000,
      'totalFare': 18500,
      'currency': 'IDR',
    },
    // Jauh di masa depan supaya kartu estimasi tidak tampil kedaluwarsa.
    'expiresAt': '2099-01-01T00:00:00.000Z',
  };
}

const _driver = {'displayName': 'Budi'};
const _vehicle = {
  'serviceType': 'MOTORCYCLE',
  'model': 'Vario 160',
  'color': 'Hitam',
  'maskedPlate': 'B 12•• XYZ',
};

void main() {
  late bool fontsReady;

  setUpAll(() async {
    tapGoDisablePersistenceForTests = true;
    fontsReady = await loadRealFonts();
  });

  Future<void> shoot(
    WidgetTester tester,
    String name, {
    required Widget child,
    double width = 390,
    double height = 844,
    ThemeMode themeMode = ThemeMode.light,
    TextScaler textScaler = TextScaler.noScaling,
    Future<void> Function(WidgetTester tester)? interact,
    Future<void> Function(WidgetTester tester)? beforeCapture,
  }) async {
    expect(
      fontsReady,
      isTrue,
      reason: 'font asli tidak ditemukan; screenshot akan menampilkan kotak',
    );

    tester.view.physicalSize = Size(width * 3, height * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          themeMode: themeMode,
          // Tema aplikasi yang sesungguhnya, supaya warna, tipografi, dan
          // token pada tangkapan layar sama dengan yang dilihat pengguna.
          theme: tapGoReadableTheme(),
          darkTheme: tapGoReadableTheme(brightness: Brightness.dark),
          home: MediaQuery(
            data: MediaQueryData(
                textScaler: textScaler, size: Size(width, height)),
            child: child,
          ),
        ),
      ),
    );
    for (var index = 0; index < 12; index += 1) {
      await tester.pump(const Duration(milliseconds: 80));
    }
    if (interact != null) {
      await interact(tester);
    }
    if (beforeCapture != null) {
      await beforeCapture(tester);
    }

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('$_outputDir/$name.png'),
    );
  }

  /// Menegaskan tangkapan layar bebas overflow, bukan sekadar terlihat rapi.
  Future<void> Function(WidgetTester) expectNoOverflow() {
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
    return (tester) async {
      FlutterError.onError = previousHandler;
      tester.takeException();
      expect(overflows, isEmpty,
          reason: 'tangkapan layar harus bebas overflow');
    };
  }

  Future<void> pickRouteAndQuote(WidgetTester tester) async {
    for (final label in const ['LOKASI_DEMO_A', 'LOKASI_DEMO_B']) {
      final finder = label == 'LOKASI_DEMO_A'
          ? find.text(label).first
          : find.text(label).last;
      await tester.ensureVisible(finder);
      await tester.pump();
      await tester.tap(finder);
      await tester.pump();
    }
    final button = find.text('Cek Harga');
    await tester.ensureVisible(button);
    await tester.pump();
    await tester.tap(button);
    for (var index = 0; index < 10; index += 1) {
      await tester.pump(const Duration(milliseconds: 80));
    }
  }

  Widget bookingScreen({
    RideServiceKind service = RideServiceKind.motorcycle,
    LocationSelectionPort? port,
  }) {
    return RideBookingScreen(
      initialService: service,
      locationPort: port,
      quoteRequest: ({
        required serviceType,
        required pickup,
        required dropoff,
      }) async =>
          quotePayload(),
      orderRequest: ({required quoteId, idempotencyKey}) async =>
          orderPayload(status: 'SEARCHING_DRIVER'),
      detailRequest: (_) async => orderPayload(status: 'SEARCHING_DRIVER'),
    );
  }

  Widget statusScreen(Map<String, dynamic> payload) {
    return RideStatusScreen(
      reference: '${payload['reference']}',
      autoStart: false,
      initialOrder: RideOrderView.fromJson(payload),
    );
  }

  group('bukti visual r2.4', () {
    testWidgets('00 dashboard Play dengan entry Motor dan Mobil', (
      tester,
    ) async {
      // Artefak ini hanya dapat dihasilkan pada distribusi Play, sehingga
      // gambarnya tidak mungkin berasal dari varian direct.
      expect(tapGoIsPlayDistribution, isTrue);
      tapGoRideHistoryLoaderForTests = () async => const [];
      addTearDown(() => tapGoRideHistoryLoaderForTests = null);
      // Fixture deterministik: tangkapan layar menampilkan data contoh yang
      // stabil, bukan state gagal muat karena test tidak punya backend.
      tapGoDashboardVisualFixtureEnabled = true;
      addTearDown(() => tapGoDashboardVisualFixtureEnabled = false);

      final overflows = <String>{};
      final previousHandler = FlutterError.onError;
      FlutterError.onError =
          (details) => overflows.add(details.exception.toString());

      await shoot(
        tester,
        '00_play_dashboard_motor_mobil',
        height: 1500,
        child: const TapGoDashboard(),
        beforeCapture: (tester) async {
          // SvgPicture.asset memuat aset secara asinkron. Tanpa runAsync,
          // sebagian ilustrasi belum selesai dimuat saat gambar diambil dan
          // kartunya tampak tanpa ikon — itu artefak harness, bukan cacat UI.
          for (var round = 0; round < 5; round += 1) {
            await tester.runAsync(
              () => Future<void>.delayed(const Duration(milliseconds: 120)),
            );
            for (var frame = 0; frame < 6; frame += 1) {
              await tester.pump(const Duration(milliseconds: 80));
            }
          }
          FlutterError.onError = previousHandler;
          tester.takeException();
          // Bukti kejujuran: entry benar-benar ada di grid, dan tidak ada
          // overflow apa pun pada lebar ini.
          final grid = find.byType(GridView);
          expect(
            find.descendant(of: grid, matching: find.text('Motor')),
            findsOneWidget,
          );
          expect(
            find.descendant(of: grid, matching: find.text('Mobil')),
            findsOneWidget,
          );
          expect(overflows, isEmpty, reason: 'screenshot harus bebas overflow');
          // Fixture wajib menandai dirinya, dan state gagal muat tidak boleh
          // ikut terpotret.
          expect(
            find.textContaining(tapGoDashboardFixtureLabel),
            findsOneWidget,
          );
          expect(find.text('Gagal memuat data'), findsNothing);
          expect(find.text('Data belum tersedia'), findsNothing);
        },
      );
    });

    testWidgets('01 pemilihan layanan', (tester) async {
      await shoot(tester, '01_service_selection', child: bookingScreen());
    });

    testWidgets('02 lokasi demo terpilih', (tester) async {
      await shoot(
        tester,
        '02_demo_location',
        child: bookingScreen(),
        interact: (tester) async {
          for (final label in const ['LOKASI_DEMO_A', 'LOKASI_DEMO_B']) {
            final finder = label == 'LOKASI_DEMO_A'
                ? find.text(label).first
                : find.text(label).last;
            await tester.ensureVisible(finder);
            await tester.pump();
            await tester.tap(finder);
            await tester.pump();
          }
        },
      );
    });

    testWidgets('03 estimasi tarif', (tester) async {
      await shoot(
        tester,
        '03_quote',
        child: bookingScreen(),
        height: 1200,
        interact: pickRouteAndQuote,
      );
    });

    testWidgets('04 konfirmasi pemesanan', (tester) async {
      await shoot(
        tester,
        '04_order_confirmation',
        child: bookingScreen(),
        height: 900,
        interact: (tester) async {
          await pickRouteAndQuote(tester);
          // Menggulirkan sampai tombol konfirmasi terlihat.
          final confirm = find.text('Pesan Sekarang');
          await tester.ensureVisible(confirm);
          for (var index = 0; index < 8; index += 1) {
            await tester.pump(const Duration(milliseconds: 80));
          }
        },
      );
    });

    testWidgets('05 mencari driver', (tester) async {
      await shoot(
        tester,
        '05_searching_driver',
        child: statusScreen(orderPayload(status: 'SEARCHING_DRIVER')),
      );
    });

    testWidgets('06 driver ditugaskan', (tester) async {
      await shoot(
        tester,
        '06_driver_assigned',
        child: statusScreen(
          orderPayload(
            status: 'DRIVER_ASSIGNED',
            driver: _driver,
            vehicle: _vehicle,
          ),
        ),
      );
    });

    testWidgets('07 driver tiba', (tester) async {
      await shoot(
        tester,
        '07_driver_arrived',
        child: statusScreen(
          orderPayload(
            status: 'DRIVER_ARRIVED',
            driver: _driver,
            vehicle: _vehicle,
          ),
        ),
      );
    });

    testWidgets('08 perjalanan berlangsung', (tester) async {
      await shoot(
        tester,
        '08_in_trip',
        child: statusScreen(
          orderPayload(status: 'IN_TRIP', driver: _driver, vehicle: _vehicle),
        ),
      );
    });

    testWidgets('09 perjalanan selesai', (tester) async {
      await shoot(
        tester,
        '09_completed',
        child: statusScreen(
          orderPayload(
            status: 'COMPLETED',
            isFinal: true,
            driver: _driver,
            vehicle: _vehicle,
          ),
        ),
      );
    });

    testWidgets('10 perjalanan dibatalkan', (tester) async {
      await shoot(
        tester,
        '10_cancelled',
        child: statusScreen(
          orderPayload(
            status: 'CANCELLED_BY_PASSENGER',
            isFinal: true,
            totalFare: 0,
            cancellation: const {
              'reason': 'WAIT_TOO_LONG',
              'fee': 0,
              'at': '2026-08-03T02:20:00.000Z',
            },
          ),
        ),
      );
    });

    testWidgets('11 riwayat perjalanan', (tester) async {
      await shoot(
        tester,
        '11_history',
        child: RideHistoryScreen(
          historyRequest: () async => [
            orderPayload(
              status: 'COMPLETED',
              isFinal: true,
              driver: _driver,
              vehicle: _vehicle,
            ),
            orderPayload(
              status: 'CANCELLED_BY_PASSENGER',
              isFinal: true,
              reference: 'RID-Z9Y8X7W6V5',
              totalFare: 0,
            ),
            orderPayload(
              status: 'NO_DRIVER',
              isFinal: true,
              reference: 'RID-Q8R7S6T5U4',
              totalFare: 0,
            ),
          ],
        ),
      );
    });

    testWidgets('12 layanan lokasi belum tersedia', (tester) async {
      await shoot(
        tester,
        '12_provider_unavailable',
        // Inilah perilaku default produksi: fail closed tanpa provider.
        child: bookingScreen(port: const UnavailableLocationPort()),
      );
    });

    testWidgets('13 kegagalan jaringan', (tester) async {
      await shoot(
        tester,
        '13_network_error',
        child: RideStatusScreen(
          reference: 'RID-A2B3C4D5E6',
          pollInterval: const Duration(hours: 1),
          detailRequest: (_) async => throw DioLikeConnectionError(),
        ),
      );
    });

    testWidgets('14 tema gelap', (tester) async {
      await shoot(
        tester,
        '14_dark_theme',
        themeMode: ThemeMode.dark,
        child: statusScreen(
          orderPayload(
            status: 'DRIVER_ASSIGNED',
            driver: _driver,
            vehicle: _vehicle,
          ),
        ),
      );
    });

    testWidgets('15 lebar 320 dp', (tester) async {
      await shoot(
        tester,
        '15_width_320',
        width: 320,
        height: 900,
        beforeCapture: expectNoOverflow(),
        child: statusScreen(
          orderPayload(
            status: 'DRIVER_ARRIVED',
            driver: _driver,
            vehicle: _vehicle,
          ),
        ),
      );
    });

    testWidgets('16 lebar 412 dp', (tester) async {
      await shoot(
        tester,
        '16_width_412',
        width: 412,
        height: 900,
        child: statusScreen(
          orderPayload(
            status: 'DRIVER_ARRIVED',
            driver: _driver,
            vehicle: _vehicle,
          ),
        ),
      );
    });

    testWidgets('17 teks besar', (tester) async {
      await shoot(
        tester,
        '17_large_text',
        width: 390,
        height: 1100,
        textScaler: const TextScaler.linear(1.8),
        beforeCapture: expectNoOverflow(),
        child: statusScreen(
          orderPayload(
            status: 'DRIVER_ARRIVED',
            driver: _driver,
            vehicle: _vehicle,
          ),
        ),
      );
    });
    testWidgets('19 dashboard Play pada 320 dp', (tester) async {
      // Bukti langsung Stage R2.4S: lebar terkecil yang didukung, bebas
      // overflow, entry Motor dan Mobil tetap ada.
      expect(tapGoIsPlayDistribution, isTrue);
      tapGoRideHistoryLoaderForTests = () async => const [];
      addTearDown(() => tapGoRideHistoryLoaderForTests = null);
      tapGoDashboardVisualFixtureEnabled = true;
      addTearDown(() => tapGoDashboardVisualFixtureEnabled = false);

      final assertClean = expectNoOverflow();

      await shoot(
        tester,
        '19_play_dashboard_320dp',
        width: 320,
        height: 1500,
        child: const TapGoDashboard(),
        beforeCapture: (tester) async {
          for (var round = 0; round < 5; round += 1) {
            await tester.runAsync(
              () => Future<void>.delayed(const Duration(milliseconds: 120)),
            );
            for (var frame = 0; frame < 6; frame += 1) {
              await tester.pump(const Duration(milliseconds: 80));
            }
          }
          await assertClean(tester);
          final grid = find.byType(GridView);
          expect(
            find.descendant(of: grid, matching: find.text('Motor')),
            findsOneWidget,
          );
          expect(
            find.descendant(of: grid, matching: find.text('Mobil')),
            findsOneWidget,
          );
        },
      );
    });

    testWidgets('18 perjalanan aktif dipulihkan dari server', (tester) async {
      await shoot(
        tester,
        '18_active_ride_restored',
        child: RideEntryScreen(
          service: RideServiceKind.motorcycle,
          // Riwayat server memuat satu perjalanan berjalan, jadi gerbang
          // membuka kembali perjalanan itu alih-alih menawarkan pemesanan.
          historyRequest: () async => [
            orderPayload(
                status: 'COMPLETED',
                isFinal: true,
                reference: 'RID-OLD11AAAA1'),
            orderPayload(
                status: 'DRIVER_TO_PICKUP', reference: 'RID-RESTORED77'),
          ],
          detailRequest: (_) async => orderPayload(
            status: 'DRIVER_TO_PICKUP',
            reference: 'RID-RESTORED77',
            driver: _driver,
            vehicle: _vehicle,
          ),
        ),
        beforeCapture: (tester) async {
          expect(find.byType(RideStatusScreen), findsOneWidget);
          expect(find.byType(RideBookingScreen), findsNothing);
          expect(find.text('Kode perjalanan RID-RESTORED77'), findsOneWidget);
        },
      );
    });
  }, skip: !_visualEnabled);

  // Contact sheet dijalankan setelah seluruh tangkapan layar di atas ada,
  // karena isinya adalah gambar-gambar itu sendiri — bukan render ulang dan
  // bukan halaman HTML.
  group('contact sheet r2.4', () {
    testWidgets('menyusun seluruh tangkapan layar menjadi satu lembar', (
      tester,
    ) async {
      expect(fontsReady, isTrue);

      final directory = Directory(_outputDirFromCwd);
      final files = directory
          .listSync()
          .whereType<File>()
          .where((file) => file.path.endsWith('.png'))
          .where((file) => !file.path.contains('CONTACT_SHEET'))
          .toList()
        ..sort((a, b) => a.path.compareTo(b.path));

      // Sheet hanya bermakna bila seluruh 19 tangkapan layar memang ada.
      expect(
        files,
        hasLength(20),
        reason: 'jumlah tangkapan layar tidak sesuai: '
            '${files.map((f) => f.uri.pathSegments.last).toList()}',
      );

      final entries = files
          .map(
            (file) => _SheetEntry(
              caption: file.uri.pathSegments.last.replaceAll('.png', ''),
              bytes: file.readAsBytesSync(),
            ),
          )
          .toList();

      tester.view.physicalSize = const Size(2400, 1270);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: tapGoReadableTheme(),
          home: _RideContactSheet(entries: entries),
        ),
      );

      // Decoding PNG butuh I/O nyata, jadi dilakukan di dalam runAsync.
      await tester.runAsync(() async {
        for (final entry in entries) {
          await precacheImage(
            MemoryImage(entry.bytes),
            tester.element(find.byType(_RideContactSheet)),
          );
        }
      });
      await tester.pumpAndSettle();

      await expectLater(
        find.byType(_RideContactSheet),
        matchesGoldenFile('$_outputDir/R2_4_CUSTOMER_RIDE_CONTACT_SHEET.png'),
      );
    });
  }, skip: !_visualEnabled);
}

class _SheetEntry {
  const _SheetEntry({required this.caption, required this.bytes});

  final String caption;
  final Uint8List bytes;
}

/// Lembar tinjauan: seluruh tangkapan layar Ojek Online dalam satu gambar.
///
/// Isinya murni gambar hasil render widget Flutter yang sudah disimpan, jadi
/// tidak ada tampilan yang "dibuat ulang" khusus untuk lembar ini.
class _RideContactSheet extends StatelessWidget {
  const _RideContactSheet({required this.entries});

  final List<_SheetEntry> entries;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F8FB),
      body: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'TapGo Release 2 — Ojek Online penumpang (Stage R2.4R)',
              style: TextStyle(
                fontSize: 30,
                fontWeight: FontWeight.w900,
                color: Color(0xFF0B2239),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              '${entries.length} tangkapan layar dari widget Flutter nyata. '
              'Pembayaran tunai saja. Label DEMO DATA menandai lokasi sintetis.',
              style: const TextStyle(fontSize: 16, color: Color(0xFF54657A)),
            ),
            const SizedBox(height: 18),
            Wrap(
              spacing: 16,
              runSpacing: 16,
              children: entries
                  .map(
                    (entry) => SizedBox(
                      width: 208,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            height: 470,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: const Color(0xFFD7E2EC),
                              ),
                            ),
                            clipBehavior: Clip.antiAlias,
                            child: Image.memory(
                              entry.bytes,
                              fit: BoxFit.contain,
                              alignment: Alignment.topCenter,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            entry.caption,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF0B2239),
                            ),
                          ),
                        ],
                      ),
                    ),
                  )
                  .toList(),
            ),
          ],
        ),
      ),
    );
  }
}

/// Kegagalan koneksi tanpa bergantung pada tipe internal Dio di harness ini.
///
/// Dipetakan oleh `tapGoRideErrorMessage` ke kalimat umum, sehingga tangkapan
/// layar menunjukkan salinan yang benar-benar dilihat pengguna.
class DioLikeConnectionError implements Exception {
  @override
  String toString() => 'connection failure';
}
