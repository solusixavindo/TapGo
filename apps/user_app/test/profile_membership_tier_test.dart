import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir 3: akun Platinum harus menampilkan status Platinum di
/// halaman profil. Sebelumnya kepala Akun dan baris "Paket" di Profil bertuliskan tetap "Basic".
Map<String, dynamic> authReply() => {
      'user': {
        'id': 'user-1',
        'role': 'USER',
        'status': 'ACTIVE',
        'fullName': 'Mitra Platinum',
        'email': null,
        'phone': '081234567890',
        'referralCode': 'UJI123456',
      },
      'accessToken': 'access-uji',
      'refreshToken': 'refresh-uji',
    };

Map<String, FakeReply Function(FakeCall)> routesFor(String tier, String name) => {
      'GET /membership/me': (_) => FakeReply.ok({
            'membership': {
              'membership': {'tier': tier, 'name': name},
            },
          }),
      'GET /wallet': (_) => FakeReply.ok({'balance': 0, 'ppobBalance': 0}),
      'POST /auth/login': (_) => FakeReply.ok(authReply()),
    };

Future<void> loginAndOpenAccount(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const ProviderScope(child: TapGoUserApp()));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 5200));
  await tester.pumpAndSettle();
  final fields = find.byType(TextFormField);
  await tester.enterText(fields.at(0), '081234567890');
  await tester.enterText(fields.at(1), 'rahasia-uji-123');
  await tester.tap(find.text('Login').last);
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  await tester.tap(find.text('Akun'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoMemberIdentityLoaderForTests = null;
    tapGoDisablePersistenceForTests = false;
  });

  testWidgets('kepala Akun menampilkan Platinum untuk akun Platinum, bukan Basic',
      (tester) async {
    tapGoSetHttpAdapterForTests(FakeApi(routesFor('PLATINUM', 'Platinum')));
    await loginAndOpenAccount(tester);

    final header = find.byKey(const ValueKey('play_profile_header'));
    expect(header, findsOneWidget);
    expect(find.descendant(of: header, matching: find.text('Platinum')), findsOneWidget);
    expect(find.descendant(of: header, matching: find.text('Basic')), findsNothing);
  });

  testWidgets('kepala Akun tetap menampilkan Basic untuk akun Basic', (tester) async {
    tapGoSetHttpAdapterForTests(FakeApi(routesFor('BASIC', 'Basic')));
    await loginAndOpenAccount(tester);

    final header = find.byKey(const ValueKey('play_profile_header'));
    expect(find.descendant(of: header, matching: find.text('Basic')), findsOneWidget);
    expect(find.descendant(of: header, matching: find.text('Platinum')), findsNothing);
  });

  testWidgets('halaman Profil: baris Paket menampilkan Platinum dari identitas member',
      (tester) async {
    tapGoMemberIdentityLoaderForTests = () async => {
          'displayName': 'Mitra Platinum',
          'phone': '+6281234567890',
          'memberId': 'TGM-PLATINUM01',
          'membership': 'Platinum',
          'status': 'ACTIVE',
          'joinedAt': '2026-11-05T00:00:00.000Z',
        };
    tapGoSetHttpAdapterForTests(FakeApi(routesFor('PLATINUM', 'Platinum')));
    await loginAndOpenAccount(tester);

    await tester.ensureVisible(find.text('Profil'));
    await tester.tap(find.text('Profil'));
    await tester.pumpAndSettle();

    expect(find.text('Keanggotaan'), findsOneWidget);
    expect(find.text('Paket'), findsOneWidget);
    expect(find.text('Platinum'), findsWidgets);
    expect(find.text('Basic'), findsNothing);
  });
}
