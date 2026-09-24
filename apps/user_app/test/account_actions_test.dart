import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Tindakan akun yang diwajibkan Play dan yang menyangkut keamanan: hapus akun
/// dan ubah password, lewat layar nyata + klien API nyata + server palsu.
Future<void> openScreen(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => screen),
                ),
                child: const Text('Buka'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Buka'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

Future<void> pumpFor(WidgetTester tester, [int ms = 600]) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  group('hapus akun', () {
    Future<void> requestDeletion(WidgetTester tester) async {
      await tester.enterText(find.byType(TextField).last, 'Tidak dipakai lagi');
      await tester.ensureVisible(find.text('Ajukan Penghapusan Akun'));
      await tester.tap(find.text('Ajukan Penghapusan Akun'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
    }

    testWidgets('konfirmasi lalu kirim: alasan terkirim, pesan sukses tampil',
        (tester) async {
      final api = FakeApi({
        'GET /account/delete-request': (_) => FakeReply.ok(null),
        'POST /account/delete-request': (_) =>
            FakeReply.ok({'id': 'del-1', 'status': 'PENDING'}),
      });
      tapGoSetHttpAdapterForTests(api);
      await openScreen(tester, const DeleteAccountRequestScreen());
      await requestDeletion(tester);

      expect(find.text('Konfirmasi hapus akun'), findsOneWidget);
      expect(api.callsTo('POST /account/delete-request'), isEmpty,
          reason: 'belum boleh terkirim sebelum dikonfirmasi');
      await tester.tap(find.text('Kirim Pengajuan'));
      await pumpFor(tester);

      final post = api.callsTo('POST /account/delete-request').single;
      expect(post.json['reason'], 'Tidak dipakai lagi');
      expect(
          find.text('Pengajuan hapus akun berhasil dikirim.'), findsOneWidget);
    });

    testWidgets('batal di dialog tidak mengirim apa pun', (tester) async {
      final api =
          FakeApi({'GET /account/delete-request': (_) => FakeReply.ok(null)});
      tapGoSetHttpAdapterForTests(api);
      await openScreen(tester, const DeleteAccountRequestScreen());
      await requestDeletion(tester);
      await tester.tap(find.text('Batal'));
      await pumpFor(tester);

      expect(api.callsTo('POST /account/delete-request'), isEmpty);
    });

    testWidgets('server gagal: pesan Indonesia, bukan teks mentah',
        (tester) async {
      final api = FakeApi({
        'GET /account/delete-request': (_) => FakeReply.ok(null),
        'POST /account/delete-request': (_) => FakeReply.error(
            500, 'INTERNAL_SERVER_ERROR', 'Unexpected server error'),
      });
      tapGoSetHttpAdapterForTests(api);
      await openScreen(tester, const DeleteAccountRequestScreen());
      await requestDeletion(tester);
      await tester.tap(find.text('Kirim Pengajuan'));
      await pumpFor(tester);

      expect(find.text('Pengajuan belum dapat dikirim. Silakan coba lagi.'),
          findsOneWidget);
      expect(find.textContaining('Unexpected'), findsNothing);
    });
  });

  group('ubah password lewat API nyata', () {
    Future<void> fillAndSave(WidgetTester tester) async {
      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'password-lama-1');
      await tester.enterText(fields.at(1), 'password-baru-22');
      await tester.enterText(fields.at(2), 'password-baru-22');
      await tester.ensureVisible(find.text('Simpan password'));
      await tester.tap(find.text('Simpan password'));
      await pumpFor(tester);
    }

    testWidgets('password lama salah: pesan khusus, sesi tidak diganggu',
        (tester) async {
      final api = FakeApi({
        'POST /auth/change-password': (_) => FakeReply.error(
            401, 'INVALID_CREDENTIALS', 'Invalid phone or password'),
      });
      tapGoSetHttpAdapterForTests(api);
      await openScreen(tester, const ChangePasswordScreen());
      await fillAndSave(tester);

      final call = api.callsTo('POST /auth/change-password').single;
      expect(call.json, {
        'currentPassword': 'password-lama-1',
        'newPassword': 'password-baru-22',
      });
      expect(find.text('Password saat ini salah.'), findsOneWidget);
      expect(find.byType(ChangePasswordScreen), findsOneWidget);
    });

    testWidgets(
        'konfirmasi tidak sama: ditolak di perangkat tanpa memanggil server',
        (tester) async {
      final api = FakeApi({});
      tapGoSetHttpAdapterForTests(api);
      await openScreen(tester, const ChangePasswordScreen());
      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'password-lama-1');
      await tester.enterText(fields.at(1), 'password-baru-22');
      await tester.enterText(fields.at(2), 'beda-sekali-33');
      await tester.ensureVisible(find.text('Simpan password'));
      await tester.tap(find.text('Simpan password'));
      await pumpFor(tester);

      expect(find.text('Konfirmasi password baru belum sama.'), findsOneWidget);
      expect(api.callsTo('POST /auth/change-password'), isEmpty);
    });
  });
}
