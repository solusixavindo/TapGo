import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// Ekstraksi & pencocokan SubjectPublicKeyInfo (SPKI) sertifikat TLS untuk
/// certificate pinning (audit keamanan 30 September 2026, M4).
///
/// Berkas ini murni (tanpa dart:io) supaya bisa diuji dengan byte sertifikat
/// sungguhan tanpa koneksi jaringan — lihat tls_pinning_test.dart. Pemanggil
/// (tapgo_api_client.dart) yang menghubungkannya ke SecurityContext/HttpClient.

class _DerTlv {
  const _DerTlv({
    required this.tag,
    required this.raw,
    required this.value,
    required this.nextOffset,
  });

  /// Byte tag DER (tanpa bit-bit constructed/class diuraikan lebih jauh —
  /// pembacaan ini hanya butuh nilai tag mentah untuk membedakan SEQUENCE
  /// dari field context-tagged opsional).
  final int tag;

  /// TLV lengkap: tag + length + value. Inilah yang di-hash untuk SPKI,
  /// karena RFC 7469-style pinning menghash SubjectPublicKeyInfo DER
  /// SELURUHNYA (bukan cuma isi BIT STRING-nya).
  final Uint8List raw;

  /// Hanya isi (value) — dipakai untuk turun ke anak-anak SEQUENCE.
  final Uint8List value;

  /// Offset tepat setelah TLV ini di buffer asal — posisi mulai TLV berikut.
  final int nextOffset;
}

_DerTlv? _readDerTlv(Uint8List bytes, int offset) {
  if (offset < 0 || offset + 1 >= bytes.length) {
    return null;
  }
  final tag = bytes[offset];
  final firstLengthByte = bytes[offset + 1];
  int length;
  int lengthFieldSize;
  if (firstLengthByte & 0x80 == 0) {
    length = firstLengthByte;
    lengthFieldSize = 1;
  } else {
    final extraBytes = firstLengthByte & 0x7F;
    // 0 (bentuk length tak-terbatas) dan >4 (panjang tak wajar untuk field
    // sertifikat) sengaja ditolak di sini — bukan struktur yang diharapkan
    // dari sertifikat X.509 DER manapun.
    if (extraBytes == 0 || extraBytes > 4) {
      return null;
    }
    if (offset + 2 + extraBytes > bytes.length) {
      return null;
    }
    length = 0;
    for (var i = 0; i < extraBytes; i++) {
      length = (length << 8) | bytes[offset + 2 + i];
    }
    lengthFieldSize = 1 + extraBytes;
  }
  final valueStart = offset + 1 + lengthFieldSize;
  final valueEnd = valueStart + length;
  if (valueEnd > bytes.length || valueEnd < valueStart) {
    return null;
  }
  return _DerTlv(
    tag: tag,
    raw: Uint8List.sublistView(bytes, offset, valueEnd),
    value: Uint8List.sublistView(bytes, valueStart, valueEnd),
    nextOffset: valueEnd,
  );
}

const int _tagSequence = 0x30;
const int _tagContextVersion = 0xA0;

/// Mengambil DER SubjectPublicKeyInfo dari DER sertifikat X.509 lengkap.
///
/// Mengikuti struktur baku RFC 5280:
///   Certificate ::= SEQUENCE { tbsCertificate TBSCertificate, ... }
///   TBSCertificate ::= SEQUENCE {
///     version [0] EXPLICIT Version DEFAULT v1,   -- opsional
///     serialNumber, signature, issuer, validity, subject,
///     subjectPublicKeyInfo,                       -- selalu field wajib ke-6
///     ...
///   }
/// subjectPublicKeyInfo SELALU berada tepat setelah lima field wajib
/// (serialNumber, signature, issuer, validity, subject), terlepas dari field
/// version opsional ada atau tidak — pembacaan ini murni posisional
/// mengikuti urutan ASN.1 di atas, bukan menebak/mencari berdasar isi field.
/// Diverifikasi cocok dengan `openssl asn1parse`/`openssl x509 -pubkey` atas
/// sertifikat produksi sungguhan (lihat tls_pinning_test.dart).
///
/// Mengembalikan null bila struktur tidak sesuai dugaan (byte rusak/bukan
/// sertifikat X.509 DER) — pemanggil WAJIB memperlakukan null sebagai
/// kegagalan verifikasi (tertutup), bukan diloloskan.
Uint8List? tapGoExtractSubjectPublicKeyInfoDer(Uint8List certificateDer) {
  final certificate = _readDerTlv(certificateDer, 0);
  if (certificate == null || certificate.tag != _tagSequence) {
    return null;
  }

  final tbsCertificate = _readDerTlv(certificate.value, 0);
  if (tbsCertificate == null || tbsCertificate.tag != _tagSequence) {
    return null;
  }

  final fields = tbsCertificate.value;
  var node = _readDerTlv(fields, 0);
  if (node == null) {
    return null;
  }
  if (node.tag == _tagContextVersion) {
    node = _readDerTlv(fields, node.nextOffset);
    if (node == null) {
      return null;
    }
  }
  // node sekarang serialNumber (field wajib ke-1). Lewati 5 field wajib
  // berikutnya (serialNumber, signature, issuer, validity, subject) untuk
  // sampai ke subjectPublicKeyInfo (field wajib ke-6).
  for (var i = 0; i < 5; i++) {
    node = _readDerTlv(fields, node!.nextOffset);
    if (node == null) {
      return null;
    }
  }
  final subjectPublicKeyInfo = node!;
  if (subjectPublicKeyInfo.tag != _tagSequence) {
    return null;
  }
  return subjectPublicKeyInfo.raw;
}

/// SHA-256 dari [bytes], huruf kecil heksadesimal.
String tapGoSha256Hex(Uint8List bytes) {
  return sha256.convert(bytes).toString();
}

/// True bila SPKI sertifikat [certificateDer] cocok dengan salah satu hash
/// SHA-256 (hex, huruf kecil) di [allowedSpkiSha256Hex].
///
/// [allowedSpkiSha256Hex] kosong ATAU sertifikat yang gagal diurai SELALU
/// dianggap TIDAK cocok — tertutup terhadap kegagalan (fail-closed), bukan
/// meloloskan koneksi yang tidak bisa diverifikasi.
bool tapGoCertificateMatchesPins(
  Uint8List certificateDer, {
  required Set<String> allowedSpkiSha256Hex,
}) {
  if (allowedSpkiSha256Hex.isEmpty) {
    return false;
  }
  final spki = tapGoExtractSubjectPublicKeyInfoDer(certificateDer);
  if (spki == null) {
    return false;
  }
  return allowedSpkiSha256Hex.contains(tapGoSha256Hex(spki));
}

/// Keputusan pin LENGKAP — host DAN SPKI harus cocok. Murni (tanpa dart:io
/// atau jaringan), supaya bisa diuji langsung tanpa membuka koneksi
/// sungguhan (lihat tls_pinning_test.dart).
///
/// Sisa review audit (1 Oktober 2026): badCertificateCallback Dart hanya
/// pernah menerima sertifikat PEER (leaf) dari koneksi yang SEDANG dibuka —
/// cocoknya SPKI saja TIDAK CUKUP untuk memutuskan terima/tolak, karena pin
/// yang kebetulan cocok (mis. SPKI intermediate CA publik yang menerbitkan
/// sertifikat untuk banyak domain lain) tetap bisa dipakai host LAIN yang
/// bukan API TapGo. [host] (host koneksi yang sedang diverifikasi) WAJIB
/// sama persis dengan [expectedHost] (host base URL klien API) sebelum SPKI
/// sekalipun diperiksa — host lain ditolak walau SPKI-nya cocok.
bool tapGoShouldAcceptPinnedCertificate({
  required String host,
  required String expectedHost,
  required Uint8List certificateDer,
  required Set<String> allowedSpkiSha256Hex,
}) {
  if (host != expectedHost) {
    return false;
  }
  return tapGoCertificateMatchesPins(
    certificateDer,
    allowedSpkiSha256Hex: allowedSpkiSha256Hex,
  );
}
