import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/application/ppob_providers.dart';
import 'package:tapgo_user_app/features/ppob/data/ppob_repository.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_category_screen.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_home_screen.dart';
import 'package:tapgo_user_app/main.dart';

/// Akar masalah (laporan Owner 22 Sep 2026): tile Super Menu untuk kategori
/// PPOB yang belum ada di katalog server (mis. BPJS/PDAM) diam-diam membuka
/// [PpobHomeScreen] — pengguna menekan "BPJS" tapi melihat grid kategori PPOB
/// umum tanpa penjelasan ("miss link"). Berkas ini mengunci PERILAKU
/// [tapGoOpenPpobCategory] langsung (bukan lewat Super Menu penuh), sehingga
/// tidak bergantung pada tampilan grid Super Menu yang bisa berubah.
List<dynamic> _catalogWith(List<String> codes) => codes
    .map(
      (code) => {
        'id': 'cat-$code',
        'code': code,
        'name': code,
        'products': <dynamic>[],
      },
    )
    .toList();

PpobRepository _repoReturning(List<dynamic> catalog) {
  return PpobRepository(
    catalogRequest: () async => catalog,
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

PpobRepository _repoThrowing(Object error) {
  return PpobRepository(
    catalogRequest: () async => throw error,
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

Future<void> _pumpOpener(
  WidgetTester tester,
  PpobRepository repository,
  String categoryCode,
  String label,
) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [ppobRepositoryProvider.overrideWithValue(repository)],
      child: MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () =>
                  tapGoOpenPpobCategory(context, categoryCode, label: label),
              child: const Text('buka'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('buka'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'kategori TERSEDIA di katalog: membuka PpobCategoryScreen (perilaku lama tetap)',
    (tester) async {
      await _pumpOpener(
        tester,
        _repoReturning(_catalogWith(['EWALLET'])),
        'EWALLET',
        'E-Wallet',
      );
      expect(find.byType(PpobCategoryScreen), findsOneWidget);
      expect(find.byType(PpobCategoryUnavailableScreen), findsNothing);
    },
  );

  testWidgets(
    'kategori TIDAK ADA di katalog (katalog berhasil dimuat): layar "belum tersedia" '
    'yang menyebut nama layanan, BUKAN diam-diam membuka grid PPOB umum',
    (tester) async {
      await _pumpOpener(
        tester,
        _repoReturning(_catalogWith(['PULSA', 'DATA'])), // tanpa BPJS
        'BPJS',
        'BPJS',
      );
      expect(find.byType(PpobCategoryUnavailableScreen), findsOneWidget);
      expect(find.text('BPJS belum tersedia'), findsOneWidget);
      expect(find.byType(PpobHomeScreen), findsNothing);
    },
  );

  testWidgets(
    'layar "belum tersedia" tetap memberi jalan keluar ke katalog PPOB yang aktif',
    (tester) async {
      await _pumpOpener(
        tester,
        _repoReturning(_catalogWith(['PULSA'])),
        'PDAM',
        'PDAM',
      );
      expect(find.text('PDAM belum tersedia'), findsOneWidget);
      await tester.tap(find.text('Buka Katalog PPOB'));
      await tester.pumpAndSettle();
      expect(find.byType(PpobHomeScreen), findsOneWidget);
      expect(find.byType(PpobCategoryUnavailableScreen), findsNothing);
    },
  );

  testWidgets(
    'katalog GAGAL DIMUAT (jaringan/server): jatuh ke beranda PPOB (ada tombol "Coba Lagi"), '
    'BUKAN ke layar "belum tersedia" yang keliru menyiratkan layanan memang ditutup',
    (tester) async {
      await _pumpOpener(
        tester,
        _repoThrowing(Exception('network down')),
        'EWALLET',
        'E-Wallet',
      );
      expect(find.byType(PpobHomeScreen), findsOneWidget);
      expect(find.byType(PpobCategoryUnavailableScreen), findsNothing);
    },
  );
}
