import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/application/ppob_providers.dart';
import 'package:tapgo_user_app/features/ppob/data/ppob_demo_repository.dart';
import 'package:tapgo_user_app/features/ppob/data/ppob_repository.dart';
import 'package:tapgo_user_app/features/ppob/domain/ppob_models.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_category_screen.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_checkout_screen.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_history_screen.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_home_screen.dart';
import 'package:tapgo_user_app/main.dart';

/// Harness bukti visual Stage R2.7 — PPOB Foundation & Customer UI.
///
/// Setiap gambar dirender dari widget Flutter produksi dengan tema aplikasi
/// yang sesungguhnya dan font asli Flutter SDK (bukan kotak Ahem). Harness
/// ini TIDAK berjalan pada `flutter test` biasa. Jalankan eksplisit:
///
///   flutter test test/ppob_visual_evidence_test.dart \
///     --dart-define=TAPGO_PPOB_VISUAL=true \
///     --update-goldens
///
/// Sama seperti harness R2.4: golden bergantung platform/font sehingga tidak
/// dijalankan otomatis di CI.

const bool _visualEnabled = bool.fromEnvironment('TAPGO_PPOB_VISUAL');

/// Path untuk `matchesGoldenFile`, diselesaikan relatif terhadap FILE test.
const String _outputDir = '../../../docs/release-2/visual-review/r2.7-ppob';

/// Path yang sama untuk akses filesystem, relatif terhadap CWD proses test.
const String _outputDirFromCwd = '../../docs/release-2/visual-review/r2.7-ppob';

/// Memuat font asli dari Flutter SDK supaya teks benar-benar terbaca.
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

  await load('Roboto', [
    'Roboto-Regular.ttf',
    'Roboto-Medium.ttf',
    'Roboto-Bold.ttf',
  ]);
  await load('MaterialIcons', ['MaterialIcons-Regular.otf']);
  return true;
}

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
    required PpobRepository repository,
    double width = 390,
    double height = 844,
    ThemeMode themeMode = ThemeMode.light,
    TextScaler textScaler = TextScaler.noScaling,
    Future<void> Function(WidgetTester tester)? interact,
  }) async {
    expect(
      fontsReady,
      isTrue,
      reason: 'font asli tidak ditemukan; screenshot akan menampilkan kotak',
    );

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
    addTearDown(() => FlutterError.onError = previousHandler);

    tester.view.physicalSize = Size(width * 3, height * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [ppobRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          themeMode: themeMode,
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
      for (var index = 0; index < 12; index += 1) {
        await tester.pump(const Duration(milliseconds: 80));
      }
    }

    expect(overflows, isEmpty,
        reason: 'tangkapan layar harus bebas overflow');
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('$_outputDir/$name.png'),
    );
  }

  PpobProduct demoProduct(String sku) {
    return PpobDemoCatalog.products.firstWhere((product) => product.sku == sku);
  }

  PpobCategory demoCategory(String code) {
    return PpobDemoCatalog.categories
        .firstWhere((category) => category.code == code);
  }

  Future<void> fillAndInquiry(WidgetTester tester,
      [String target = '081234567890']) async {
    await tester.enterText(find.byType(TextFormField), target);
    await tester.pump();
    await tester.tap(find.text('Cek Harga'));
    for (var index = 0; index < 10; index += 1) {
      await tester.pump(const Duration(milliseconds: 60));
    }
  }

  group('bukti visual r2.7 ppob', () {
    testWidgets('01 beranda ppob — grid kategori', (tester) async {
      await shoot(
        tester,
        '01_ppob_home_catalog',
        repository: createDemoPpobRepository(),
        child: const PpobHomeScreen(),
      );
    });

    testWidgets('02 kategori pulsa — daftar nominal', (tester) async {
      await shoot(
        tester,
        '02_ppob_category_pulsa',
        repository: createDemoPpobRepository(),
        child: PpobCategoryScreen(category: demoCategory('PULSA')),
      );
    });

    testWidgets('03 checkout — form tujuan', (tester) async {
      await shoot(
        tester,
        '03_ppob_checkout_form',
        repository: createDemoPpobRepository(),
        child: PpobCheckoutScreen(
          categoryCode: 'PULSA',
          product: demoProduct('PULSA_10K'),
        ),
      );
    });

    testWidgets('04 checkout — rincian saldo gabungan', (tester) async {
      await shoot(
        tester,
        '04_ppob_checkout_breakdown',
        repository: createDemoPpobRepository(),
        child: PpobCheckoutScreen(
          categoryCode: 'PULSA',
          product: demoProduct('PULSA_10K'),
        ),
        interact: (tester) async {
          await fillAndInquiry(tester);
          await tester.drag(
              find.byType(ListView).first, const Offset(0, -260));
        },
      );
    });

    testWidgets('05 checkout — hasil refunded (fail-closed)', (tester) async {
      await shoot(
        tester,
        '05_ppob_checkout_result_refunded',
        repository: createDemoPpobRepository(),
        child: PpobCheckoutScreen(
          categoryCode: 'PULSA',
          product: demoProduct('PULSA_10K'),
        ),
        interact: (tester) async {
          await fillAndInquiry(tester);
          await tester.tap(find.text('Bayar Sekarang'));
          for (var index = 0; index < 10; index += 1) {
            await tester.pump(const Duration(milliseconds: 60));
          }
          await tester.drag(
              find.byType(ListView).first, const Offset(0, -420));
        },
      );
    });

    testWidgets('06 checkout — saldo tidak cukup', (tester) async {
      await shoot(
        tester,
        '06_ppob_checkout_insufficient',
        repository: createPpobVisualRepository(walletBalance: 1000),
        child: PpobCheckoutScreen(
          categoryCode: 'PULSA',
          product: demoProduct('PULSA_10K'),
        ),
        interact: (tester) async {
          await fillAndInquiry(tester);
          await tester.drag(
              find.byType(ListView).first, const Offset(0, -260));
        },
      );
    });

    testWidgets('07 riwayat — ada transaksi', (tester) async {
      final repository = createDemoPpobRepository();
      // Buat dua order demo agar riwayat terisi jujur (status REFUNDED).
      await repository.createOrder(
        sku: 'PULSA_10K',
        targetNumber: '081234567890',
        idempotencyKey: 'visual-1',
      );
      await repository.createOrder(
        sku: 'PLN_50K',
        targetNumber: '12345678901',
        idempotencyKey: 'visual-2',
      );
      await shoot(
        tester,
        '07_ppob_history',
        repository: repository,
        child: const PpobHistoryScreen(),
      );
    });

    testWidgets('08 riwayat — kosong', (tester) async {
      await shoot(
        tester,
        '08_ppob_history_empty',
        repository: createDemoPpobRepository(),
        child: const PpobHistoryScreen(),
      );
    });

    testWidgets('09 beranda — tema gelap', (tester) async {
      await shoot(
        tester,
        '09_ppob_home_dark',
        repository: createDemoPpobRepository(),
        themeMode: ThemeMode.dark,
        child: const PpobHomeScreen(),
      );
    });

    testWidgets('10 checkout gelap — rincian saldo gabungan', (tester) async {
      await shoot(
        tester,
        '10_ppob_checkout_breakdown_dark',
        repository: createDemoPpobRepository(),
        themeMode: ThemeMode.dark,
        child: PpobCheckoutScreen(
          categoryCode: 'PULSA',
          product: demoProduct('PULSA_10K'),
        ),
        interact: (tester) async {
          await fillAndInquiry(tester);
          await tester.drag(
              find.byType(ListView).first, const Offset(0, -260));
        },
      );
    });

    testWidgets('11 beranda — lebar 320 dp', (tester) async {
      await shoot(
        tester,
        '11_ppob_home_320dp',
        repository: createDemoPpobRepository(),
        width: 320,
        height: 640,
        child: const PpobHomeScreen(),
      );
    });

    testWidgets('12 checkout — lebar 320 dp dengan rincian', (tester) async {
      await shoot(
        tester,
        '12_ppob_checkout_320dp',
        repository: createDemoPpobRepository(),
        width: 320,
        height: 640,
        child: PpobCheckoutScreen(
          categoryCode: 'PULSA',
          product: demoProduct('PULSA_10K'),
        ),
        interact: (tester) async {
          await fillAndInquiry(tester);
          await tester.drag(
              find.byType(ListView).first, const Offset(0, -320));
        },
      );
    });

    testWidgets('13 katalog gagal — error + coba lagi', (tester) async {
      await shoot(
        tester,
        '13_ppob_home_error',
        repository: createPpobVisualRepository(
          catalogError: const PpobApiException(
            code: 'NETWORK_ERROR',
            message: 'down',
          ),
        ),
        child: const PpobHomeScreen(),
      );
    });
  }, skip: !_visualEnabled);

  group('contact sheet r2.7', () {
    testWidgets('menyusun seluruh tangkapan layar menjadi satu lembar',
        (tester) async {
      final dir = Directory(_outputDirFromCwd);
      final files = dir
          .listSync()
          .whereType<File>()
          .where((file) => file.path.endsWith('.png'))
          .toList()
        ..sort((a, b) => a.path.compareTo(b.path));
      expect(files, isNotEmpty,
          reason: 'jalankan grup bukti visual lebih dulu');

      final tiles = files.map((file) {
        final name = file.uri.pathSegments.last;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(name,
                style:
                    const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Image.file(file, width: 320),
          ],
        );
      }).toList();

      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: tapGoReadableTheme(),
          home: Scaffold(
            body: ListView(
              padding: const EdgeInsets.all(24),
              children: tiles,
            ),
          ),
        ),
      );
      await tester.pump(const Duration(seconds: 2));
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('$_outputDir/R2_7_PPOB_CONTACT_SHEET.png'),
      );
    });
  }, skip: !_visualEnabled);
}

/// Repository khusus harness visual: katalog demo + parameter saldo/error yang
/// dapat diatur untuk memotret state accepted/rejected.
PpobRepository createPpobVisualRepository({
  double walletBalance = 250000,
  PpobApiException? catalogError,
}) {
  final demo = createDemoPpobRepository();
  return PpobRepository(
    catalogRequest: () async {
      if (catalogError != null) {
        throw catalogError;
      }
      // Ambil katalog demo via API repository itu sendiri (tetap tanpa
      // jaringan): serialisasi tidak diperlukan — cukup kembalikan JSON mentah.
      final categories = await demo.fetchCatalog();
      return categories
          .map((category) => {
                'id': category.id,
                'code': category.code,
                'name': category.name,
                'description': category.description,
                'icon': category.icon,
                'sortOrder': category.sortOrder,
                'products': category.products
                    .map((product) => {
                          'id': product.id,
                          'sku': product.sku,
                          'name': product.name,
                          'description': product.description,
                          'price': product.price,
                          'adminFee': product.adminFee,
                          'targetLabel': product.targetLabel,
                          'targetPattern': product.targetPattern,
                          'sortOrder': product.sortOrder,
                        })
                    .toList(),
              })
          .toList();
    },
    inquiryRequest: ({required sku, required targetNumber}) async {
      final result = await demo.inquiry(sku: sku, targetNumber: targetNumber);
      final amount = result.payment.amount;
      final benefit = amount < result.walletPpobBalance
          ? amount
          : result.walletPpobBalance;
      return {
        'product': {
          'id': result.product.id,
          'sku': result.product.sku,
          'name': result.product.name,
          'price': result.product.price,
          'adminFee': result.product.adminFee,
          'targetLabel': result.product.targetLabel,
        },
        'targetNumber': targetNumber,
        'price': result.product.price,
        'adminFee': result.product.adminFee,
        'amount': amount,
        'payment': {
          'amount': amount,
          'benefitAmount': benefit,
          'balanceAmount': amount - benefit,
          'sufficient': walletBalance >= amount,
        },
        'wallet': {
          'balance': walletBalance,
          'ppobBalance': result.walletPpobBalance,
        },
      };
    },
    createOrderRequest: ({
      required sku,
      required targetNumber,
      required idempotencyKey,
    }) async {
      final order = await demo.createOrder(
        sku: sku,
        targetNumber: targetNumber,
        idempotencyKey: idempotencyKey,
      );
      return {
        'id': order.id,
        'status': 'REFUNDED',
        'sku': order.sku,
        'productName': order.productName,
        'categoryCode': order.categoryCode,
        'targetNumber': order.targetNumber,
        'amount': order.amount,
        'benefitAmount': order.benefitAmount,
        'balanceAmount': order.balanceAmount,
        'failureReason': order.failureReason,
        'providerRef': null,
        'createdAt': order.createdAt?.toIso8601String(),
        'refundedAt': order.refundedAt?.toIso8601String(),
        'replayed': false,
      };
    },
    ordersRequest: () async => const [],
  );
}
