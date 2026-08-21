// Stage R2.7 — widget test modul PPOB customer.
//
// Repository di-fake pada port boundary (wire typedefs) — pola yang sama
// dengan loader-for-tests Ojek Online: tidak ada jaringan, tidak ada mock
// framework, dan layar yang diuji adalah layar produksi apa adanya.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/application/ppob_providers.dart';
import 'package:tapgo_user_app/features/ppob/data/ppob_repository.dart';
import 'package:tapgo_user_app/features/ppob/domain/ppob_models.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_checkout_screen.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_history_screen.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_home_screen.dart';
import 'package:tapgo_user_app/main.dart';

PpobCategory _category({
  String code = 'PULSA',
  String name = 'Pulsa',
  List<PpobProduct>? products,
}) {
  return PpobCategory(
    id: 'cat-$code',
    code: code,
    name: name,
    icon: 'phone_iphone',
    products: products ??
        const [
          PpobProduct(
            id: 'prod-1',
            sku: 'PULSA_10K',
            name: 'Pulsa Rp10.000',
            description: 'Pulsa reguler Rp10.000 semua operator.',
            price: 11500,
            adminFee: 0,
            targetLabel: 'Nomor HP',
            targetPattern: '^[0-9]{10,15}\$',
            sortOrder: 1,
          ),
        ],
  );
}

class _FakePpobWires {
  List<PpobCategory> catalog = [_category()];
  Object? catalogError;
  List<PpobOrder> orders = [];
  Object? inquiryError;
  Object? createError;
  PpobOrder? createResult;
  double inquiryWalletBalance = 250000;
  double inquiryPpobBalance = 50000;
  int createCalls = 0;
  int inquiryCalls = 0;
  Duration createDelay = Duration.zero;
}

PpobRepository _repoFrom(_FakePpobWires wires) {
  return PpobRepository(
    catalogRequest: () async {
      if (wires.catalogError != null) {
        throw wires.catalogError!;
      }
      return wires.catalog
          .map((category) => {
                'id': category.id,
                'code': category.code,
                'name': category.name,
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
      wires.inquiryCalls += 1;
      if (wires.inquiryError != null) {
        throw wires.inquiryError!;
      }
      final product = wires.catalog
          .expand((category) => category.products)
          .firstWhere((product) => product.sku == sku);
      final amount = product.price + product.adminFee;
      final benefit = amount < wires.inquiryPpobBalance
          ? amount
          : wires.inquiryPpobBalance;
      return {
        'product': {
          'id': product.id,
          'sku': product.sku,
          'name': product.name,
          'price': product.price,
          'adminFee': product.adminFee,
          'targetLabel': product.targetLabel,
        },
        'targetNumber': targetNumber,
        'price': product.price,
        'adminFee': product.adminFee,
        'amount': amount,
        'payment': {
          'amount': amount,
          'benefitAmount': benefit,
          'balanceAmount': amount - benefit,
          'sufficient': wires.inquiryWalletBalance >= amount,
        },
        'wallet': {
          'balance': wires.inquiryWalletBalance,
          'ppobBalance': wires.inquiryPpobBalance,
        },
      };
    },
    createOrderRequest: ({
      required sku,
      required targetNumber,
      required idempotencyKey,
    }) async {
      wires.createCalls += 1;
      if (wires.createDelay > Duration.zero) {
        await Future<void>.delayed(wires.createDelay);
      }
      if (wires.createError != null) {
        throw wires.createError!;
      }
      final order = wires.createResult ??
          PpobOrder(
            id: 'order-1',
            status: PpobOrderStatus.refunded,
            sku: sku,
            productName: 'Pulsa Rp10.000',
            categoryCode: 'PULSA',
            targetNumber: targetNumber,
            amount: 11500,
            benefitAmount: 5000,
            balanceAmount: 6500,
            failureReason: 'Provider belum terhubung.',
            createdAt: DateTime(2026, 8, 21),
            refundedAt: DateTime(2026, 8, 21),
          );
      return {
        'id': order.id,
        'status': switch (order.status) {
          PpobOrderStatus.success => 'SUCCESS',
          PpobOrderStatus.processing => 'PROCESSING',
          PpobOrderStatus.pending => 'PENDING',
          PpobOrderStatus.failed => 'FAILED',
          PpobOrderStatus.refunded => 'REFUNDED',
          PpobOrderStatus.unknown => 'UNKNOWN',
        },
        'sku': order.sku,
        'productName': order.productName,
        'categoryCode': order.categoryCode,
        'targetNumber': order.targetNumber,
        'amount': order.amount,
        'benefitAmount': order.benefitAmount,
        'balanceAmount': order.balanceAmount,
        'failureReason': order.failureReason,
        'providerRef': order.providerRef,
        'createdAt': order.createdAt?.toIso8601String(),
        'completedAt': order.completedAt?.toIso8601String(),
        'refundedAt': order.refundedAt?.toIso8601String(),
        'replayed': order.replayed,
      };
    },
    ordersRequest: () async => wires.orders
        .map((order) => {
              'id': order.id,
              'status': switch (order.status) {
                PpobOrderStatus.success => 'SUCCESS',
                PpobOrderStatus.processing => 'PROCESSING',
                PpobOrderStatus.pending => 'PENDING',
                PpobOrderStatus.failed => 'FAILED',
                PpobOrderStatus.refunded => 'REFUNDED',
                PpobOrderStatus.unknown => 'UNKNOWN',
              },
              'sku': order.sku,
              'productName': order.productName,
              'categoryCode': order.categoryCode,
              'targetNumber': order.targetNumber,
              'amount': order.amount,
              'benefitAmount': order.benefitAmount,
              'balanceAmount': order.balanceAmount,
              'failureReason': order.failureReason,
              'createdAt': order.createdAt?.toIso8601String(),
            })
        .toList(),
  );
}

Widget _app(Widget child, PpobRepository repository, {Brightness? brightness}) {
  return ProviderScope(
    overrides: [ppobRepositoryProvider.overrideWithValue(repository)],
    child: MaterialApp(
      theme: tapGoReadableTheme(),
      darkTheme: tapGoReadableTheme(brightness: Brightness.dark),
      themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
      home: child,
    ),
  );
}

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

void main() {
  group('PpobHomeScreen', () {
    testWidgets('menampilkan kategori dari katalog (accepted)', (tester) async {
      final wires = _FakePpobWires();
      await tester.pumpWidget(_app(const PpobHomeScreen(), _repoFrom(wires)));
      await _settle(tester);

      expect(find.text('PPOB'), findsOneWidget);
      expect(find.text('Pulsa'), findsOneWidget);
      // Tidak ada CTA keluar / WebView: hanya grid kategori + riwayat.
      expect(find.textContaining('http'), findsNothing);
    });

    testWidgets('katalog kosong menampilkan empty state', (tester) async {
      final wires = _FakePpobWires()..catalog = [];
      await tester.pumpWidget(_app(const PpobHomeScreen(), _repoFrom(wires)));
      await _settle(tester);

      expect(find.text('Katalog kosong'), findsOneWidget);
    });

    testWidgets('kegagalan katalog menampilkan error + coba lagi',
        (tester) async {
      final wires = _FakePpobWires()
        ..catalogError = const PpobApiException(
          code: 'NETWORK_ERROR',
          message: 'down',
        );
      await tester.pumpWidget(_app(const PpobHomeScreen(), _repoFrom(wires)));
      await _settle(tester);

      expect(find.text('Gagal memuat katalog'), findsOneWidget);
      expect(find.text('Coba Lagi'), findsOneWidget);

      // Retry berhasil setelah error dibersihkan.
      wires.catalogError = null;
      await tester.tap(find.text('Coba Lagi'));
      await _settle(tester);
      expect(find.text('Pulsa'), findsOneWidget);
    });

    testWidgets('tetap rapi pada lebar 320dp dan dark mode', (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final wires = _FakePpobWires();
      await tester.pumpWidget(
        _app(const PpobHomeScreen(), _repoFrom(wires),
            brightness: Brightness.dark),
      );
      await _settle(tester);

      expect(find.text('Pulsa'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('PpobCheckoutScreen', () {
    Future<void> pumpCheckout(WidgetTester tester, _FakePpobWires wires) async {
      // Permukaan tinggi agar seluruh isi ListView checkout (ringkasan →
      // rincian → hasil → tombol riwayat) ter-render tanpa lazy-build.
      tester.view.physicalSize = const Size(900, 1600);
      tester.view.devicePixelRatio = 2.0;
      addTearDown(tester.view.reset);
      final category = wires.catalog.first;
      await tester.pumpWidget(
        _app(
          PpobCheckoutScreen(
            categoryCode: category.code,
            product: category.products.first,
          ),
          _repoFrom(wires),
        ),
      );
      await _settle(tester);
    }

    Future<void> fillTargetAndInquiry(WidgetTester tester,
        [String target = '081234567890']) async {
      await tester.enterText(find.byType(TextFormField), target);
      // Pompa satu frame agar onChanged membangun ulang tombol (enabled).
      await tester.pump();
      await tester.tap(find.text('Cek Harga'));
      await _settle(tester);
    }

    testWidgets('inquiry menampilkan rincian saldo gabungan', (tester) async {
      final wires = _FakePpobWires();
      await pumpCheckout(tester, wires);
      await fillTargetAndInquiry(tester);

      expect(find.text('Rincian Pembayaran'), findsOneWidget);
      expect(find.text('Rp11.500'), findsWidgets);
      expect(find.text('Bayar Sekarang'), findsOneWidget);
      expect(find.text('Dari saldo benefit PPOB'), findsOneWidget);
      expect(find.text('Dari saldo utama'), findsOneWidget);
    });

    testWidgets('saldo tidak cukup: tombol bayar nonaktif + pesan jelas',
        (tester) async {
      final wires = _FakePpobWires()..inquiryWalletBalance = 1000;
      await pumpCheckout(tester, wires);
      await fillTargetAndInquiry(tester);

      expect(find.text('Saldo tidak cukup untuk transaksi ini.'),
          findsOneWidget);
      // FilledButton.icon menghasilkan subclass _FilledButtonWithIcon, jadi
      // pencarian memakai predicate subtype, bukan byType.
      final button = tester.widget<FilledButton>(
        find.ancestor(
          of: find.text('Bayar Sekarang'),
          matching: find.byWidgetPredicate(
            (widget) => widget is FilledButton,
          ),
        ),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets('provider unavailable: pesan ramah, tidak ada order',
        (tester) async {
      final wires = _FakePpobWires()
        ..createError = const PpobApiException(
          code: 'PPOB_PROVIDER_UNAVAILABLE',
          message: 'PPOB provider is not connected yet',
          statusCode: 503,
        );
      await pumpCheckout(tester, wires);
      await fillTargetAndInquiry(tester);
      await tester.tap(find.text('Bayar Sekarang'));
      await _settle(tester);

      expect(
        find.text('Layanan PPOB belum tersedia. Mohon coba lagi nanti.'),
        findsOneWidget,
      );
      expect(find.text('Hasil Transaksi'), findsNothing);
    });

    testWidgets('single-flight: double tap bayar hanya satu createOrder',
        (tester) async {
      final wires = _FakePpobWires()
        ..createDelay = const Duration(milliseconds: 100);
      await pumpCheckout(tester, wires);
      await fillTargetAndInquiry(tester);

      await tester.tap(find.text('Bayar Sekarang'));
      await tester.pump();
      // Tap kedua selama permintaan masih berjalan harus diabaikan.
      await tester.tap(find.text('Memproses…'), warnIfMissed: false);
      await tester.pump(const Duration(milliseconds: 200));
      await _settle(tester);

      expect(wires.createCalls, 1);
    });

    testWidgets('hasil REFUNDED menampilkan status dan alasan',
        (tester) async {
      final wires = _FakePpobWires();
      await pumpCheckout(tester, wires);
      await fillTargetAndInquiry(tester);
      await tester.tap(find.text('Bayar Sekarang'));
      await _settle(tester);

      expect(find.text('Hasil Transaksi'), findsOneWidget);
      expect(find.text('Dikembalikan'), findsOneWidget);
      expect(find.textContaining('Provider belum terhubung'), findsOneWidget);
      expect(find.text('Lihat Riwayat'), findsOneWidget);
    });

    testWidgets('mengubah nomor tujuan me-reset inquiry (wajib cek ulang)',
        (tester) async {
      final wires = _FakePpobWires();
      await pumpCheckout(tester, wires);
      await fillTargetAndInquiry(tester);
      expect(find.text('Rincian Pembayaran'), findsOneWidget);

      await tester.enterText(find.byType(TextFormField), '089988776655');
      await _settle(tester);

      expect(find.text('Rincian Pembayaran'), findsNothing);
      expect(find.text('Cek Harga'), findsOneWidget);
    });

    testWidgets('privacy: layar tidak merender token atau rahasia',
        (tester) async {
      final wires = _FakePpobWires();
      await pumpCheckout(tester, wires);
      await fillTargetAndInquiry(tester);
      await tester.tap(find.text('Bayar Sekarang'));
      await _settle(tester);

      final rendered = tester.allWidgets
          .whereType<Text>()
          .map((text) => text.data ?? '')
          .join('\n');
      expect(rendered.contains('Bearer'), isFalse);
      expect(rendered.contains('accessToken'), isFalse);
      expect(rendered.contains('refreshToken'), isFalse);
      expect(rendered.contains('idempotencyKey'), isFalse);
      expect(rendered.contains('eyJ'), isFalse);
    });
  });

  group('PpobHistoryScreen', () {
    testWidgets('riwayat kosong menampilkan empty state', (tester) async {
      final wires = _FakePpobWires();
      await tester.pumpWidget(_app(const PpobHistoryScreen(), _repoFrom(wires)));
      await _settle(tester);

      expect(find.text('Belum ada transaksi'), findsOneWidget);
    });

    testWidgets('riwayat menampilkan order dengan chip status', (tester) async {
      final wires = _FakePpobWires()
        ..orders = [
          PpobOrder(
            id: 'o1',
            status: PpobOrderStatus.success,
            sku: 'PULSA_10K',
            productName: 'Pulsa Rp10.000',
            categoryCode: 'PULSA',
            targetNumber: '081234567890',
            amount: 11500,
            benefitAmount: 5000,
            balanceAmount: 6500,
            createdAt: DateTime(2026, 8, 21),
          ),
          PpobOrder(
            id: 'o2',
            status: PpobOrderStatus.refunded,
            sku: 'PLN_50K',
            productName: 'Token PLN Rp50.000',
            categoryCode: 'PLN_TOKEN',
            targetNumber: '12345678901',
            amount: 51500,
            benefitAmount: 0,
            balanceAmount: 51500,
            failureReason: 'Provider rejected',
            createdAt: DateTime(2026, 8, 20),
          ),
        ];
      await tester.pumpWidget(_app(const PpobHistoryScreen(), _repoFrom(wires)));
      await _settle(tester);

      expect(find.text('Pulsa Rp10.000'), findsOneWidget);
      expect(find.text('Berhasil'), findsOneWidget);
      expect(find.text('Token PLN Rp50.000'), findsOneWidget);
      expect(find.text('Dikembalikan'), findsOneWidget);
    });

    testWidgets('kegagalan riwayat menampilkan error + coba lagi',
        (tester) async {
      final repository = PpobRepository(
        catalogRequest: () async => const [],
        inquiryRequest: ({required sku, required targetNumber}) =>
            Future.error(StateError('unused')),
        createOrderRequest: ({
          required sku,
          required targetNumber,
          required idempotencyKey,
        }) =>
            Future.error(StateError('unused')),
        ordersRequest: () async => throw const PpobApiException(
          code: 'NETWORK_ERROR',
          message: 'down',
        ),
      );
      await tester.pumpWidget(_app(const PpobHistoryScreen(), repository));
      await _settle(tester);

      expect(find.text('Gagal memuat riwayat'), findsOneWidget);
      expect(find.text('Coba Lagi'), findsOneWidget);
    });
  });
}
