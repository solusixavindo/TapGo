import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/services/tls_pinning.dart';

/// Byte DER sertifikat X.509 yang dipakai sebagai vektor uji ekstraksi
/// SubjectPublicKeyInfo (M4). Intermediate CA Let's Encrypt (YE1) adalah
/// sertifikat publik; leaf dan RSA dibuat lokal. Hash pembanding di setiap
/// test dihitung independen lewat openssl — bukan disalin dari kode yang
/// sedang diuji.
///
/// Sertifikat EC sintetis yang dibuat lokal (`openssl ecparam` + `openssl req
/// -x509`), BUKAN milik server produksi — kunci privatnya dibuang. Dipakai
/// sebagai vektor "leaf" (algoritma EC). Hash SPKI dihitung independen lewat
/// `openssl x509 -pubkey -noout | openssl pkey -pubin -outform der |
/// openssl dgst -sha256`. Vektor produksi sebelumnya dilepas (4 Okt 2026):
/// leaf Let's Encrypt diputar tiap perpanjangan, jadi tidak boleh ada nilai
/// pin produksi tertanam di repo.
const _leafCertificateDerBase64 =
    'MIIBMTCB2AIJAK1+GnEUhES3MAoGCCqGSM49BAMCMCAxHjAcBgNVBAMMFXRhcGdv'
    'LXRlc3QtZWMtZml4dHVyZTAgFw0yNjEwMDQxMDM5NTVaGA8yMTI2MDkxMDEwMzk1'
    'NVowIDEeMBwGA1UEAwwVdGFwZ28tdGVzdC1lYy1maXh0dXJlMFkwEwYHKoZIzj0C'
    'AQYIKoZIzj0DAQcDQgAEmsw9EeG4ZrTtgdifUh4NQRJHl3nBFWN6u2SwOYDcQW9q'
    'tgnBlAUK+H/OKRbOfZBt5lq2beynLHo1XGqaIJlmfTAKBggqhkjOPQQDAgNIADBF'
    'AiEA7jeuM56lm7xJ5cRQGBULxcAzwi7uj+sroSyME2rMwJcCIFsB3U88OZPekeLF'
    'LP8pXGziusWotHxn1phX74cXDjvW';
const _leafSpkiSha256Hex =
    '0676ac80ef648960d90979c5c219f4974fbecb9deb2cb7c71ac92d72ca960e53';

const _intermediateCertificateDerBase64 =
    'MIICizCCAhGgAwIBAgIQXd1w3TH4AchcGGp6BLgK/jAKBggqhkjOPQQDAzAuMQsw'
    'CQYDVQQGEwJVUzENMAsGA1UEChMESVNSRzEQMA4GA1UEAxMHUm9vdCBZRTAeFw0y'
    'NTA5MDMwMDAwMDBaFw0yODA5MDIyMzU5NTlaMDMxCzAJBgNVBAYTAlVTMRYwFAYD'
    'VQQKEw1MZXQncyBFbmNyeXB0MQwwCgYDVQQDEwNZRTEwdjAQBgcqhkjOPQIBBgUr'
    'gQQAIgNiAAQHZVB1/mimla2hfSurylScjPMZaOJXLz/NnAc2sylm8WDyhU9Ccp+z'
    'ASQi5vSwGGJjSGklkD9fdPR8GpyDIOIjCEfrnbt/v+ZSEPLLEGbaM6EccDbN7p9x'
    'teIm2Avf+ryjge4wgeswDgYDVR0PAQH/BAQDAgGGMBMGA1UdJQQMMAoGCCsGAQUF'
    'BwMBMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0OBBYEFLsgykcL/tflnPmPCSqj'
    'jDdFsbzYMB8GA1UdIwQYMBaAFKPIJlqOoUzQNWP8myPIOq5W809WMDIGCCsGAQUF'
    'BwEBBCYwJDAiBggrBgEFBQcwAoYWaHR0cDovL3llLmkubGVuY3Iub3JnLzATBgNV'
    'HSAEDDAKMAgGBmeBDAECATAnBgNVHR8EIDAeMBygGqAYhhZodHRwOi8veWUuYy5s'
    'ZW5jci5vcmcvMAoGCCqGSM49BAMDA2gAMGUCMQDgjUEahFT/h3DRakqiPZpLvPgf'
    'Zwkt6K2EOMmh1nvEzl83eMLYcod4GCl3b0J1Nn0CMBNYmEQJb4CEG5WoOe7aRn/L'
    'VKu6saHmHEynI7ysIPd8zQsK1HdmhlHKlw9Z5GpGvA==';
const _intermediateSpkiSha256Hex =
    '6ebcefb4210b088654a38b03fea3d7d1c711b4fb1ddc363a45f9b1a4e53da01e';

/// Sertifikat self-signed RSA yang dibuat lokal (`openssl req -x509`), bukan
/// dari server produksi — dipakai untuk membuktikan ekstraksi SPKI tidak
/// bergantung pada algoritma kunci (EC di dua vektor di atas, RSA di sini).
const _selfSignedRsaCertificateDerBase64 =
    'MIICtjCCAZ4CCQCLliT8YtSUTzANBgkqhkiG9w0BAQsFADAdMRswGQYDVQQDDBJ0'
    'YXBnby10ZXN0LWZpeHR1cmUwHhcNMjYwOTMwMDkxODM4WhcNMjYxMDAxMDkxODM4'
    'WjAdMRswGQYDVQQDDBJ0YXBnby10ZXN0LWZpeHR1cmUwggEiMA0GCSqGSIb3DQEB'
    'AQUAA4IBDwAwggEKAoIBAQCzYnP7UJVq6Xr6wjW9LWZXcP25H5Z9WySm6rmLnSNh'
    'o4OwmwEsYKGDcvvtVfH8SWbghin2wQoMcNJePHodOuusuae6siMU05Nd/WWTG1Pc'
    'fgspuTwHpVwXWxFLX37MkS+zfCbpO8lXL8PrVyCRUzGAecnlGMa2XF8r8227cKrp'
    'M9709dLmuUuJlxZX+CjsLXCd1IHbzyoKWz5vc+RDXXSUTi4JS3fHXoBlDMv75GjY'
    '8W1PIxBL++yp/UB1TRXC93W7W2PWuK/bk4GbMJb41b9gRDYrHhA2R6cE1PakQVYq'
    '0OBRXp+3xpU1dTKG7Y7oBAOtMTJmkJS0/KEgopouwyrfAgMBAAEwDQYJKoZIhvcN'
    'AQELBQADggEBALD2X0JtA7OyEAoaYUCNH9zeb+Sm1MAu6GTX8RKJiKZl3IIQibbP'
    'h4XfD0AwgquQzo4PX1hi88nRImsSv8GTn19CAHEQhrYfsm3RXZQSYR06JM6EsztA'
    'Z+AXXT+BCLbgWz95fQShn4dGxUqIV2Ukfx7cWFHkubF0aF3AVRWRNkxcLyKFs7BC'
    'ztvsdkCT/NjW1562YY3A6WrDU5yM+71w6v2GWHkrnQ7au6dv6tDIAekTsxdwWZ8g'
    'hf7r/mUw4VPFkFIUiEcHtbG+GB649AVa2r7dJ3A5fplGw/jAvERRZhkh3Y6g7opB'
    'xJlsKLXjTlXppWqPhQqQkT2nfqTbk2qefG8=';
const _selfSignedRsaSpkiSha256Hex =
    '136e2d8ab763ac185b5c5f99be047d315f11e4438388477ac2fdf84b789c1c83';

Uint8List _decode(String base64Der) => base64.decode(base64Der);

void main() {
  group('tapGoExtractSubjectPublicKeyInfoDer', () {
    test('mengambil SPKI dari sertifikat leaf sintetis (EC)', () {
      final spki = tapGoExtractSubjectPublicKeyInfoDer(_decode(_leafCertificateDerBase64));
      expect(spki, isNotNull);
      expect(tapGoSha256Hex(spki!), _leafSpkiSha256Hex);
    });

    test('mengambil SPKI dari sertifikat intermediate CA produksi (EC, Let\'s Encrypt YE1)', () {
      final spki = tapGoExtractSubjectPublicKeyInfoDer(_decode(_intermediateCertificateDerBase64));
      expect(spki, isNotNull);
      expect(tapGoSha256Hex(spki!), _intermediateSpkiSha256Hex);
    });

    test('mengambil SPKI dari sertifikat self-signed RSA (algoritma kunci berbeda)', () {
      final spki = tapGoExtractSubjectPublicKeyInfoDer(_decode(_selfSignedRsaCertificateDerBase64));
      expect(spki, isNotNull);
      expect(tapGoSha256Hex(spki!), _selfSignedRsaSpkiSha256Hex);
    });

    test('mengembalikan null untuk byte yang bukan sertifikat DER', () {
      final garbage = Uint8List.fromList(List<int>.generate(40, (i) => i));
      expect(tapGoExtractSubjectPublicKeyInfoDer(garbage), isNull);
    });

    test('mengembalikan null untuk buffer kosong', () {
      expect(tapGoExtractSubjectPublicKeyInfoDer(Uint8List(0)), isNull);
    });

    test('mengembalikan null untuk SEQUENCE terpotong (length melebihi buffer)', () {
      final leaf = _decode(_leafCertificateDerBase64);
      final truncated = Uint8List.sublistView(leaf, 0, 50);
      expect(tapGoExtractSubjectPublicKeyInfoDer(truncated), isNull);
    });
  });

  group('tapGoCertificateMatchesPins', () {
    final leafDer = _decode(_leafCertificateDerBase64);

    test('cocok ketika hash SPKI ada di daftar pin', () {
      final matches = tapGoCertificateMatchesPins(
        leafDer,
        allowedSpkiSha256Hex: {_leafSpkiSha256Hex, _intermediateSpkiSha256Hex},
      );
      expect(matches, isTrue);
    });

    test('tidak cocok ketika hash SPKI bukan milik pin manapun', () {
      final matches = tapGoCertificateMatchesPins(
        leafDer,
        allowedSpkiSha256Hex: {_intermediateSpkiSha256Hex, _selfSignedRsaSpkiSha256Hex},
      );
      expect(matches, isFalse);
    });

    test('fail-closed: daftar pin kosong selalu dianggap tidak cocok', () {
      final matches = tapGoCertificateMatchesPins(leafDer, allowedSpkiSha256Hex: {});
      expect(matches, isFalse);
    });

    test('fail-closed: sertifikat yang gagal diurai selalu dianggap tidak cocok', () {
      final matches = tapGoCertificateMatchesPins(
        Uint8List.fromList([1, 2, 3]),
        allowedSpkiSha256Hex: {_leafSpkiSha256Hex},
      );
      expect(matches, isFalse);
    });
  });

  group('tapGoShouldAcceptPinnedCertificate', () {
    final leafDer = _decode(_leafCertificateDerBase64);

    test('diterima: host sama dengan expectedHost DAN SPKI ada di daftar pin', () {
      final accepted = tapGoShouldAcceptPinnedCertificate(
        host: 'api.tapgolion.id',
        expectedHost: 'api.tapgolion.id',
        certificateDer: leafDer,
        allowedSpkiSha256Hex: {_leafSpkiSha256Hex},
      );
      expect(accepted, isTrue);
    });

    // Sisa review audit (1 Oktober 2026): badCertificateCallback Dart hanya
    // pernah menerima sertifikat PEER (leaf) dari koneksi yang SEDANG
    // dibuka — SPKI yang cocok TIDAK CUKUP bila sertifikat itu dipakai untuk
    // menyambung ke host LAIN (mis. domain penyerang yang kebetulan punya
    // sertifikat dengan kunci publik sama, atau koneksi yang dialihkan ke
    // host tak terduga). Host harus cocok persis sebelum SPKI sekalipun
    // diperiksa.
    test('DITOLAK: SPKI cocok tapi host koneksi BUKAN host API klien', () {
      final accepted = tapGoShouldAcceptPinnedCertificate(
        host: 'evil.example.com',
        expectedHost: 'api.tapgolion.id',
        certificateDer: leafDer,
        allowedSpkiSha256Hex: {_leafSpkiSha256Hex},
      );
      expect(accepted, isFalse);
    });

    test('DITOLAK: host koneksi benar tapi SPKI tidak ada di daftar pin', () {
      final accepted = tapGoShouldAcceptPinnedCertificate(
        host: 'api.tapgolion.id',
        expectedHost: 'api.tapgolion.id',
        certificateDer: leafDer,
        allowedSpkiSha256Hex: {_intermediateSpkiSha256Hex, _selfSignedRsaSpkiSha256Hex},
      );
      expect(accepted, isFalse);
    });

    test('DITOLAK: host maupun SPKI dua-duanya tidak cocok', () {
      final accepted = tapGoShouldAcceptPinnedCertificate(
        host: 'evil.example.com',
        expectedHost: 'api.tapgolion.id',
        certificateDer: leafDer,
        allowedSpkiSha256Hex: {_intermediateSpkiSha256Hex},
      );
      expect(accepted, isFalse);
    });

    test('fail-closed: daftar pin kosong tetap ditolak walau host cocok', () {
      final accepted = tapGoShouldAcceptPinnedCertificate(
        host: 'api.tapgolion.id',
        expectedHost: 'api.tapgolion.id',
        certificateDer: leafDer,
        allowedSpkiSha256Hex: {},
      );
      expect(accepted, isFalse);
    });

    test('perbandingan host case-sensitive persis seperti yang diberikan (pemanggil wajib menormalkan)', () {
      final accepted = tapGoShouldAcceptPinnedCertificate(
        host: 'API.TAPGOLION.ID',
        expectedHost: 'api.tapgolion.id',
        certificateDer: leafDer,
        allowedSpkiSha256Hex: {_leafSpkiSha256Hex},
      );
      expect(accepted, isFalse);
    });
  });
}
