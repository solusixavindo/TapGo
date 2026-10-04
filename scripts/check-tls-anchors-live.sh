#!/usr/bin/env bash
# Handshake TLS SUNGGUHAN ke server produksi memakai kode pinning aplikasi
# sendiri (trust anchor yang dibundel), bukan perbandingan statis.
#
# Latar belakang (4 Okt 2026): pinning SPKI leaf lewat badCertificateCallback
# tidak pernah cocok terhadap rantai produksi — callback menerima sertifikat
# TERATAS yang gagal diverifikasi, bukan leaf — sehingga driver_app +4..+7 dan
# user_app +33 menolak SEMUA permintaan, padahal semua uji hijau dan perbandingan
# SPKI statis "cocok". Hanya handshake nyata terhadap rantai produksi yang dapat
# menangkap itu, jadi gerbang rilis menjalankannya.
#
# Pemakaian: scripts/check-tls-anchors-live.sh <driver_app|user_app> [host]
# Keluar 0 bila: (1) handshake dengan anchor aplikasi berhasil dan /health
# menjawab 200, dan (2) kontrol negatif (tanpa anchor) ditolak. Keluar 1 bila
# anchor aplikasi ditolak oleh server (aplikasi akan gagal terhubung); 2 bila
# server tidak dapat dijangkau.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
app_name="${1:-}"
host="${2:-api.tapgolion.id}"
case "$app_name" in
  driver_app) import="package:tapgo_driver_app/core/security/tls_pinning.dart" ;;
  user_app)   import="package:tapgo_user_app/services/tls_pinning.dart" ;;
  *) echo "Pemakaian: $0 <driver_app|user_app> [host]" >&2; exit 2 ;;
esac
app="$root/apps/$app_name"
command -v dart >/dev/null || { echo "GAGAL: dart tidak ditemukan." >&2; exit 2; }

probe="$app/tool_tls_anchor_probe.dart"
trap 'rm -f "$probe"' EXIT
cat > "$probe" <<DART
import 'dart:io';
import '$import';

Future<(int?, Object?)> get(SecurityContext context, String host) async {
  final client = HttpClient(context: context);
  client.badCertificateCallback = (cert, h, p) => false;
  try {
    final response = await (await client.getUrl(Uri.parse('https://\$host/health'))).close();
    final body = await response.transform(const SystemEncoding().decoder).join();
    return (body.contains('"status":"ok"') ? response.statusCode : -response.statusCode, null);
  } catch (error) {
    return (null, error);
  } finally {
    client.close(force: true);
  }
}

Future<void> main(List<String> args) async {
  final host = args[0];
  final (status, error) = await get(tapGoBuildTrustAnchorContext(kTapGoTrustAnchorPems), host);
  if (status != 200) {
    final reason = error is TlsException ? 'TLS DITOLAK (\${error.runtimeType})'
        : error is SocketException ? 'JARINGAN' : 'status \$status / \$error';
    print('HASIL1 GAGAL \$reason');
    exit(error is SocketException ? 2 : 1);
  }
  print('HASIL1 OK handshake dengan anchor aplikasi berhasil, /health 200');
  final (negStatus, negError) = await get(tapGoBuildTrustAnchorContext(<String>[]), host);
  if (negStatus != null) {
    print('HASIL2 GAGAL kontrol negatif (tanpa anchor) justru diterima: \$negStatus');
    exit(1);
  }
  print('HASIL2 OK kontrol negatif (tanpa anchor) ditolak: \${negError.runtimeType}');
}
DART

cd "$app" || exit 2
# dart run dapat mencetak "Running build hooks..." tanpa baris baru tepat
# sebelum keluaran program, jadi HASILn dicari di mana saja dalam baris.
out="$(dart run "$probe" "$host" 2>&1 | tr '\r' '\n' | grep -o 'HASIL[0-9] .*')"
echo "Host        : $host"
echo "Aplikasi    : $app_name"
echo "$out" | sed 's/^HASIL[0-9] /  /'
if echo "$out" | grep -q "^HASIL1 OK" && echo "$out" | grep -q "^HASIL2 OK"; then
  echo "OK: aplikasi dapat terhubung ke $host dengan trust anchor yang dibundel."
  exit 0
fi
if echo "$out" | grep -q "JARINGAN"; then
  echo "GAGAL: server tidak dapat dijangkau (jaringan/DNS?)." >&2
  exit 2
fi
echo "GAGAL: aplikasi TIDAK akan dapat terhubung ke $host dengan trust anchor yang dibundel." >&2
exit 1
