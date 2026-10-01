// Entry point DEMO — bukan bagian dari aplikasi Play Store.
//
// Menampilkan tiga perubahan sesi ini secara hidup di browser, tanpa
// menyentuh jaringan/backend nyata:
//   1. Kartu identitas "Akun" dengan emas TapGo asli (bukan kuning).
//   2. Tile Super Menu untuk kategori yang belum tersedia (BPJS) — layar
//      jujur, bukan lagi jatuh diam-diam ke halaman PPOB umum.
//   3. Kategori E-Wallet dengan produk nyata (DANA/GoPay/OVO/ShopeePay).
//
// Build terpisah dari aplikasi sesungguhnya:
//   flutter build web -t lib/demo_showcase_main.dart --release
// main.dart (App Store/Play) TIDAK disentuh oleh berkas ini.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'demo/client_flow_models.dart';
import 'features/ppob/application/ppob_providers.dart';
import 'features/ppob/data/ppob_repository.dart';
import 'features/ppob/domain/ppob_models.dart';
import 'features/ppob/presentation/ppob_category_screen.dart';
import 'features/ppob/presentation/ppob_home_screen.dart';
import 'main.dart';

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

const _emptyCategories = [
  {
    'id': 'cat-PULSA',
    'code': 'PULSA',
    'name': 'Pulsa',
    'icon': 'phone_iphone',
    'sortOrder': 1,
    'products': <Map<String, dynamic>>[]
  },
  {
    'id': 'cat-DATA',
    'code': 'DATA',
    'name': 'Paket Data',
    'icon': 'wifi',
    'sortOrder': 2,
    'products': <Map<String, dynamic>>[]
  },
  {
    'id': 'cat-PLN',
    'code': 'PLN_PREPAID',
    'name': 'Token PLN',
    'icon': 'bolt',
    'sortOrder': 3,
    'products': <Map<String, dynamic>>[]
  },
];

PpobRepository _demoRepo() => PpobRepository(
      catalogRequest: () async => [..._emptyCategories, _ewalletCategoryJson],
      inquiryRequest: ({required sku, required targetNumber}) async =>
          throw UnimplementedError('demo: inquiry dinonaktifkan'),
      createOrderRequest: ({
        required sku,
        required targetNumber,
        required idempotencyKey,
      }) async =>
          throw UnimplementedError('demo: pembelian dinonaktifkan'),
      ordersRequest: () async => [],
    );

void main() {
  tapGoDisablePersistenceForTests = true; // tanpa jaringan/storage sungguhan
  runApp(
    ProviderScope(
      overrides: [
        ppobRepositoryProvider.overrideWithValue(_demoRepo()),
        tapGoSessionProviderForTest.overrideWith(
          (ref) => DemoClientSession.initial().copyWith(
            userName: 'Sandika TapGo',
            activePackageName: 'Basic',
          ),
        ),
      ],
      child: const _ShowcaseApp(),
    ),
  );
}

class _ShowcaseApp extends StatefulWidget {
  const _ShowcaseApp();

  @override
  State<_ShowcaseApp> createState() => _ShowcaseAppState();
}

class _ShowcaseAppState extends State<_ShowcaseApp> {
  int _index = 0;

  static final _pages = <String, WidgetBuilder>{
    'Kartu Akun (emas)': (_) => const AccountScreen(),
    'Beranda PPOB': (_) => const PpobHomeScreen(),
    'E-Wallet (aktif)': (_) => PpobCategoryScreen(
          category: PpobCategory.fromJson(
            Map<String, dynamic>.from(_ewalletCategoryJson),
          ),
        ),
    'BPJS (belum tersedia)': (_) =>
        const PpobCategoryUnavailableScreen(label: 'BPJS'),
  };

  @override
  Widget build(BuildContext context) {
    final titles = _pages.keys.toList();
    return MaterialApp(
      title: 'TapGo — Demo Perubahan 22 Sep',
      debugShowCheckedModeBanner: false,
      theme: tapGoReadableTheme(),
      home: Scaffold(
        backgroundColor: const Color(0xFF0B1F3A),
        body: SafeArea(
          child: Column(
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
                color: const Color(0xFF0B1F3A),
                child: const Text(
                  'Demo perubahan TapGo — 22 Sep 2026',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
              ),
              Container(
                width: double.infinity,
                color: const Color(0xFF0B1F3A),
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (var i = 0; i < titles.length; i++)
                      ChoiceChip(
                        label: Text(titles[i]),
                        selected: _index == i,
                        onSelected: (_) => setState(() => _index = i),
                        selectedColor: const Color(0xFFD4AF37),
                        labelStyle: TextStyle(
                          fontWeight: FontWeight.w800,
                          color: _index == i
                              ? const Color(0xFF0B1F3A)
                              : Colors.white,
                        ),
                        backgroundColor: Colors.white.withValues(alpha: 0.08),
                      ),
                  ],
                ),
              ),
              Expanded(
                child: ColoredBox(
                  color: Theme.of(context).scaffoldBackgroundColor,
                  child: Builder(builder: _pages[titles[_index]]!),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
