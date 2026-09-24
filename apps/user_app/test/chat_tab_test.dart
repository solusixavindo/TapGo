import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Tab Chat: percakapan bantuan (tiket dukungan) yang nyata, bukan kotak cari
/// dan janji notifikasi yang tidak berfungsi.
Future<void> openChat(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    const ProviderScope(child: MaterialApp(home: Scaffold(body: ChatScreen()))),
  );
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  tearDown(() => tapGoSupportTicketsLoaderForTests = null);

  testWidgets('menampilkan tiket bantuan terbaru', (tester) async {
    tapGoSupportTicketsLoaderForTests = () async => [
          {
            'id': 't1',
            'reference': 'TKT-1',
            'subject': 'Pulsa belum masuk',
            'status': 'OPEN'
          },
          {
            'id': 't2',
            'reference': 'TKT-2',
            'subject': 'Ganti nomor',
            'status': 'RESOLVED'
          },
        ];
    await openChat(tester);

    expect(find.text('Pulsa belum masuk'), findsOneWidget);
    expect(find.text('TKT-1 • Terbuka'), findsOneWidget);
    expect(find.text('TKT-2 • Selesai'), findsOneWidget);
    expect(find.text('Hubungi Bantuan'), findsOneWidget);
    expect(find.textContaining('Cari chat'), findsNothing);
    expect(find.textContaining('notifikasi'), findsNothing);
  });

  testWidgets('belum ada tiket: ajakan yang jelas', (tester) async {
    tapGoSupportTicketsLoaderForTests = () async => [];
    await openChat(tester);
    expect(find.text('Belum ada percakapan'), findsOneWidget);
  });

  testWidgets('gagal memuat: pesan dan tombol muat ulang', (tester) async {
    tapGoSupportTicketsLoaderForTests = () async => throw StateError('mati');
    await openChat(tester);
    expect(find.text('Percakapan belum tersedia'), findsOneWidget);
    expect(find.text('Hubungi Bantuan'), findsOneWidget);
  });

  testWidgets('Hubungi Bantuan membuka layar tiket bantuan', (tester) async {
    tapGoSupportTicketsLoaderForTests = () async => [];
    await openChat(tester);
    await tester.tap(find.text('Hubungi Bantuan'));
    await tester.pumpAndSettle();
    expect(find.byType(ContactUsScreen), findsOneWidget);
  });
}
