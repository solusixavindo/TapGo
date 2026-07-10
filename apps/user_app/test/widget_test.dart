import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';

import 'package:tapgo_user_app/main.dart';

void main() {
  Future<void> openAuth(WidgetTester tester) async {
    tapGoDisablePersistenceForTests = true;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();
    await tester.pumpWidget(const ProviderScope(child: TapGoUserApp()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 5200));
    await tester.pump();
    await tester.pumpAndSettle();
  }

  Future<void> openDashboard(WidgetTester tester) async {
    tapGoDisablePersistenceForTests = true;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: TapGoDashboard(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('auth screen does not bypass backend login',
      (WidgetTester tester) async {
    await openAuth(tester);

    expect(find.text('TapGo Lion'), findsOneWidget);
    expect(find.text('Lanjutkan pratinjau aplikasi'), findsNothing);

    await tester.tap(find.text('Login').last);
    await tester.pump();

    expect(find.text('TapGoPay'), findsNothing);
  });

  testWidgets('staging register requires real data and hides preview bypass',
      (WidgetTester tester) async {
    await openAuth(tester);

    await tester.tap(find.text('Register'));
    await tester.pumpAndSettle();

    expect(find.text('Lanjutkan pratinjau aplikasi'), findsNothing);

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), '');
    await tester.enterText(fields.at(1), '');
    await tester.enterText(fields.at(2), '');
    await tester.ensureVisible(find.text('Register & Masuk'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Register & Masuk'));
    await tester.pumpAndSettle();

    expect(find.text('Nama wajib diisi'), findsOneWidget);
    expect(find.text('Nomor HP wajib diisi'), findsOneWidget);
    expect(find.text('Password wajib diisi'), findsOneWidget);
    expect(find.text('TapGoPay'), findsNothing);

    await tester.enterText(fields.at(0), 'UAT Member A');
    await tester.enterText(fields.at(1), '12345');
    await tester.enterText(fields.at(2), 'uat12345');
    await tester.ensureVisible(find.text('Register & Masuk'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Register & Masuk'));
    await tester.pumpAndSettle();

    expect(find.text('Nomor HP tidak valid'), findsOneWidget);
    expect(find.text('TapGoPay'), findsNothing);
  });

  testWidgets('dashboard membership remains reachable without marketing plan',
      (WidgetTester tester) async {
    await openDashboard(tester);

    expect(find.text('Marketing Plan'), findsNothing);
    await tester.ensureVisible(find.text('Membership').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Membership').first);
    await tester.pumpAndSettle();

    expect(find.text('Basic'), findsWidgets);
    expect(find.text('Silver'), findsWidgets);
    expect(find.text('Platinum'), findsWidgets);
  });

  testWidgets('bottom navigation tabs and super menu are clickable',
      (WidgetTester tester) async {
    await openDashboard(tester);

    await tester.tap(find.text('Aktivitas'));
    await tester.pumpAndSettle();
    expect(find.text('Data belum tersedia'), findsOneWidget);

    await tester.tap(find.text('Chat'));
    await tester.pumpAndSettle();
    expect(find.text('Belum ada pesan'), findsOneWidget);

    await tester.tap(find.text('Akun'));
    await tester.pumpAndSettle();
    expect(find.text('Membership Saya'), findsOneWidget);
    expect(find.text('Copy referral link'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.apps_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Super Menu'), findsOneWidget);
    expect(find.text('TapGo Ride'), findsOneWidget);
    expect(find.text('PPOB'), findsOneWidget);
    expect(find.text('Membership'), findsOneWidget);
    expect(find.text('Support'), findsOneWidget);
  });

  testWidgets('referral tree uses realistic names in widget test mode',
      (WidgetTester tester) async {
    await openDashboard(tester);

    await tester.tap(find.text('Akun'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Jaringan Saya'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Jaringan Saya'));
    await tester.pumpAndSettle();

    expect(find.text('Solusi Digital'), findsOneWidget);
    expect(find.text('Budi Santoso'), findsOneWidget);
    expect(find.text('Andi Budi'), findsOneWidget);

    await tester.tap(find.text('Budi Santoso'));
    await tester.pumpAndSettle();
    expect(find.text('Andi Budi'), findsNothing);

    await tester.tap(find.text('Budi Santoso'));
    await tester.pumpAndSettle();
    expect(find.text('Andi Budi'), findsOneWidget);
  });

  testWidgets('user account does not expose admin dashboard',
      (WidgetTester tester) async {
    await openDashboard(tester);

    await tester.tap(find.text('Akun'));
    await tester.pumpAndSettle();

    expect(find.text('Admin Console'), findsNothing);
    expect(find.text('Admin Dashboard'), findsNothing);
    expect(find.text('Super Admin Dashboard'), findsNothing);
  });

  testWidgets('client membership flow reaches payment success',
      (WidgetTester tester) async {
    await openDashboard(tester);

    await tester.ensureVisible(find.text('Membership'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Membership').first);
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Platinum'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Daftar').last);
    await tester.tap(find.text('Daftar').last);
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Upload KTP'));
    final registrationFields = find.byType(TextFormField);
    await tester.enterText(registrationFields.at(0), 'UAT Member Platinum');
    await tester.enterText(registrationFields.at(1), '081234567891');
    await tester.enterText(registrationFields.at(2), 'member@tapgo.id');
    await tester.enterText(
      registrationFields.at(3),
      'Jalan UAT TapGo No. 1',
    );
    await tester.enterText(registrationFields.at(4), '3174010101900001');
    await tester.enterText(registrationFields.at(5), 'Jakarta');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byIcon(Icons.date_range_rounded));
    await tester.tap(find.byIcon(Icons.date_range_rounded));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Upload KTP'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Upload KTP'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilih dari Galeri'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Upload Foto Diri'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pilih dari Galeri'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Lanjut ke checkout'));
    await tester.tap(find.text('Lanjut ke checkout'));
    await tester.pumpAndSettle();

    expect(find.text('Menunggu Pembayaran'), findsOneWidget);
    expect(find.text('Bayar Sekarang'), findsOneWidget);

    await tester.tap(find.text('Kirim Notifikasi WhatsApp'));
    await tester.pumpAndSettle();
    expect(find.text('Preview WhatsApp'), findsOneWidget);
    await tester.tapAt(const Offset(20, 20));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Bayar Sekarang'));
    await tester.pumpAndSettle();
    expect(find.text('Payment Sandbox'), findsOneWidget);
    await tester.ensureVisible(find.text('Bayar'));
    await tester.tap(find.text('Bayar'));
    await tester.pumpAndSettle();

    expect(find.text('Pendaftaran Berhasil'), findsOneWidget);
    await tester.tap(find.text('Kembali ke dashboard'));
    await tester.pumpAndSettle();
    expect(find.text('Paket aktif: Platinum'), findsOneWidget);
  });
}

class _FakeImagePickerPlatform extends ImagePickerPlatform {
  @override
  Future<XFile?> getImageFromSource({
    required ImageSource source,
    ImagePickerOptions options = const ImagePickerOptions(),
  }) async {
    return XFile(
      '/tmp/tapgo-${source.name}.jpg',
      name: source == ImageSource.gallery
          ? 'tapgo-galeri-test.jpg'
          : 'tapgo-kamera-test.jpg',
    );
  }
}
