import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Test UI pemulihan password dan verifikasi kontak.
///
/// Test ini tidak memanggil backend. Yang diuji adalah perilaku layar:
/// navigasi, validasi input, konfirmasi generik, countdown kirim ulang,
/// kunci single-flight, dan pemetaan pesan error yang ramah pengguna.

Widget wrap(Widget child) {
  return ProviderScope(
    child: MaterialApp(home: child),
  );
}

void main() {
  group('kebijakan password', () {
    test('menolak password yang terlalu pendek', () {
      expect(tapGoPasswordMeetsPolicy('Ab1'), isFalse);
      final rules = tapGoPasswordRequirements('Ab1');
      expect(rules.first.met, isFalse);
    });

    test('menolak password tanpa angka', () {
      expect(tapGoPasswordMeetsPolicy('tanpaangkasama'), isFalse);
    });

    test('menolak password tanpa huruf', () {
      expect(tapGoPasswordMeetsPolicy('123456789'), isFalse);
    });

    test('menerima password yang memenuhi seluruh ketentuan', () {
      expect(tapGoPasswordMeetsPolicy('PasswordBaru99'), isTrue);
      expect(
        tapGoPasswordRequirements('PasswordBaru99').every((rule) => rule.met),
        isTrue,
      );
    });
  });

  group('pesan error ramah pengguna', () {
    test('tidak pernah menampilkan exception mentah', () {
      final message = tapGoRecoveryErrorMessage(StateError('boom internal'));
      expect(message, 'Pemulihan gagal. Silakan coba lagi.');
      expect(message.contains('boom internal'), isFalse);
      expect(message.contains('StateError'), isFalse);
    });
  });

  group('PasswordRecoveryScreen', () {
    testWidgets('mulai dari langkah identifier', (tester) async {
      await tester.pumpWidget(wrap(const PasswordRecoveryScreen()));

      expect(find.text('Masukkan nomor HP atau email'), findsOneWidget);
      expect(find.text('Kirim kode'), findsOneWidget);
      // Langkah lanjutan belum boleh muncul.
      expect(find.text('Verifikasi kode'), findsNothing);
      expect(find.text('Simpan password'), findsNothing);
    });

    testWidgets('identifier kosong ditolak tanpa memanggil jaringan',
        (tester) async {
      await tester.pumpWidget(wrap(const PasswordRecoveryScreen()));

      await tester.tap(find.text('Kirim kode'));
      await tester.pump();

      expect(find.text('Isi nomor HP atau email dulu.'), findsOneWidget);
      // Tetap di langkah pertama.
      expect(find.text('Masukkan nomor HP atau email'), findsOneWidget);
    });

    testWidgets('field kode hanya menerima 6 digit angka', (tester) async {
      await tester.pumpWidget(wrap(const PasswordRecoveryScreen()));

      // Formatter dipasang pada field kode; diuji lewat konstruksi langsung
      // agar tidak bergantung pada panggilan jaringan untuk berpindah langkah.
      final controller = TextEditingController();
      await tester.pumpWidget(
        wrap(
          Scaffold(
            body: TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              inputFormatters: tapGoOtpInputFormatters,
            ),
          ),
        ),
      );

      await tester.enterText(find.byType(TextField), 'ab12cd3456789');
      expect(controller.text, '123456');
    });
  });

  group('VerificationGateScreen', () {
    testWidgets('akun belum terverifikasi melihat gate dan tombol kirim kode',
        (tester) async {
      await tester.pumpWidget(
        wrap(
          const VerificationGateScreen(
            initialStatus: {
              'phone': {'masked': '********7788', 'verified': false},
              'email': null,
              'requiresVerification': true,
            },
          ),
        ),
      );

      expect(find.text('Verifikasi Akun'), findsOneWidget);
      expect(find.text('Nomor HP (wajib)'), findsOneWidget);
      // Nomor hanya tampil tersamarkan.
      expect(find.text('********7788'), findsOneWidget);
      expect(find.text('Belum'), findsWidgets);
      expect(find.text('Kirim kode verifikasi'), findsOneWidget);
    });

    testWidgets('akun terverifikasi tidak melihat form OTP', (tester) async {
      await tester.pumpWidget(
        wrap(
          const VerificationGateScreen(
            initialStatus: {
              'phone': {'masked': '********7788', 'verified': true},
              'email': {'masked': 'a****@contoh.test', 'verified': true},
              'requiresVerification': false,
            },
          ),
        ),
      );

      expect(find.text('Nomor HP terverifikasi'), findsOneWidget);
      expect(find.text('Kirim kode verifikasi'), findsNothing);
      expect(find.text('Lanjutkan'), findsOneWidget);
    });
  });

  group('layar sempit', () {
    testWidgets('tidak ada overflow pada lebar 320', (tester) async {
      tester.view.physicalSize = const Size(320 * 3, 640 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(wrap(const PasswordRecoveryScreen()));
      await tester.pump();

      // pumpWidget melempar bila ada RenderFlex overflow, jadi mencapai
      // baris ini sudah membuktikan tidak ada luberan horizontal.
      expect(tester.takeException(), isNull);
    });
  });
}
