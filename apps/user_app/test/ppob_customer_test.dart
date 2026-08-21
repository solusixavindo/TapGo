import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Regression PPOB customer UI (Stage R2.7).
///
/// Tidak ada panggilan jaringan nyata: seluruh permintaan API disuntikkan
/// melalui hook `tapGoPpob*ForTests`, mengikuti pola loader-for-tests yang
/// dipakai layar Ojek Online dan Tiket Bantuan.

Widget wrapPpob(Widget child, {ThemeMode themeMode = ThemeMode.light}) {
  return ProviderScope(
    child: MaterialApp(
      themeMode: themeMode,
      theme: ThemeData.light(useMaterial3: true),
      darkTheme: ThemeData.dark(useMaterial3: true),
      home: child,
    ),
  );
}

void useTallView(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 1700);
  tester.view.devicePixelRatio = 2.0;
  addTearDown(tester.view.reset);
}

Future<void> settleFrames(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

Map<String, dynamic> productPayload({
  String sku = 'PULSA_TSEL_10',
  String category = 'PULSA',
  String brand = 'Telkomsel',
  String name = 'Pulsa Telkomsel 10.000',
  int price = 11500,
  int adminFee = 0,
}) {
  return {
    'sku': sku,
    'category': category,
    'brand': brand,
    'name': name,
    'description': null,
    'price': price,
    'adminFee': adminFee,
  };
}

Map<String, dynamic> transactionPayload({
  String status = 'SUCCESS',
  String reference = 'PPB-A2B3C4D5E6',
  String? serialNumber = 'STUB-SN-A2B3C4D5E6',
  String? failureReason,
}) {
  return {
    'reference': reference,
    'sku': 'PULSA_TSEL_10',
    'productName': 'Pulsa Telkomsel 10.000',
    'brand': 'Telkomsel',
    'category': 'PULSA',
    'targetNumber': '085612345678',
    'amount': 11500,
    'adminFee': 0,
    'totalAmount': 11500,
    'status': status,
    'serialNumber': serialNumber,
    'failureCode': null,
    'failureReason': failureReason,
    'completedAt': '2026-08-21T01:00:00.000Z',
    'createdAt': '2026-08-21T00:59:00.000Z',
  };
}

DioException dioErrorWithCode(String code, int statusCode) {
  return DioException(
    requestOptions: RequestOptions(path: '/ppob/transactions'),
    response: Response(
      requestOptions: RequestOptions(path: '/ppob/transactions'),
      statusCode: statusCode,
      data: {'success': false, 'code': code, 'message': 'stub'},
    ),
  );
}

void main() {
  tearDown(() {
    tapGoPpobCatalogLoaderForTests = null;
    tapGoPpobWalletLoaderForTests = null;
    tapGoPpobHistoryLoaderForTests = null;
    tapGoPpobTransactionDetailLoaderForTests = null;
    tapGoPpobPurchaseForTests = null;
  });

  group('PpobHomeScreen', () {
    testWidgets('menampilkan saldo, kategori, dan produk dari loader', (
      tester,
    ) async {
      useTallView(tester);
      tapGoPpobCatalogLoaderForTests = ({String? category}) async => [
            productPayload(),
            productPayload(
              sku: 'PLN_TOKEN_20',
              category: 'PLN_PREPAID',
              brand: 'PLN',
              name: 'Token PLN 20.000',
              price: 20500,
            ),
          ];
      tapGoPpobWalletLoaderForTests = () async => {
            'balance': '0.00',
            'cashBalance': '0.00',
            'ppobBalance': '100000.00',
          };

      await tester.pumpWidget(wrapPpob(const PpobHomeScreen()));
      await settleFrames(tester);

      expect(find.text('Saldo PPOB & Benefit'), findsOneWidget);
      expect(find.text('Rp100.000'), findsOneWidget);
      expect(find.text('Pulsa Telkomsel 10.000'), findsOneWidget);
      expect(find.text('Token PLN 20.000'), findsOneWidget);
      expect(find.text('Rp11.500'), findsOneWidget);
      expect(find.text('Semua'), findsOneWidget);
      expect(find.text('Token PLN'), findsOneWidget);
    });

    testWidgets('filter kategori meneruskan nilai kategori ke loader', (
      tester,
    ) async {
      useTallView(tester);
      final requested = <String?>[];
      tapGoPpobCatalogLoaderForTests = ({String? category}) async {
        requested.add(category);
        return [
          productPayload(
            sku: category == 'PLN_PREPAID' ? 'PLN_TOKEN_20' : 'PULSA_TSEL_10',
            category: category == 'PLN_PREPAID' ? 'PLN_PREPAID' : 'PULSA',
            name: category == 'PLN_PREPAID'
                ? 'Token PLN 20.000'
                : 'Pulsa Telkomsel 10.000',
          ),
        ];
      };
      tapGoPpobWalletLoaderForTests =
          () async => {'ppobBalance': '100000.00'};

      await tester.pumpWidget(wrapPpob(const PpobHomeScreen()));
      await settleFrames(tester);

      await tester.ensureVisible(find.text('Token PLN'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Token PLN'));
      await settleFrames(tester);

      expect(requested, [null, 'PLN_PREPAID']);
      expect(find.text('Token PLN 20.000'), findsOneWidget);
      expect(find.text('Pulsa Telkomsel 10.000'), findsNothing);
    });

    testWidgets('kegagalan jaringan menampilkan state error dengan coba lagi', (
      tester,
    ) async {
      useTallView(tester);
      var calls = 0;
      tapGoPpobCatalogLoaderForTests = ({String? category}) async {
        calls += 1;
        if (calls == 1) {
          throw DioException(
            requestOptions: RequestOptions(path: '/ppob/products'),
            type: DioExceptionType.connectionError,
          );
        }
        return [productPayload()];
      };
      tapGoPpobWalletLoaderForTests =
          () async => {'ppobBalance': '100000.00'};

      await tester.pumpWidget(wrapPpob(const PpobHomeScreen()));
      await settleFrames(tester);

      expect(find.text('Katalog belum termuat'), findsOneWidget);
      expect(find.text('Coba lagi'), findsOneWidget);

      await tester.tap(find.text('Coba lagi'));
      await settleFrames(tester);
      expect(find.text('Pulsa Telkomsel 10.000'), findsOneWidget);
    });

    testWidgets('katalog kosong menampilkan empty state yang jujur', (
      tester,
    ) async {
      useTallView(tester);
      tapGoPpobCatalogLoaderForTests = ({String? category}) async => const [];
      tapGoPpobWalletLoaderForTests =
          () async => {'ppobBalance': '0.00'};

      await tester.pumpWidget(wrapPpob(const PpobHomeScreen()));
      await settleFrames(tester);

      expect(find.text('Belum ada produk'), findsOneWidget);
    });

    testWidgets('render aman pada tema gelap', (tester) async {
      useTallView(tester);
      tapGoPpobCatalogLoaderForTests = ({String? category}) async =>
          [productPayload()];
      tapGoPpobWalletLoaderForTests =
          () async => {'ppobBalance': '100000.00'};

      await tester.pumpWidget(
        wrapPpob(const PpobHomeScreen(), themeMode: ThemeMode.dark),
      );
      await settleFrames(tester);

      expect(find.text('Pulsa Telkomsel 10.000'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('PpobCheckoutScreen', () {
    testWidgets('target tidak valid ditolak lokal tanpa memanggil purchase', (
      tester,
    ) async {
      useTallView(tester);
      var purchaseCalls = 0;
      tapGoPpobPurchaseForTests = ({
        required String sku,
        required String targetNumber,
        required String idempotencyKey,
      }) async {
        purchaseCalls += 1;
        return transactionPayload();
      };

      await tester.pumpWidget(
        wrapPpob(PpobCheckoutScreen(product: productPayload())),
      );
      await settleFrames(tester);

      await tester.enterText(find.byType(TextField), '07123');
      await tester.tap(find.textContaining('Bayar'));
      await settleFrames(tester);

      expect(purchaseCalls, 0);
      expect(
        find.text('Nomor HP harus diawali 08 dan berisi 10–13 digit.'),
        findsOneWidget,
      );
    });

    testWidgets(
      'saldo kurang: tombol nonaktif dan purchase tidak pernah dipanggil',
      (tester) async {
        useTallView(tester);
        var purchaseCalls = 0;
        tapGoPpobPurchaseForTests = ({
          required String sku,
          required String targetNumber,
          required String idempotencyKey,
        }) async {
          purchaseCalls += 1;
          return transactionPayload();
        };

        await tester.pumpWidget(
          wrapPpob(
            PpobCheckoutScreen(
              product: productPayload(),
              initialBalance: 5000,
            ),
          ),
        );
        await settleFrames(tester);

        expect(find.text('Saldo belum cukup'), findsOneWidget);
        final button = tester.widget<FilledButton>(
          find.widgetWithText(FilledButton, 'Bayar Rp11.500'),
        );
        expect(button.onPressed, isNull);
        await tester.tap(find.text('Bayar Rp11.500'));
        await settleFrames(tester);
        expect(purchaseCalls, 0);
      },
    );

    testWidgets(
      'purchase sukses membuka layar hasil dengan serial; key idempotency stabil',
      (tester) async {
        useTallView(tester);
        final keys = <String>[];
        tapGoPpobPurchaseForTests = ({
          required String sku,
          required String targetNumber,
          required String idempotencyKey,
        }) async {
          keys.add(idempotencyKey);
          return transactionPayload();
        };

        await tester.pumpWidget(
          wrapPpob(PpobCheckoutScreen(product: productPayload())),
        );
        await settleFrames(tester);

        await tester.enterText(find.byType(TextField), '+6285612345678');
        await tester.tap(find.textContaining('Bayar'));
        await settleFrames(tester);

        expect(keys, hasLength(1));
        expect(keys.single, startsWith('ppob-'));
        expect(find.text('Pembelian Berhasil'), findsOneWidget);
        expect(find.text('STUB-SN-A2B3C4D5E6'), findsOneWidget);
        expect(find.text('PPB-A2B3C4D5E6'), findsOneWidget);
      },
    );

    testWidgets(
      'kegagalan purchase menampilkan pesan ramah; retry memakai key SAMA',
      (tester) async {
        useTallView(tester);
        final keys = <String>[];
        var calls = 0;
        tapGoPpobPurchaseForTests = ({
          required String sku,
          required String targetNumber,
          required String idempotencyKey,
        }) async {
          keys.add(idempotencyKey);
          calls += 1;
          if (calls == 1) {
            throw dioErrorWithCode('INSUFFICIENT_PPOB_BALANCE', 400);
          }
          return transactionPayload();
        };

        await tester.pumpWidget(
          wrapPpob(PpobCheckoutScreen(product: productPayload())),
        );
        await settleFrames(tester);

        await tester.enterText(find.byType(TextField), '085612345678');
        await tester.tap(find.textContaining('Bayar'));
        await settleFrames(tester);

        expect(
          find.text('Saldo PPOB & Benefit kamu tidak mencukupi.'),
          findsOneWidget,
        );
        // Tetap di checkout (tidak berpindah layar).
        expect(find.text('Konfirmasi Pembelian'), findsOneWidget);

        await tester.tap(find.textContaining('Bayar'));
        await settleFrames(tester);

        expect(calls, 2);
        // Kunci idempotency TIDAK berubah antar percobaan — inilah yang
        // mencegah debit ganda di server.
        expect(keys[0], keys[1]);
        expect(find.text('Pembelian Berhasil'), findsOneWidget);
      },
    );

    testWidgets('double-tap cepat hanya memicu satu pembelian (single-flight)', (
      tester,
    ) async {
      useTallView(tester);
      var calls = 0;
      tapGoPpobPurchaseForTests = ({
        required String sku,
        required String targetNumber,
        required String idempotencyKey,
      }) async {
        calls += 1;
        await Future<void>.delayed(const Duration(milliseconds: 200));
        return transactionPayload();
      };

      await tester.pumpWidget(
        wrapPpob(PpobCheckoutScreen(product: productPayload())),
      );
      await settleFrames(tester);

      await tester.enterText(find.byType(TextField), '085612345678');
      final button = find.textContaining('Bayar');
      await tester.tap(button);
      await tester.tap(button, warnIfMissed: false);
      await tester.pump(const Duration(milliseconds: 300));
      await settleFrames(tester);

      expect(calls, 1);
    });
  });

  group('PpobResultScreen', () {
    testWidgets('status FAILED menampilkan catatan refund yang jujur', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapPpob(
          PpobResultScreen(
            transaction: transactionPayload(
              status: 'FAILED',
              serialNumber: null,
              failureReason: 'Kegagalan sintetis untuk menguji jalur refund',
            ),
          ),
        ),
      );
      await settleFrames(tester);

      expect(find.text('Pembelian Gagal'), findsOneWidget);
      expect(find.textContaining('dikembalikan penuh'), findsOneWidget);
      expect(find.text('Serial / Token'), findsNothing);
    });
  });

  group('PpobHistoryScreen', () {
    testWidgets('menampilkan riwayat dengan chip status', (tester) async {
      useTallView(tester);
      tapGoPpobHistoryLoaderForTests = ({int limit = 20}) async => [
            transactionPayload(),
            transactionPayload(
              status: 'FAILED',
              reference: 'PPB-Z9Y8X7W6V5',
              serialNumber: null,
            ),
          ];

      await tester.pumpWidget(wrapPpob(const PpobHistoryScreen()));
      await settleFrames(tester);

      expect(find.text('Berhasil'), findsOneWidget);
      expect(find.text('Gagal · Dana kembali'), findsOneWidget);
      expect(find.text('PPB-A2B3C4D5E6'.substring(0, 0)), findsNothing);
    });

    testWidgets('tap item membuka detail lewat loader referensi', (
      tester,
    ) async {
      useTallView(tester);
      tapGoPpobHistoryLoaderForTests = ({int limit = 20}) async =>
          [transactionPayload()];
      tapGoPpobTransactionDetailLoaderForTests =
          (reference) async => transactionPayload(reference: reference);

      await tester.pumpWidget(wrapPpob(const PpobHistoryScreen()));
      await settleFrames(tester);

      await tester.tap(find.text('Pulsa Telkomsel 10.000'));
      await settleFrames(tester);

      expect(find.text('Detail Transaksi'), findsOneWidget);
      expect(find.text('PPB-A2B3C4D5E6'), findsOneWidget);
      expect(find.text('STUB-SN-A2B3C4D5E6'), findsOneWidget);
    });

    testWidgets('riwayat kosong menampilkan empty state', (tester) async {
      useTallView(tester);
      tapGoPpobHistoryLoaderForTests = ({int limit = 20}) async => const [];

      await tester.pumpWidget(wrapPpob(const PpobHistoryScreen()));
      await settleFrames(tester);

      expect(find.text('Belum ada transaksi'), findsOneWidget);
    });
  });
}
