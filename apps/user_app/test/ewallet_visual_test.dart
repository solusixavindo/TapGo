import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/application/ppob_providers.dart';
import 'package:tapgo_user_app/features/ppob/data/ppob_repository.dart';
import 'package:tapgo_user_app/features/ppob/domain/ppob_models.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_category_screen.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_home_screen.dart';
import 'package:tapgo_user_app/main.dart';

import 'ppob_visual_evidence_test.dart' show loadRealFonts;

/// Bukti visual: kategori E-Wallet SUNGGUH AKTIF dengan produk per dompet
/// nyata (DANA/GoPay/OVO/ShopeePay), bukan lagi kategori kosong yang jatuh
/// ke halaman PPOB umum (laporan Owner 22 Sep 2026). Katalog di sini
/// meniru PERSIS bentuk yang dikembalikan backend setelah migrasi
/// 20260920120000_ppob_ewallet_topup. TIDAK berjalan pada `flutter test`
/// biasa:
///
///   flutter test test/ewallet_visual_test.dart \
///     --dart-define=TAPGO_EWALLET_VISUAL=true --update-goldens
const bool _enabled = bool.fromEnvironment('TAPGO_EWALLET_VISUAL');

const _ewalletCategoryJson = {
  'id': 'cat-EWALLET',
  'code': 'EWALLET',
  'name': 'E-Wallet',
  'icon': 'account_balance_wallet',
  'sortOrder': 0,
  'products': [
    {
      'sku': 'EWALLET_DANA_20K',
      'name': 'DANA Rp20.000',
      'description':
          'Top up saldo DANA Rp20.000. Nomor tujuan harus terdaftar di DANA.',
      'price': '21000.00',
      'adminFee': '0.00',
      'targetLabel': 'Nomor E-Wallet',
      'brand': 'DANA',
    },
    {
      'sku': 'EWALLET_DANA_50K',
      'name': 'DANA Rp50.000',
      'description':
          'Top up saldo DANA Rp50.000. Nomor tujuan harus terdaftar di DANA.',
      'price': '51000.00',
      'adminFee': '0.00',
      'targetLabel': 'Nomor E-Wallet',
      'brand': 'DANA',
    },
    {
      'sku': 'EWALLET_GOPAY_50K',
      'name': 'GoPay Rp50.000',
      'description':
          'Top up saldo GoPay Rp50.000. Nomor tujuan harus terdaftar di GoPay.',
      'price': '52500.00',
      'adminFee': '0.00',
      'targetLabel': 'Nomor E-Wallet',
      'brand': 'GoPay',
    },
    {
      'sku': 'EWALLET_GOPAY_100K',
      'name': 'GoPay Rp100.000',
      'description':
          'Top up saldo GoPay Rp100.000. Nomor tujuan harus terdaftar di GoPay.',
      'price': '102500.00',
      'adminFee': '0.00',
      'targetLabel': 'Nomor E-Wallet',
      'brand': 'GoPay',
    },
    {
      'sku': 'EWALLET_OVO_50K',
      'name': 'OVO Rp50.000',
      'description':
          'Top up saldo OVO Rp50.000. Nomor tujuan harus terdaftar di OVO.',
      'price': '52000.00',
      'adminFee': '0.00',
      'targetLabel': 'Nomor E-Wallet',
      'brand': 'OVO',
    },
    {
      'sku': 'EWALLET_OVO_100K',
      'name': 'OVO Rp100.000',
      'description':
          'Top up saldo OVO Rp100.000. Nomor tujuan harus terdaftar di OVO.',
      'price': '102000.00',
      'adminFee': '0.00',
      'targetLabel': 'Nomor E-Wallet',
      'brand': 'OVO',
    },
    {
      'sku': 'EWALLET_SHOPEEPAY_50K',
      'name': 'ShopeePay Rp50.000',
      'description':
          'Top up saldo ShopeePay Rp50.000. Nomor tujuan harus terdaftar di ShopeePay.',
      'price': '52000.00',
      'adminFee': '0.00',
      'targetLabel': 'Nomor E-Wallet',
      'brand': 'ShopeePay',
    },
    {
      'sku': 'EWALLET_SHOPEEPAY_100K',
      'name': 'ShopeePay Rp100.000',
      'description':
          'Top up saldo ShopeePay Rp100.000. Nomor tujuan harus terdaftar di ShopeePay.',
      'price': '102000.00',
      'adminFee': '0.00',
      'targetLabel': 'Nomor E-Wallet',
      'brand': 'ShopeePay',
    },
  ],
};

const _pulsaCategoryJson = {
  'id': 'cat-PULSA',
  'code': 'PULSA',
  'name': 'Pulsa',
  'icon': 'phone_iphone',
  'sortOrder': 1,
  'products': <Map<String, dynamic>>[],
};

const _dataCategoryJson = {
  'id': 'cat-DATA',
  'code': 'DATA',
  'name': 'Paket Data',
  'icon': 'wifi',
  'sortOrder': 2,
  'products': <Map<String, dynamic>>[],
};

const _plnCategoryJson = {
  'id': 'cat-PLN',
  'code': 'PLN_PREPAID',
  'name': 'Token PLN',
  'icon': 'bolt',
  'sortOrder': 3,
  'products': <Map<String, dynamic>>[],
};

PpobRepository _repo() {
  return PpobRepository(
    catalogRequest: () async => [
      _pulsaCategoryJson,
      _dataCategoryJson,
      _plnCategoryJson,
      _ewalletCategoryJson,
    ],
    inquiryRequest: ({required sku, required targetNumber}) async =>
        throw UnimplementedError(),
    createOrderRequest: ({
      required sku,
      required targetNumber,
      required idempotencyKey,
    }) async =>
        throw UnimplementedError(),
    ordersRequest: () async => [],
  );
}

Future<void> _shoot(
  WidgetTester tester,
  String name,
  Widget child,
) async {
  tapGoDisablePersistenceForTests = true;
  addTearDown(() => tapGoDisablePersistenceForTests = false);
  expect(await loadRealFonts(), isTrue);
  tester.view.physicalSize = const Size(1080, 1900);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [ppobRepositoryProvider.overrideWithValue(_repo())],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: tapGoReadableTheme(),
        home: child,
      ),
    ),
  );
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 80));
  }
  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile('../../../docs/release-2/visual-review/r2.13-ppob-ewallet/$name.png'),
  );
}

void main() {
  testWidgets('01 beranda PPOB — E-Wallet kini muncul sebagai kategori aktif',
      (tester) async {
    await _shoot(tester, '01_ppob_home_with_ewallet', const PpobHomeScreen());
  }, skip: !_enabled);

  testWidgets(
      '00 tile Super Menu "BPJS" (belum tersedia) — layar jujur, bukan lagi jatuh ke PPOB umum',
      (tester) async {
    await _shoot(
      tester,
      '00_super_menu_bpjs_unavailable',
      const PpobCategoryUnavailableScreen(label: 'BPJS'),
    );
  }, skip: !_enabled);

  testWidgets('02 kategori E-Wallet — DANA/GoPay/OVO/ShopeePay nyata',
      (tester) async {
    final category = PpobCategory.fromJson(
      Map<String, dynamic>.from(_ewalletCategoryJson),
    );
    await _shoot(
      tester,
      '02_ppob_category_ewallet',
      PpobCategoryScreen(category: category),
    );
  }, skip: !_enabled);
}
