#!/usr/bin/env bash
# Memeriksa apakah pin TLS yang dibakar ke aplikasi mobile masih cocok dengan
# sertifikat yang DISAJIKAN server sekarang.
#
# Latar belakang (regresi APK driver 1.0.0+4, 4 Okt 2026): pin berisi hash
# SPKI sertifikat leaf. Let's Encrypt menerbitkan kunci leaf baru tiap
# perpanjangan (~hari ke-60), jadi pin yang kemarin benar bisa hari ini salah,
# dan SETIAP aplikasi terpasang gagal terhubung ("Koneksi belum stabil").
# Skrip ini membuat ketidakcocokan itu terlihat SEBELUM build dan SEBELUM
# pengguna merasakannya.
#
# Pemakaian:
#   TAPGO_TLS_PIN_SHA256=hash1,hash2 scripts/check-tls-pin-live.sh [host]
# Host bawaan: api.tapgolion.id. Keluar 0 bila sertifikat live cocok dengan
# salah satu pin; 1 bila tidak cocok; 2 bila tidak dapat diperiksa.
# Opsional: TAPGO_PIN_WARN_DAYS (bawaan 21) — peringatan bila sertifikat live
# kedaluwarsa dalam jangka itu (artinya perpanjangan, dan kemungkinan rotasi
# kunci, sudah dekat).
#
# Nilai pin TIDAK dibaca dari file di repo; hanya dari environment shell.
set -uo pipefail
host="${1:-api.tapgolion.id}"
warn_days="${TAPGO_PIN_WARN_DAYS:-21}"

if [ -z "${TAPGO_TLS_PIN_SHA256:-}" ]; then
  echo "GAGAL: TAPGO_TLS_PIN_SHA256 kosong di environment shell." >&2
  exit 2
fi
command -v openssl >/dev/null || { echo "GAGAL: openssl tidak ditemukan." >&2; exit 2; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
if ! echo | openssl s_client -connect "$host:443" -servername "$host" 2>/dev/null \
    | openssl x509 -out "$tmp/leaf.pem" 2>/dev/null || [ ! -s "$tmp/leaf.pem" ]; then
  echo "GAGAL: tidak dapat mengambil sertifikat dari $host:443 (jaringan/DNS?)." >&2
  exit 2
fi

live="$(openssl x509 -in "$tmp/leaf.pem" -pubkey -noout \
  | openssl pkey -pubin -outform der 2>/dev/null \
  | openssl dgst -sha256 | grep -o '[0-9a-f]\{64\}' | head -1)"
[ -n "$live" ] || { echo "GAGAL: tidak dapat menghitung SPKI sertifikat live." >&2; exit 2; }

not_after="$(openssl x509 -in "$tmp/leaf.pem" -noout -enddate | cut -d= -f2)"
echo "Host            : $host"
echo "Sertifikat live : berlaku sampai $not_after"
echo "SPKI live       : $live"

# Peringatan kedaluwarsa dekat (tidak membuat skrip gagal).
if ! openssl x509 -in "$tmp/leaf.pem" -noout -checkend $((warn_days * 86400)) >/dev/null; then
  echo "PERINGATAN: sertifikat live berakhir dalam <= $warn_days hari. Perpanjangan akan segera terjadi;" >&2
  echo "            tanpa certbot 'reuse_key' kunci baru akan memutus aplikasi yang pinnya kunci lama." >&2
fi

IFS=',' read -r -a pins <<<"$(printf '%s' "$TAPGO_TLS_PIN_SHA256" | tr 'A-F' 'a-f' | tr -d ' ')"
for pin in "${pins[@]}"; do
  if [ "$pin" = "$live" ]; then
    echo "OK: pin cocok dengan sertifikat live."
    exit 0
  fi
done

echo "GAGAL: TIDAK ADA pin yang cocok dengan SPKI sertifikat live." >&2
echo "       Aplikasi yang dibuild dengan pin ini TIDAK akan bisa terhubung ke $host." >&2
exit 1
