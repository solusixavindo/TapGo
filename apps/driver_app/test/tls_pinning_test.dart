import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/core/security/tls_pinning.dart';

/// Sidik jari SHA-256 trust anchor yang dibundel. Nilai di sini diperiksa
/// terhadap sumber tepercaya (toko sertifikat sistem macOS untuk ISRG Root X1
/// dan X2; Root YE diautentikasi lewat tanda tangan Root X2) — lihat
/// docs/release/TLS_TRUST_ANCHORS.md. Tes ini menjaga agar isi anchor tidak
/// berubah tanpa disengaja.
const _expectedAnchorFingerprints = {
  '96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6', // ISRG Root X1
  '69:72:9B:8E:15:A8:6E:FC:17:7A:57:AF:B7:17:1D:FC:64:AD:D2:8C:2F:CA:8C:F1:50:7E:34:45:3C:CB:14:70', // ISRG Root X2
  '0F:C0:90:1C:CA:2B:AE:9E:9F:DB:B0:2D:50:D0:2F:10:94:F7:B3:66:72:08:69:91:B9:E8:97:62:6D:C4:85:F0', // Root YE
};

Future<String> _fingerprint(String pem) async {
  final process = await Process.start(
      'openssl', ['x509', '-noout', '-fingerprint', '-sha256']);
  process.stdin.write(pem);
  await process.stdin.close();
  final out = await utf8.decodeStream(process.stdout);
  await process.exitCode;
  return RegExp(r'Fingerprint=([0-9A-F:]+)').firstMatch(out)!.group(1)!;
}

class _FakeCertificate implements X509Certificate {
  _FakeCertificate(this.startValidity, this.endValidity);
  @override
  final DateTime startValidity;
  @override
  final DateTime endValidity;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('trust anchor yang dibundel', () {
    test('tepat tiga anchor dengan sidik jari yang diharapkan', () async {
      expect(kTapGoTrustAnchorPems, hasLength(3));
      final actual = <String>{};
      for (final pem in kTapGoTrustAnchorPems) {
        actual.add(await _fingerprint(pem));
      }
      expect(actual, _expectedAnchorFingerprints);
    });

    test('konteks dapat dibangun dari semua anchor (PEM valid)', () {
      expect(() => tapGoBuildTrustAnchorContext(kTapGoTrustAnchorPems),
          returnsNormally);
    });

    test('anchor yang rusak melempar galat, bukan diam-diam dilewati', () {
      expect(() => tapGoBuildTrustAnchorContext(['bukan pem']),
          throwsA(isA<Exception>()));
    });
  });

  group('tapGoClassifyRejectedCertificate', () {
    final now = DateTime.utc(2026, 10, 4, 12);

    test('sertifikat dalam masa berlaku tetapi ditolak = tidak dipercaya', () {
      final cert = _FakeCertificate(
          now.subtract(const Duration(days: 30)), now.add(const Duration(days: 30)));
      expect(tapGoClassifyRejectedCertificate(cert, now),
          TapGoCertificateRejection.untrusted);
    });

    test('sertifikat sudah kedaluwarsa (atau jam HP maju) = di luar masa berlaku', () {
      final cert = _FakeCertificate(
          now.subtract(const Duration(days: 90)), now.subtract(const Duration(days: 1)));
      expect(tapGoClassifyRejectedCertificate(cert, now),
          TapGoCertificateRejection.outsideValidity);
    });

    test('sertifikat belum berlaku (jam HP mundur) = di luar masa berlaku', () {
      final cert = _FakeCertificate(
          now.add(const Duration(days: 1)), now.add(const Duration(days: 90)));
      expect(tapGoClassifyRejectedCertificate(cert, now),
          TapGoCertificateRejection.outsideValidity);
    });
  });
}
