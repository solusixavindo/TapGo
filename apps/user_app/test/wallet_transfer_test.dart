import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Transfer saldo P2P: layar nyata + klien API nyata + server palsu.
/// Yang dijaga: validasi lokal sebelum jaringan, isi permintaan, idempotency
/// key yang sama saat mencoba ulang, satu permintaan saja pada ketukan ganda,
/// dan pesan error yang bisa ditindaklanjuti (tanpa teks mentah).
Future<void> openTransfer(WidgetTester tester, {int balance = 500000}) async {
  tester.view.physicalSize = const Size(1080, 2200);
  tester.view.devicePixelRatio = 2.75;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        tapGoSessionProviderForTest.overrideWith(
          (ref) => DemoClientSession.initial().copyWith(
            walletBalance: balance,
            accessToken: 'token-uji',
            isDemoMode: false,
          ),
        ),
      ],
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const WalletTransferScreen(),
                  ),
                ),
                child: const Text('Buka transfer'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Buka transfer'));
  await tester.pumpAndSettle();
}

Future<void> fill(WidgetTester tester,
    {String phone = '081234567890', String amount = '50000'}) async {
  final fields = find.byType(TextFormField);
  await tester.enterText(fields.at(0), phone);
  await tester.enterText(fields.at(1), amount);
  await tester.pump();
}

Future<void> submit(WidgetTester tester) async {
  await tester.tap(find.text('Kirim Transfer'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  testWidgets(
      'validasi lokal: nominal minimum, saldo kurang, HP kosong — tanpa jaringan',
      (tester) async {
    final api = FakeApi({});
    tapGoSetHttpAdapterForTests(api);
    await openTransfer(tester, balance: 30000);

    await submit(tester);
    expect(find.text('Nomor HP penerima wajib diisi'), findsOneWidget);

    await fill(tester, amount: '5000');
    await submit(tester);
    expect(find.text('Minimal transfer Rp10.000'), findsOneWidget);

    await fill(tester, amount: '50000');
    await submit(tester);
    expect(find.text('Saldo TapGoPay belum cukup'), findsOneWidget);

    expect(api.calls, isEmpty,
        reason: 'validasi gagal tidak boleh menyentuh server');
  });

  testWidgets('sukses: kirim isi yang benar lalu tutup layar dengan konfirmasi',
      (tester) async {
    final api = FakeApi({
      'POST /wallet/transfer': (_) => FakeReply.ok({'id': 'trf-1'}),
    });
    tapGoSetHttpAdapterForTests(api);
    await openTransfer(tester);
    await fill(tester, amount: '50000');
    await tester.enterText(
        find.byType(TextFormField).at(2), '  bayar patungan ');
    await submit(tester);
    await tester.pump(const Duration(milliseconds: 500));

    final calls = api.callsTo('POST /wallet/transfer').toList();
    expect(calls, hasLength(1));
    final body = calls.single.json;
    expect(body['amount'], 50000);
    expect(body['note'], 'bayar patungan');
    expect(body['recipientPhone'], isNotEmpty);
    expect(body['idempotencyKey'], startsWith('transfer-'));
    expect(calls.single.headers['Authorization'], 'Bearer token-uji');
    await tester.pumpAndSettle();
    expect(find.byType(WalletTransferScreen), findsNothing);
    expect(find.text('Transfer berhasil dikirim.'), findsOneWidget);
  });

  testWidgets(
      'gagal lalu coba lagi memakai idempotency key yang SAMA (bukan transfer baru)',
      (tester) async {
    var attempt = 0;
    final api = FakeApi({
      'POST /wallet/transfer': (_) =>
          ++attempt == 1 ? FakeReply.network() : FakeReply.ok({'id': 'trf-2'}),
    });
    tapGoSetHttpAdapterForTests(api);
    await openTransfer(tester);
    await fill(tester);

    await submit(tester);
    expect(find.text('Server TapGo belum dapat dihubungi. Silakan coba lagi.'),
        findsOneWidget);
    expect(find.byType(WalletTransferScreen), findsOneWidget);

    await submit(tester);
    final keys = api
        .callsTo('POST /wallet/transfer')
        .map((c) => c.json['idempotencyKey'])
        .toList();
    expect(keys, hasLength(2));
    expect(keys[0], keys[1]);
  });

  testWidgets('kode error server dipetakan ke pesan jelas, tanpa teks mentah',
      (tester) async {
    const cases = {
      'INSUFFICIENT_BALANCE': 'Saldo TapGoPay belum cukup.',
      'TRANSFER_RECIPIENT_NOT_FOUND': 'Nomor HP penerima tidak ditemukan.',
      'TRANSFER_SELF_NOT_ALLOWED': 'Tidak dapat transfer ke akun sendiri.',
      'TRANSFER_DAILY_LIMIT_EXCEEDED':
          'Batas transfer harian Anda sudah tercapai. Coba lagi besok.',
      'WALLET_TRANSFER_DISABLED': 'Fitur transfer belum tersedia saat ini.',
    };
    for (final entry in cases.entries) {
      final api = FakeApi({
        'POST /wallet/transfer': (_) =>
            FakeReply.error(422, entry.key, 'pesan server mentah'),
      });
      tapGoSetHttpAdapterForTests(api);
      await openTransfer(tester);
      await fill(tester);
      await submit(tester);
      expect(find.text(entry.value), findsOneWidget, reason: entry.key);
      expect(find.textContaining('DioException'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    }
  });

  testWidgets('ketukan ganda cepat hanya mengirim satu permintaan',
      (tester) async {
    final api = FakeApi({
      'POST /wallet/transfer': (_) => FakeReply.ok({'id': 'trf-3'}),
    });
    tapGoSetHttpAdapterForTests(api);
    await openTransfer(tester);
    await fill(tester);
    await tester.tap(find.text('Kirim Transfer'));
    await tester.tap(find.text('Kirim Transfer'), warnIfMissed: false);
    await tester.pump(const Duration(milliseconds: 400));
    expect(api.callsTo('POST /wallet/transfer'), hasLength(1));
  });
}
