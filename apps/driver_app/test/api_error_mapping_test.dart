import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/main.dart';

/// Tes ujung-ke-ujung galat jaringan driver_app.
///
/// Riwayat: APK 1.0.0+4 sampai +7 menampilkan "Koneksi belum stabil" karena
/// pinning SPKI leaf lewat badCertificateCallback tidak pernah cocok terhadap
/// rantai produksi: dengan SecurityContext(withTrustedRoots: false), callback
/// menerima sertifikat TERATAS rantai yang gagal diverifikasi (ISRG Root X2),
/// bukan leaf. Uji lama memakai SATU sertifikat self-signed (leaf = satu-satunya
/// sertifikat) sehingga cacat itu tidak pernah terlihat.
///
/// Desain sekarang: sertifikat CA dipasang sebagai satu-satunya trust anchor.
/// Tes ini memakai server HTTPS lokal sungguhan dengan rantai SEBENARNYA
/// (CA sintetis + leaf bertanda tangan CA, SAN localhost) yang dibuat `openssl`
/// saat tes berjalan (tidak ada kunci privat di repo), jadi yang diuji adalah
/// handshake dart:io yang sebenarnya, bukan tiruan.

const _loginOk = {
  'success': true,
  'data': {
    'accessToken': 'access-token-uji',
    'refreshToken': 'refresh-token-uji',
    'user': {'fullName': 'Driver Uji'},
  },
};

/// CA sintetis dan leaf bertanda tangan CA itu (CN dan SAN `localhost`).
class _TestPki {
  _TestPki(this.caPem, this.leafCertPath, this.leafKeyPath);
  final String caPem;
  final String leafCertPath;
  final String leafKeyPath;
}

Future<void> _openssl(List<String> args) async {
  final result = await Process.run('openssl', args);
  if (result.exitCode != 0) {
    fail('openssl ${args.take(2).join(' ')} gagal: ${result.stderr}');
  }
}

Future<_TestPki> _makePki(Directory dir, String name) async {
  final d = dir.path;
  File('$d/$name-ca.cnf').writeAsStringSync(
      '[req]\ndistinguished_name=dn\n[dn]\n[v3_ca]\n'
      'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  File('$d/$name-leaf.cnf').writeAsStringSync(
      'subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\n'
      'extendedKeyUsage=serverAuth\n');
  await _openssl([
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', //
    '-keyout', '$d/$name-ca.key', '-out', '$d/$name-ca.crt', '-days', '2',
    '-subj', '/CN=TapGo-Test-CA-$name', '-config', '$d/$name-ca.cnf',
    '-extensions', 'v3_ca',
  ]);
  await _openssl([
    'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', '$d/$name-leaf.key',
    '-out', '$d/$name-leaf.csr', '-subj', '/CN=localhost',
  ]);
  await _openssl([
    'x509', '-req', '-in', '$d/$name-leaf.csr', '-CA', '$d/$name-ca.crt',
    '-CAkey', '$d/$name-ca.key', '-CAcreateserial', '-out',
    '$d/$name-leaf.crt', '-days', '2', '-extfile', '$d/$name-leaf.cnf',
  ]);
  return _TestPki(File('$d/$name-ca.crt').readAsStringSync(),
      '$d/$name-leaf.crt', '$d/$name-leaf.key');
}

Future<HttpServer> _httpsServer(_TestPki pki) async {
  final context = SecurityContext()
    ..useCertificateChain(pki.leafCertPath)
    ..usePrivateKey(pki.leafKeyPath);
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
  List<String>? anchors,
  String host = 'localhost',
}) {
  return ApiDriverRepository(
    baseUrl: '${https ? 'https' : 'http'}://$host:${server.port}/api/v1',
    storage: MemorySessionStore(),
    enforceTlsPinning: enforce,
    tlsTrustAnchorsOverride: anchors,
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
  late _TestPki pkiA;
  late _TestPki pkiB;
  final servers = <HttpServer>[];

  setUpAll(() async {
    certDir = await Directory.systemTemp.createTemp('tapgo-tls-test');
    pkiA = await _makePki(certDir, 'a');
    pkiB = await _makePki(certDir, 'b');
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

  group('trust-anchor pinning pada handshake sungguhan', () {
    test('anchor = CA yang menandatangani server: login berhasil', () async {
      final server = await track(_httpsServer(pkiA));
      final repo = _repo(server, https: true, enforce: true, anchors: [pkiA.caPem]);
      final session =
          await repo.login(phone: '081234567890', password: 'password-uji');
      expect(session.accessToken, 'access-token-uji');
    });

    test('anchor = CA lain ditolak sebagai TLS_PIN_MISMATCH dengan pesan yang jelas',
        () async {
      final server = await track(_httpsServer(pkiA));
      final repo = _repo(server, https: true, enforce: true, anchors: [pkiB.caPem]);
      final error = await _loginFailure(repo);
      expect(error.code, 'TLS_PIN_MISMATCH');
      expect(error.message, isNot(contains('Koneksi belum stabil')));
      expect(error.message, contains('Perbarui'));
      expect(error.statusCode, isNull);
    });

    test('beberapa anchor: cukup satu yang menandatangani server', () async {
      final server = await track(_httpsServer(pkiA));
      final repo = _repo(server,
          https: true, enforce: true, anchors: [pkiB.caPem, pkiA.caPem]);
      final session =
          await repo.login(phone: '081234567890', password: 'password-uji');
      expect(session.accessToken, 'access-token-uji');
    });

    test('sertifikat sah tetapi untuk host lain ditolak (hostname diperiksa)',
        () async {
      // Leaf hanya bertanda SAN localhost; dihubungi lewat 127.0.0.1. Tanpa
      // pemeriksaan hostname, siapa pun dengan sertifikat dari CA yang sama
      // untuk domain lain dapat menyamar.
      final server = await track(_httpsServer(pkiA));
      final repo = _repo(server,
          https: true, enforce: true, anchors: [pkiA.caPem], host: '127.0.0.1');
      final error = await _loginFailure(repo);
      expect(error.code, startsWith('TLS_'));
    });

    test('anchor kosong pada build rilis: fail-closed dengan kode TLS_PIN_NOT_CONFIGURED',
        () async {
      final server = await track(_httpsServer(pkiA));
      final repo = _repo(server, https: true, enforce: true, anchors: <String>[]);
      final error = await _loginFailure(repo);
      expect(error.code, 'TLS_PIN_NOT_CONFIGURED');
      expect(error.message, isNot(contains('Koneksi belum stabil')));
    });

    test('kegagalan TLS yang BUKAN penolakan sertifikat (pinning aktif) menjadi TLS_CERTIFICATE_INVALID',
        () async {
      // Handshake gagal sebelum callback sertifikat sempat dipanggil (server
      // HTTP biasa dihubungi lewat https). Pesan "perbarui dari Google Play"
      // hanya untuk sertifikat yang tidak dipercaya.
      final plain = await track(_httpServer(200, {'success': true}));
      final repo = _repo(plain, https: true, enforce: true, anchors: [pkiA.caPem]);
      final error = await _loginFailure(repo);
      expect(error.code, 'TLS_CERTIFICATE_INVALID');
      expect(error.message, contains('tanggal dan jam'));
      expect(error.message, contains('belum tentu'));
      expect(error.message, isNot(contains('Google Play')));
    });

    test('tanpa pinning (debug), sertifikat dari CA tak dikenal tetap ditolak sebagai galat TLS',
        () async {
      // Memastikan kegagalan sertifikat BUKAN dilebur menjadi NETWORK_ERROR
      // walau pinning tidak aktif.
      final server = await track(_httpsServer(pkiA));
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
