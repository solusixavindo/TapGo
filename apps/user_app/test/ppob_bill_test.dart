// PPOB pascabayar (BPJS, PDAM): daftar produk, cek tagihan, bayar. Repository
// di-fake pada port boundary (wire typedefs), tanpa jaringan.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/application/ppob_providers.dart';
import 'package:tapgo_user_app/features/ppob/data/ppob_repository.dart';
import 'package:tapgo_user_app/features/ppob/domain/ppob_models.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_bill_screens.dart';
import 'package:tapgo_user_app/main.dart';

class _Wires {
  List<Map<String, dynamic>> products = [
    {'sku': 'PSC_PDAM1', 'name': 'PDAM KOTA CONTOH', 'brand': 'PDAM', 'category': 'PDAM', 'targetLabel': 'ID Pelanggan PDAM'},
    {'sku': 'PSC_PDAM2', 'name': 'PDAM KABUPATEN DEMO', 'brand': 'PDAM', 'category': 'PDAM', 'targetLabel': 'ID Pelanggan PDAM'},
    {'sku': 'PSC_BPJS', 'name': 'BPJS KESEHATAN', 'brand': 'BPJS KESEHATAN', 'category': 'BPJS', 'targetLabel': 'Nomor VA BPJS'},
  ];
  final productQueries = <String?>[];
  Object? inquiryError;
  Object? payError;
  bool sufficient = true;
  DateTime? expiresAt;
  String payStatus = 'SUCCESS';
  int inquiryCalls = 0;
  final payCalls = <({String reference, String key})>[];
  final inquiryTargets = <String>[];
}

PpobRepository _repo(_Wires w) => PpobRepository(
      catalogRequest: () async => [],
      inquiryRequest: ({required sku, required targetNumber}) async =>
          throw UnimplementedError(),
      createOrderRequest: ({required sku, required targetNumber, required idempotencyKey}) async =>
          throw UnimplementedError(),
      ordersRequest: () async => [],
      billProductsRequest: ({required category, query}) async {
        w.productQueries.add(query);
        return [
          for (final p in w.products)
            if (p['category'] == category &&
                (query == null || (p['name'] as String).toLowerCase().contains(query.toLowerCase())))
              p,
        ];
      },
      billInquiryRequest: ({required sku, required targetNumber}) async {
        w.inquiryCalls += 1;
        w.inquiryTargets.add(targetNumber);
        if (w.inquiryError != null) throw w.inquiryError!;
        return {
          'reference': 'PPB-A2B3C4D5E${w.inquiryCalls}',
          'product': {'sku': sku, 'name': 'BPJS KESEHATAN'},
          'targetNumber': targetNumber,
          'customerName': 'BUDI SANTOSO',
          'period': '202610',
          'billAmount': 100000,
          'feeAmount': 2350,
          'totalAmount': 102350,
          'expiresAt': (w.expiresAt ?? DateTime.now().add(const Duration(minutes: 10))).toUtc().toIso8601String(),
          'wallet': {'ppobBalance': w.sufficient ? 500000 : 1000},
          'sufficient': w.sufficient,
        };
      },
      billPayRequest: ({required reference, required idempotencyKey}) async {
        w.payCalls.add((reference: reference, key: idempotencyKey));
        if (w.payError != null) throw w.payError!;
        return {
          'id': reference,
          'status': w.payStatus,
          'sku': 'PSC_BPJS',
          'productName': 'BPJS KESEHATAN',
          'categoryCode': 'BPJS',
          'targetNumber': '1234567890123',
          'amount': 102350,
          'benefitAmount': 102350,
          'balanceAmount': 0,
        };
      },
    );

Future<void> _pump(WidgetTester tester, _Wires w, Widget home) async {
  await tester.pumpWidget(ProviderScope(
    overrides: [ppobRepositoryProvider.overrideWithValue(_repo(w))],
    child: MaterialApp(home: home),
  ));
  await tester.pumpAndSettle();
}

const _bpjsProduct = PpobBillProduct(
  sku: 'PSC_BPJS',
  name: 'BPJS KESEHATAN',
  category: 'BPJS',
  targetLabel: 'Nomor VA BPJS',
);

void main() {
  superMenuIllustrationTests();

  group('daftar produk', () {
    testWidgets('PDAM: daftar dengan pencarian per nama daerah', (tester) async {
      final w = _Wires();
      await _pump(tester, w, const PpobBillProductsScreen(categoryCode: 'PDAM', title: 'PDAM'));
      expect(find.byKey(const ValueKey('bill-product-PSC_PDAM1')), findsOneWidget);
      expect(find.byKey(const ValueKey('bill-product-PSC_PDAM2')), findsOneWidget);
      expect(find.byKey(const ValueKey('bill-product-PSC_BPJS')), findsNothing);

      await tester.enterText(find.byKey(const ValueKey('bill-search')), 'kabupaten');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(w.productQueries.last, 'kabupaten');
      expect(find.byKey(const ValueKey('bill-product-PSC_PDAM1')), findsNothing);
      expect(find.byKey(const ValueKey('bill-product-PSC_PDAM2')), findsOneWidget);

      await tester.enterText(find.byKey(const ValueKey('bill-search')), 'tidakada');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(find.text('Tidak ditemukan'), findsOneWidget);
    });

    testWidgets('BPJS satu produk: langsung ke isian nomor, tanpa daftar', (tester) async {
      await _pump(tester, _Wires(), const PpobBillProductsScreen(categoryCode: 'BPJS', title: 'BPJS'));
      expect(find.byType(PpobBillScreen), findsOneWidget);
      expect(find.byKey(const ValueKey('bill-target')), findsOneWidget);
    });

    testWidgets('katalog kosong: pesan belum tersedia, bukan layar kosong', (tester) async {
      final w = _Wires()..products = [];
      await _pump(tester, w, const PpobBillProductsScreen(categoryCode: 'PDAM', title: 'PDAM'));
      expect(find.text('PDAM belum tersedia'), findsOneWidget);
    });

    testWidgets('server tidak tersedia: pesan Indonesia dengan tombol Coba Lagi', (tester) async {
      final repo = PpobRepository(
        catalogRequest: () async => [],
        inquiryRequest: ({required sku, required targetNumber}) async => throw UnimplementedError(),
        createOrderRequest: ({required sku, required targetNumber, required idempotencyKey}) async => throw UnimplementedError(),
        ordersRequest: () async => [],
      ); // tanpa wire pascabayar: kegagalan tertata, bukan crash
      await tester.pumpWidget(ProviderScope(
        overrides: [ppobRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(home: PpobBillProductsScreen(categoryCode: 'PDAM', title: 'PDAM')),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Coba Lagi'), findsOneWidget);
      expect(find.text('Gagal memuat PDAM'), findsOneWidget);
    });
  });

  group('cek tagihan dan bayar', () {
    testWidgets('nomor BPJS harus 13 digit sebelum Cek Tagihan aktif', (tester) async {
      final w = _Wires();
      await _pump(tester, w, const PpobBillScreen(product: _bpjsProduct));
      FilledButton button() => tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button().onPressed, isNull);
      await tester.enterText(find.byKey(const ValueKey('bill-target')), '12345');
      await tester.pump();
      expect(button().onPressed, isNull);
      await tester.enterText(find.byKey(const ValueKey('bill-target')), '1234 5678-90123');
      await tester.pump();
      expect(button().onPressed, isNotNull);
      await tester.tap(find.byType(FilledButton));
      await tester.pumpAndSettle();
      // Spasi dan strip dibuang sebelum dikirim.
      expect(w.inquiryTargets, ['1234567890123']);
    });

    testWidgets('rincian tagihan tampil dari angka server; bayar mengirim hanya referensi dan kunci tetap', (tester) async {
      final w = _Wires();
      await _pump(tester, w, const PpobBillScreen(product: _bpjsProduct));
      await tester.enterText(find.byKey(const ValueKey('bill-target')), '1234567890123');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('bill-check')));
      await tester.pumpAndSettle();

      expect(find.text('BUDI SANTOSO'), findsOneWidget);
      expect(find.text('Rp100.000'), findsOneWidget);
      expect(find.text('Rp2.350'), findsOneWidget);
      expect(find.text('Rp102.350'), findsOneWidget);
      expect(find.text('Biaya admin & layanan'), findsOneWidget);
      expect(w.payCalls, isEmpty);

      await tester.tap(find.byKey(const ValueKey('bill-pay')));
      await tester.pumpAndSettle();
      expect(w.payCalls, hasLength(1));
      expect(w.payCalls.single.reference, 'PPB-A2B3C4D5E1');
      expect(w.payCalls.single.key, 'ppob-bill-PPB-A2B3C4D5E1');
      expect(find.byKey(const ValueKey('bill-result')), findsOneWidget);
      expect(find.text('Tagihan berhasil dibayar.'), findsOneWidget);
      // Setelah dibayar tidak ada tombol bayar lagi (tidak bisa dibayar dua kali).
      expect(find.byKey(const ValueKey('bill-pay')), findsNothing);
    });

    testWidgets('saldo tidak cukup: peringatan dan tombol bayar nonaktif', (tester) async {
      final w = _Wires()..sufficient = false;
      await _pump(tester, w, const PpobBillScreen(product: _bpjsProduct));
      await tester.enterText(find.byKey(const ValueKey('bill-target')), '1234567890123');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('bill-check')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Saldo benefit PPOB tidak cukup'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    });

    testWidgets('cek tagihan gagal: pesan server berbahasa Indonesia tampil, tanpa tagihan', (tester) async {
      final w = _Wires()
        ..inquiryError = const PpobApiException(
          code: 'PPOB_BILL_INQUIRY_FAILED',
          message: 'Tagihan belum tersedia atau sudah dibayar untuk periode ini.',
          statusCode: 422,
        );
      await _pump(tester, w, const PpobBillScreen(product: _bpjsProduct));
      await tester.enterText(find.byKey(const ValueKey('bill-target')), '1234567890123');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('bill-check')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('bill-error')), findsOneWidget);
      expect(find.textContaining('belum tersedia atau sudah dibayar'), findsOneWidget);
      expect(find.byKey(const ValueKey('bill-card')), findsNothing);
    });

    testWidgets('tagihan kedaluwarsa: bayar tidak ditawarkan, harus cek lagi; tidak ada panggilan bayar', (tester) async {
      final w = _Wires()..expiresAt = DateTime.now().subtract(const Duration(seconds: 5));
      await _pump(tester, w, const PpobBillScreen(product: _bpjsProduct));
      await tester.enterText(find.byKey(const ValueKey('bill-target')), '1234567890123');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('bill-check')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('bill-expired')), findsOneWidget);
      expect(find.byKey(const ValueKey('bill-pay')), findsNothing);
      expect(find.text('Cek Tagihan Lagi'), findsOneWidget);
      expect(w.payCalls, isEmpty);
    });

    testWidgets('bayar gagal (jaringan): pesan tampil dan mengulang memakai kunci yang SAMA', (tester) async {
      final w = _Wires()
        ..payError = const PpobApiException(code: 'NETWORK_ERROR', message: 'Koneksi ke server gagal.');
      await _pump(tester, w, const PpobBillScreen(product: _bpjsProduct));
      await tester.enterText(find.byKey(const ValueKey('bill-target')), '1234567890123');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('bill-check')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('bill-pay')));
      await tester.pumpAndSettle();
      expect(find.text('Koneksi ke server gagal.'), findsOneWidget);
      w.payError = null;
      await tester.tap(find.byKey(const ValueKey('bill-pay')));
      await tester.pumpAndSettle();
      expect(w.payCalls, hasLength(2));
      expect(w.payCalls[0].key, w.payCalls[1].key);
      expect(w.payCalls[0].reference, w.payCalls[1].reference);
    });

    testWidgets('status diproses dan gagal dijelaskan jujur (tidak menyatakan sukses)', (tester) async {
      for (final (status, text) in [
        ('PROCESSING', 'sedang diproses penyedia'),
        ('FAILED', 'dana dikembalikan penuh'),
      ]) {
        final w = _Wires()..payStatus = status;
        // Layar baru tiap putaran (state lama tidak boleh terbawa).
        await tester.pumpWidget(const SizedBox.shrink());
        await _pump(tester, w, const PpobBillScreen(product: _bpjsProduct));
        await tester.enterText(find.byKey(const ValueKey('bill-target')), '1234567890123');
        await tester.pump();
        await tester.tap(find.byKey(const ValueKey('bill-check')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('bill-pay')));
        await tester.pumpAndSettle();
        expect(find.textContaining(text), findsOneWidget, reason: status);
        expect(find.text('Tagihan berhasil dibayar.'), findsNothing, reason: status);
      }
    });

    testWidgets('mengubah nomor setelah cek tagihan membuang tagihan lama', (tester) async {
      final w = _Wires();
      await _pump(tester, w, const PpobBillScreen(product: _bpjsProduct));
      await tester.enterText(find.byKey(const ValueKey('bill-target')), '1234567890123');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('bill-check')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('bill-card')), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('bill-target')), '1234567890124');
      await tester.pump();
      expect(find.byKey(const ValueKey('bill-card')), findsNothing);
      expect(find.byKey(const ValueKey('bill-pay')), findsNothing);
    });
  });

  testWidgets('saldo PPOB kurang saat bayar (balapan saldo): pesan jelas, bukan galat generik', (tester) async {
    final w = _Wires()
      ..payError = const PpobApiException(
        code: 'INSUFFICIENT_PPOB_BALANCE',
        message: 'Saldo PPOB tidak mencukupi',
        statusCode: 400,
      );
    await _pump(tester, w, const PpobBillScreen(product: _bpjsProduct));
    await tester.enterText(find.byKey(const ValueKey('bill-target')), '1234567890123');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('bill-check')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('bill-pay')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Saldo benefit PPOB tidak cukup'), findsWidgets);
    expect(find.text('Terjadi kesalahan. Silakan coba lagi.'), findsNothing);
  });

  test('jam HP salah tidak memengaruhi kedaluwarsa: batas dihitung dari sisa detik server', () {
    // expiresAt di masa lalu menurut jam HP (HP berjam mundur/maju), tetapi server
    // menyatakan masih 9 menit.
    final inquiry = PpobBillInquiry.fromJson({
      'reference': 'PPB-X',
      'customerName': 'A',
      'billAmount': 1,
      'feeAmount': 1,
      'totalAmount': 2,
      'sufficient': true,
      'expiresAt': '2020-01-01T00:00:00.000Z',
      'expiresInSeconds': 540,
    });
    expect(inquiry.isExpiredAt(DateTime.now()), isFalse);
    expect(inquiry.isExpiredAt(DateTime.now().add(const Duration(minutes: 10))), isTrue);
  });

  test('model PpobBillInquiry: kedaluwarsa dihitung terhadap waktu yang diberikan', () {
    final inquiry = PpobBillInquiry.fromJson({
      'reference': 'PPB-X',
      'customerName': 'A',
      'billAmount': '100000.00',
      'feeAmount': 2350,
      'totalAmount': 102350,
      'sufficient': true,
      'expiresAt': '2026-10-06T10:00:00.000Z',
    });
    expect(inquiry.billAmount, 100000);
    expect(inquiry.isExpiredAt(DateTime.utc(2026, 10, 6, 9, 59)), isFalse);
    expect(inquiry.isExpiredAt(DateTime.utc(2026, 10, 6, 10, 0)), isTrue);
  });
}

// Tile Super Menu harus memakai ilustrasi bergaya sama (aset SVG), bukan ikon
// Material generik: laporan Owner 6 Okt 2026 ("ikon harus mengikuti gaya yang sudah diterapkan").
void superMenuIllustrationTests() {
  test('setiap tile layanan Super Menu punya ilustrasi SVG yang benar-benar ada', () {
    const accountTiles = {'Kartu Anggota', 'Profil', 'Tiket Bantuan', 'Hapus Akun'};
    final labels = tapGoSuperMenuLabelsForTests().where((l) => !accountTiles.contains(l));
    expect(labels, isNotEmpty);
    final assets = <String>{};
    for (final label in labels) {
      final asset = tapGoServiceIllustrationAssetForTests(label);
      expect(asset, isNotNull, reason: '$label memakai ikon generik');
      expect(File(asset!).existsSync(), isTrue, reason: '$label: $asset tidak ada');
      expect(assets.add(asset), isTrue, reason: '$label berbagi ikon dengan tile lain: $asset');
    }
  });
}
