import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/main.dart';

/// Tes ujung-ke-ujung galat jaringan driver_app (regresi APK +4, 4 Okt 2026).
///
/// Penyebab APK +4 menampilkan "Koneksi belum stabil" di layar login: pin TLS
/// yang dibakar ke APK tidak cocok lagi dengan sertifikat server (Let's
/// Encrypt memutar kunci leaf tiap perpanjangan), sehingga SETIAP permintaan
/// gagal handshake, dan semua kegagalan itu dilebur menjadi NETWORK_ERROR.
/// Tes ini memakai server HTTPS lokal sungguhan + sertifikat sintetis yang
/// dibuat `openssl` saat tes berjalan (tidak ada kunci privat di repo), jadi
/// yang diuji adalah handshake dart:io yang sebenarnya, bukan tiruan.

const _loginOk = {
  'success': true,
  'data': {
    'accessToken': 'access-token-uji',
    'refreshToken': 'refresh-token-uji',
    'user': {'fullName': 'Driver Uji'},
  },
};

class _SyntheticCert {
  _SyntheticCert(this.certPath, this.keyPath, this.spkiSha256Hex);
  final String certPath;
  final String keyPath;
  final String spkiSha256Hex;
}

/// Hash SPKI dihitung lewat openssl (alat independen), BUKAN lewat fungsi
/// tapGoExtractSubjectPublicKeyInfoDer yang sedang diuji.
Future<_SyntheticCert> _makeCert(Directory dir, String name) async {
  final cert = '${dir.path}/$name.crt';
  final key = '${dir.path}/$name.key';
  final gen = await Process.run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', //
    '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=localhost',
  ]);
  if (gen.exitCode != 0) {
    fail('openssl req gagal: ${gen.stderr}');
  }
  final hash = await Process.run('sh', [
    '-c',
    'openssl x509 -in "$cert" -pubkey -noout | '
        'openssl pkey -pubin -outform der | openssl dgst -sha256',
  ]);
  if (hash.exitCode != 0) {
    fail('openssl dgst gagal: ${hash.stderr}');
  }
  final hex = RegExp(r'[0-9a-f]{64}').firstMatch('${hash.stdout}')!.group(0)!;
  return _SyntheticCert(cert, key, hex);
}

Future<HttpServer> _httpsServer(_SyntheticCert cert) async {
  final context = SecurityContext()
    ..useCertificateChain(cert.certPath)
    ..usePrivateKey(cert.keyPath);
  final server = await HttpServer.bindSecure('127.0.0.1', 0, context);
  server.listen(_respondLoginOk);
  return server;
}

void _respondLoginOk(HttpRequest request) {
  request.response
    ..statusCode = 200
    ..headers.contentType = ContentType.json
    ..write(jsonEncode(_loginOk));
  request.response.close();
}

Future<HttpServer> _httpServer(
    int status, Map<String, Object?> body) async {
  final server = await HttpServer.bind('127.0.0.1', 0);
  server.listen((request) {
    request.response
      ..statusCode = status
      ..headers.contentType = ContentType.json
      ..write(jsonEncode(body));
    request.response.close();
  });
  return server;
}

ApiDriverRepository _repo(
  HttpServer server, {
  required bool https,
  bool enforce = false,
  Set<String>? pins,
}) {
  return ApiDriverRepository(
    baseUrl: '${https ? 'https' : 'http'}://localhost:${server.port}/api/v1',
    storage: MemorySessionStore(),
    enforceTlsPinning: enforce,
    tlsPinsOverride: pins,
  );
}

Future<DriverApiException> _loginFailure(ApiDriverRepository repo) async {
  try {
    await repo.login(phone: '081234567890', password: 'password-uji');
  } on DriverApiException catch (error) {
    return error;
  }
  fail('login seharusnya melempar DriverApiException');
}

void main() {
  walletTopUpUrlTests();
  late Directory certDir;
  late _SyntheticCert certA;
  late _SyntheticCert certB;
  final servers = <HttpServer>[];

  setUpAll(() async {
    certDir = await Directory.systemTemp.createTemp('tapgo-tls-test');
    certA = await _makeCert(certDir, 'a');
    certB = await _makeCert(certDir, 'b');
  });

  tearDownAll(() async {
    await certDir.delete(recursive: true);
  });

  tearDown(() async {
    for (final server in servers) {
      await server.close(force: true);
    }
    servers.clear();
  });

  Future<HttpServer> track(Future<HttpServer> pending) async {
    final server = await pending;
    servers.add(server);
    return server;
  }

  group('TLS pinning pada handshake sungguhan', () {
    test('pin cocok dengan SPKI server: login berhasil', () async {
      final server = await track(_httpsServer(certA));
      final repo = _repo(server,
          https: true, enforce: true, pins: {certA.spkiSha256Hex});
      final session =
          await repo.login(phone: '081234567890', password: 'password-uji');
      expect(session.accessToken, 'access-token-uji');
    });

    test('pin basi (SPKI lain) ditolak dengan kode dan pesan yang jelas',
        () async {
      // Persis skenario APK +4: server memakai kunci baru, pin di APK kunci lama.
      final server = await track(_httpsServer(certA));
      final repo = _repo(server,
          https: true, enforce: true, pins: {certB.spkiSha256Hex});
      final error = await _loginFailure(repo);
      expect(error.code, 'TLS_PIN_MISMATCH');
      expect(error.message, isNot(contains('Koneksi belum stabil')));
      expect(error.message, contains('Perbarui'));
      expect(error.statusCode, isNull);
    });

    test('pin kosong pada build rilis: fail-closed dengan kode TLS_PIN_NOT_CONFIGURED',
        () async {
      final server = await track(_httpsServer(certA));
      final repo = _repo(server, https: true, enforce: true, pins: <String>{});
      final error = await _loginFailure(repo);
      expect(error.code, 'TLS_PIN_NOT_CONFIGURED');
      expect(error.message, isNot(contains('Koneksi belum stabil')));
    });

    test('tanpa pinning (debug), sertifikat self-signed tetap ditolak sebagai galat TLS',
        () async {
      // Memastikan kegagalan sertifikat BUKAN lagi dilebur menjadi NETWORK_ERROR
      // walau pinning tidak aktif.
      final server = await track(_httpsServer(certA));
      final repo = _repo(server, https: true, enforce: false);
      final error = await _loginFailure(repo);
      expect(error.code, 'TLS_CERTIFICATE_INVALID');
      expect(error.message, isNot(contains('Koneksi belum stabil')));
    });
  });

  group('pemetaan galat respons server', () {
    test('401 INVALID_CREDENTIALS berbahasa Inggris dipetakan ke pesan Indonesia',
        () async {
      final server = await track(_httpServer(401, {
        'success': false,
        'code': 'INVALID_CREDENTIALS',
        'message': 'Invalid phone or password',
      }));
      final error = await _loginFailure(_repo(server, https: false));
      expect(error.statusCode, 401);
      expect(error.code, 'INVALID_CREDENTIALS');
      expect(error.message, 'Nomor HP atau password salah.');
    });

    test('404 ROUTE_NOT_FOUND tidak menampilkan pesan mentah Inggris', () async {
      final server = await track(_httpServer(404, {
        'success': false,
        'code': 'ROUTE_NOT_FOUND',
        'message': 'Route POST /api/v1/rides/driver/sos not found',
      }));
      final error = await _loginFailure(_repo(server, https: false));
      expect(error.code, 'ROUTE_NOT_FOUND');
      expect(error.message, isNot(contains('Route')));
      expect(error.message, contains('belum tersedia'));
    });

    test('400 VALIDATION_ERROR dipetakan ke pesan Indonesia', () async {
      final server = await track(_httpServer(400, {
        'success': false,
        'code': 'VALIDATION_ERROR',
        'message': 'Request validation failed',
      }));
      final error = await _loginFailure(_repo(server, https: false));
      expect(error.message, isNot(contains('validation')));
      expect(error.message, contains('tidak valid'));
    });

    test('403 ACCOUNT_INACTIVE dipetakan ke pesan Indonesia', () async {
      final server = await track(_httpServer(403, {
        'success': false,
        'code': 'ACCOUNT_INACTIVE',
        'message': 'Account is not active',
      }));
      final error = await _loginFailure(_repo(server, https: false));
      expect(error.message, 'Akun Anda tidak aktif. Hubungi dukungan TapGo.');
    });

    test('kode rate limit lain juga dipetakan ke pesan Indonesia', () async {
      for (final code in [
        'AUTH_RECOVERY_RATE_LIMITED',
        'REGISTER_PHONE_RATE_LIMITED',
      ]) {
        final server = await track(_httpServer(429, {
          'success': false,
          'code': code,
          'message': 'Too many requests',
        }));
        final error = await _loginFailure(_repo(server, https: false));
        expect(error.message, contains('Terlalu banyak percobaan'),
            reason: code);
      }
    });

    test('server mati tetap dipetakan ke NETWORK_ERROR "Koneksi belum stabil"',
        () async {
      final server = await _httpServer(200, _loginOk);
      final repo = _repo(server, https: false);
      await server.close(force: true);
      final error = await _loginFailure(repo);
      expect(error.code, 'NETWORK_ERROR');
      expect(error.message, 'Koneksi belum stabil. Silakan coba lagi.');
    });
  });
}

void walletTopUpUrlTests() {
  group('DriverWalletSummary.topUpUrl hanya menerima tautan tapgolion.id', () {
    const fallback = 'https://tapgolion.id/topup';
    String parse(Object? url) => DriverWalletSummary.fromJson({
          'balance': 0,
          if (url != null) 'topUpUrl': url,
        }).topUpUrl;

    test('tautan sah diteruskan apa adanya', () {
      expect(parse('https://tapgolion.id/topup'), 'https://tapgolion.id/topup');
      expect(parse('https://www.tapgolion.id/topup?x=1'),
          'https://www.tapgolion.id/topup?x=1');
    });

    test('skema bukan https, host asing, atau mirip-mirip jatuh ke bawaan', () {
      for (final bad in [
        'http://tapgolion.id/topup',
        'javascript:alert(1)',
        'intent://evil#Intent;scheme=http;end',
        'https://evil.example/topup',
        'https://tapgolion.id.evil.example/topup',
        'https://eviltapgolion.id/topup',
        'https://user@evil.example/',
        '',
        'bukan url',
      ]) {
        expect(parse(bad), fallback, reason: bad);
      }
    });

    test('tanpa topUpUrl memakai bawaan', () {
      expect(parse(null), fallback);
    });
  });
}
