import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Pendaftaran dan masuk adalah satu-satunya pintu akun baru di aplikasi Play:
/// layar nyata + klien API nyata + server palsu.
Map<String, dynamic> authReply(String name) => {
      'user': {
        'id': 'user-1',
        'role': 'USER',
        'status': 'ACTIVE',
        'fullName': name,
        'email': null,
        'phone': '081234567890',
        'referralCode': 'UJI123456',
      },
      'accessToken': 'access-uji',
      'refreshToken': 'refresh-uji',
    };

final dashboardRoutes = <String, FakeReply Function(FakeCall)>{
  'GET /membership/me': (_) => FakeReply.ok({
        'membership': {
          'membership': {'tier': 'BASIC', 'name': 'Basic'},
        },
      }),
  'GET /wallet': (_) => FakeReply.ok({'balance': 0, 'ppobBalance': 0}),
};

Future<void> openAuth(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const ProviderScope(child: TapGoUserApp()));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 5200));
  await tester.pumpAndSettle();
}

Future<void> submitRegister(
  WidgetTester tester, {
  String name = 'Pengguna Uji',
  String phone = '081234567890',
  String password = 'rahasia-uji-123',
}) async {
  await tester.tap(find.text('Register').first);
  await tester.pumpAndSettle();
  final fields = find.byType(TextFormField);
  await tester.enterText(fields.at(0), name);
  await tester.enterText(fields.at(1), phone);
  await tester.enterText(fields.last, password);
  await tester.ensureVisible(find.text('Register & Masuk'));
  await tester.tap(find.text('Register & Masuk'));
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  testWidgets(
      'daftar berhasil: isi permintaan benar, tanpa referral, masuk ke beranda',
      (tester) async {
    final api = FakeApi({
      ...dashboardRoutes,
      'POST /auth/register': (_) => FakeReply.ok(authReply('Pengguna Uji')),
    });
    tapGoSetHttpAdapterForTests(api);
    await openAuth(tester);
    await submitRegister(tester);

    final call = api.callsTo('POST /auth/register').single;
    expect(call.json['fullName'], 'Pengguna Uji');
    expect(call.json['phone'], isNotEmpty);
    expect(call.json['password'], 'rahasia-uji-123');
    expect(call.json.containsKey('referralCode'), isFalse);
    expect(call.json.containsKey('role'), isFalse,
        reason: 'klien tidak boleh memilih role');
    expect(call.json['deviceId'], isNotEmpty);
    expect(call.headers['X-TapGo-Distribution'], 'play');
    expect(find.byType(AuthScreen), findsNothing);
    expect(find.textContaining('Halo, Pengguna Uji'), findsOneWidget);
    expect(find.text('Basic'), findsWidgets);
  });

  testWidgets('nomor HP sudah terdaftar: pesan jelas dan tetap di layar daftar',
      (tester) async {
    final api = FakeApi({
      'POST /auth/register': (_) => FakeReply.error(
          409, 'PHONE_ALREADY_REGISTERED', 'Phone already registered'),
    });
    tapGoSetHttpAdapterForTests(api);
    await openAuth(tester);
    await submitRegister(tester);

    expect(find.text('Nomor HP sudah terdaftar. Silakan pilih Login.'),
        findsOneWidget);
    expect(find.textContaining('Phone already'), findsNothing);
    expect(find.byType(AuthScreen), findsOneWidget);
  });

  testWidgets(
      'password terlalu pendek ditolak di perangkat, server tidak dipanggil',
      (tester) async {
    final api = FakeApi({});
    tapGoSetHttpAdapterForTests(api);
    await openAuth(tester);
    await submitRegister(tester, password: '123');

    expect(api.callsTo('POST /auth/register'), isEmpty);
    expect(find.byType(AuthScreen), findsOneWidget);
  });

  testWidgets('masuk berhasil: beranda menampilkan nama dari server',
      (tester) async {
    final api = FakeApi({
      ...dashboardRoutes,
      'POST /auth/login': (_) => FakeReply.ok(authReply('Budi Santoso')),
    });
    tapGoSetHttpAdapterForTests(api);
    await openAuth(tester);
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), '081234567890');
    await tester.enterText(fields.at(1), 'rahasia-uji-123');
    await tester.tap(find.text('Login').last);
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }

    expect(api.callsTo('POST /auth/login'), hasLength(1));
    expect(find.textContaining('Halo, Budi Santoso'), findsOneWidget);
  });
}
