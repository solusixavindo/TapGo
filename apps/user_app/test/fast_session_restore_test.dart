import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/widgets.dart';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Server palsu yang menahan jawaban /auth/me sampai [meGate] diselesaikan (meniru jaringan lambat).
class _GatedApi extends FakeApi {
  _GatedApi(super.routes);
  final Completer<void> meGate = Completer<void>();

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.uri.path.endsWith('/auth/me')) await meGate.future;
    return super.fetch(options, requestStream, cancelFuture);
  }
}

const _meOk = {
  'id': 'user-uji',
  'role': 'USER',
  'status': 'ACTIVE',
  'fullName': 'Pengguna Uji',
  'phone': '+6281200000001',
  'email': null,
  'referralCode': 'UJI001',
};

void _seedLoggedInStorage() {
  final session = DemoClientSession.initial().copyWith(
    userId: 'user-uji',
    userName: 'Pengguna Uji',
    phone: '+6281200000001',
    isDemoMode: false,
  );
  FlutterSecureStorage.setMockInitialValues({
    'tapgo.demo.authenticated.v1': 'true',
    'tapgo.demo.session.v1': jsonEncode(tapGoSessionToJsonForTests(session)),
    'tapgo.auth.access_token.v1': 'access-tersimpan',
    'tapgo.auth.refresh_token.v1': 'refresh-tersimpan',
  });
  SharedPreferences.setMockInitialValues({});
}

Future<void> _pumpApp(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const ProviderScope(child: TapGoUserApp()));
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Membongkar aplikasi dan menghabiskan timer yang masih menunggu (layar sambutan, animasi) agar tes bersih.
Future<void> _drain(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump(const Duration(seconds: 6));
}

/// Buka aplikasi dengan sesi tersimpan: beranda tampil segera dari data tersimpan, tanpa menunggu putaran jaringan
/// /auth/me (layar putih berputar ~5 detik pada uji HP Owner 16 Okt 2026). Pemeriksaan ke server berjalan di latar belakang.
void main() {
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  testWidgets('beranda tampil SEBELUM /auth/me dijawab; pemeriksaan sesi tetap berjalan di latar belakang',
      (tester) async {
    tapGoDisablePersistenceForTests = false;
    _seedLoggedInStorage();
    final api = _GatedApi({
      'GET /auth/me': (_) => FakeReply.ok(_meOk),
      'GET /membership/me': (_) => FakeReply.ok({'tier': 'BASIC', 'name': 'Basic'}),
      'GET /wallet': (_) => FakeReply.ok({'balance': 0, 'ppobBalance': 0}),
    });
    tapGoSetHttpAdapterForTests(api);

    await _pumpApp(tester);
    expect(api.meGate.isCompleted, isFalse, reason: 'server belum menjawab /auth/me');
    expect(find.byType(TapGoDashboard), findsOneWidget,
        reason: 'beranda harus sudah tampil dari sesi tersimpan');
    expect(find.byType(AuthScreen), findsNothing);

    // Jawaban datang: sesi tetap sah, beranda tetap, dan /auth/me hanya diminta sekali oleh pemulihan.
    api.meGate.complete();
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.byType(TapGoDashboard), findsOneWidget);
    expect(api.callsTo('GET /auth/me'), hasLength(1));
    await _drain(tester);
  });

  testWidgets('server menolak sesi (401 dan refresh ditolak): beranda sementara berganti ke layar masuk',
      (tester) async {
    tapGoDisablePersistenceForTests = false;
    _seedLoggedInStorage();
    final api = _GatedApi({
      'GET /auth/me': (_) => FakeReply.error(401, 'AUTH_SESSION_REVOKED'),
      'POST /auth/refresh': (_) => FakeReply.error(401, 'AUTH_SESSION_REVOKED'),
      'GET /membership/me': (_) => FakeReply.error(401, 'AUTH_SESSION_REVOKED'),
      'GET /wallet': (_) => FakeReply.error(401, 'AUTH_SESSION_REVOKED'),
    });
    tapGoSetHttpAdapterForTests(api);

    await _pumpApp(tester);
    expect(find.byType(TapGoDashboard), findsOneWidget);

    api.meGate.complete();
    for (var i = 0; i < 40; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.byType(TapGoDashboard), findsNothing,
        reason: 'sesi yang ditolak server tidak boleh tetap di beranda');
    await _drain(tester);
  });

  testWidgets('tanpa sesi tersimpan: tetap ke layar sambutan, tidak ke beranda', (tester) async {
    tapGoDisablePersistenceForTests = false;
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
    final api = _GatedApi({});
    tapGoSetHttpAdapterForTests(api);
    await _pumpApp(tester);
    expect(find.byType(TapGoDashboard), findsNothing);
    await _drain(tester);
  });
}
