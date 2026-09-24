import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Verifikasi kepemilikan nomor HP: layar nyata + klien API nyata + server palsu.
Map<String, dynamic> status({bool phoneVerified = false}) => {
      'phone': {'masked': '0812****890', 'verified': phoneVerified},
      'email': {'masked': null, 'verified': false},
    };

Future<void> open(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1080, 2200);
  tester.view.devicePixelRatio = 2.75;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    const ProviderScope(child: MaterialApp(home: VerificationGateScreen())),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 200));
}

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  testWidgets(
      'status dimuat dari server, minta kode, kode salah format tidak menyentuh jaringan',
      (tester) async {
    final api = FakeApi({
      'GET /auth/verification/status': (_) => FakeReply.ok(status()),
      'POST /auth/verification/request': (_) => FakeReply.ok({'sent': true}),
    });
    tapGoSetHttpAdapterForTests(api);
    await open(tester);

    expect(api.callsTo('GET /auth/verification/status'), hasLength(1));
    await tester.tap(find.text('Kirim kode verifikasi').first);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    final request = api.callsTo('POST /auth/verification/request').single;
    expect(request.json['channel'], 'PHONE');

    await tester.enterText(
        find.widgetWithText(TextFormField, '000000').first, '12ab');
    await tester.tap(find.text('Verifikasi').first);
    await tester.pump();
    expect(find.text('Kode harus 6 digit angka.'), findsOneWidget);
    expect(api.callsTo('POST /auth/verification/confirm'), isEmpty);

    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('kode benar: nomor HP tertandai terverifikasi', (tester) async {
    final api = FakeApi({
      'GET /auth/verification/status': (_) => FakeReply.ok(status()),
      'POST /auth/verification/request': (_) => FakeReply.ok({'sent': true}),
      'POST /auth/verification/confirm': (_) =>
          FakeReply.ok({'verified': true}),
    });
    tapGoSetHttpAdapterForTests(api);
    await open(tester);
    await tester.tap(find.text('Kirim kode verifikasi').first);
    await tester.pump(const Duration(milliseconds: 200));
    await tester.enterText(
        find.widgetWithText(TextFormField, '000000').first, '123456');
    await tester.tap(find.text('Verifikasi').first);
    await tester.pump(const Duration(milliseconds: 200));

    final confirm = api.callsTo('POST /auth/verification/confirm').single;
    expect(confirm.json, {'channel': 'PHONE', 'code': '123456'});
    expect(find.text('Nomor HP terverifikasi'), findsOneWidget);
    expect(find.text('Lanjutkan'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
      'kesalahan verifikasi memakai kata "verifikasi", bukan "pemulihan"',
      (tester) async {
    final api = FakeApi({
      'GET /auth/verification/status': (_) => FakeReply.ok(status()),
      'POST /auth/verification/request': (_) => FakeReply.ok({'sent': true}),
      'POST /auth/verification/confirm': (_) =>
          FakeReply.error(400, 'SOMETHING_UNMAPPED', 'x'),
    });
    tapGoSetHttpAdapterForTests(api);
    await open(tester);
    await tester.tap(find.text('Kirim kode verifikasi').first);
    await tester.pump(const Duration(milliseconds: 200));
    await tester.enterText(
        find.widgetWithText(TextFormField, '000000').first, '123456');
    await tester.tap(find.text('Verifikasi').first);
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.textContaining('Pemulihan'), findsNothing);
    expect(find.textContaining('Verifikasi belum berhasil'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
      'server tidak terjangkau: pesan jaringan yang jelas dan layar tetap bisa dicoba lagi',
      (tester) async {
    final api = FakeApi({
      'GET /auth/verification/status': (_) => FakeReply.network(),
    });
    tapGoSetHttpAdapterForTests(api);
    await open(tester);
    expect(find.textContaining('belum dapat dihubungi'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
