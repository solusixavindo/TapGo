import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/services/tls_pinning.dart';

/// Byte DER sertifikat X.509 sungguhan, dipakai sebagai vektor uji ekstraksi
/// SubjectPublicKeyInfo (M4). BUKAN nilai tebakan: diambil langsung dari
/// `openssl s_client -connect api.tapgolion.id:443 -showcerts` (audit
/// keamanan 30 September 2026) dan dari sertifikat self-signed yang dibuat
/// lokal dengan `openssl req -x509`. Hash SHA-256 pembanding di setiap test
/// dihitung independen lewat
/// `openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256`
/// — bukan disalin dari kode yang sedang diuji.
///
/// Sertifikat produksi (leaf) berlaku sampai 2026-11-02; bila test ini mulai
/// gagal setelah tanggal itu karena sertifikat sudah diperbarui, itu memang
/// terduga (leaf Let's Encrypt berumur pendek) — bukan regresi. Perbarui
/// vektornya dengan cara yang sama.
const _leafCertificateDerBase64 =
    'MIIDjzCCAxWgAwIBAgISBfcDAeWSmEzFplFhq2YMJmVVMAoGCCqGSM49BAMDMDMx'
    'CzAJBgNVBAYTAlVTMRYwFAYDVQQKEw1MZXQncyBFbmNyeXB0MQwwCgYDVQQDEwNZ'
    'RTEwHhcNMjYwODA0MTkwOTMyWhcNMjYxMTAyMTkwOTMxWjAbMRkwFwYDVQQDExBh'
    'cGkudGFwZ29saW9uLmlkMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEoFv71qDQ'
    'FPSj42DO+h/Z0l5vNXWOcI2Dvn3BBN1g1U648hXhST7FxCrLL9VCXlVo38+oQ1Nu'
    '2d6im0huE0VU3KOCAh8wggIbMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggr'
    'BgEFBQcDATAMBgNVHRMBAf8EAjAAMB0GA1UdDgQWBBRWoiIBavQipYj3d33IWKh3'
    '3ifmlDAfBgNVHSMEGDAWgBS7IMpHC/7X5Zz5jwkqo4w3RbG82DAzBggrBgEFBQcB'
    'AQQnMCUwIwYIKwYBBQUHMAKGF2h0dHA6Ly95ZTEuaS5sZW5jci5vcmcvMBsGA1Ud'
    'EQQUMBKCEGFwaS50YXBnb2xpb24uaWQwEwYDVR0gBAwwCjAIBgZngQwBAgEwLgYD'
    'VR0fBCcwJTAjoCGgH4YdaHR0cDovL3llMS5jLmxlbmNyLm9yZy84Ni5jcmwwggEN'
    'BgorBgEEAdZ5AgQCBIH+BIH7APkAdwDLOPcViXyEoURfW8Hd+8lu8ppZzUcKaQWF'
    'sMsUwxRY5wAAAZ/OY+0uAAAEAwBIMEYCIQCMW1Ee25nKCLLtNZhb1z9ybPkf0Fc+'
    'Tq4o0HySmATS4AIhANhShw8T0EWo/AIgvTegOvPcf9mAbXstAFR/D2S6tkGIAH4A'
    'Rq+GPTs+5Z+ld96oJF02sNntIqIj9GF3QSKUUu6VUF8AAAGfzmPtVAAIAAAFAA/R'
    'eO8EAwBHMEUCIQCYrC+6AzJBKQaeiqJhZYzviTuunpi7U7TeC2KzD3OBSAIgL1+a'
    'w7cAyGDilVe1XgCqTW7wdP8qWEMU4mVxhJo2DnkwCgYIKoZIzj0EAwMDaAAwZQIx'
    'ALjeIIGnjAyCUP7r45I8ykFpy/DuE675ott//ZscbBgbobbZdMeAa04aLOFpQ8G2'
    'KwIwbuQ11pHtw0i/mtNH0lp9eaFdY0PCLtMwW3G19EU6tFu0Ms9jYb/pbNI9XkxR'
    'sxQF';
const _leafSpkiSha256Hex =
    'd8a3f82de44e0e155d459c39f5d64aec66b78da2343fafbfad6c728a9254f8b8';

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
    test('mengambil SPKI dari sertifikat leaf produksi (EC, api.tapgolion.id)', () {
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
