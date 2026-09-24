#!/usr/bin/env bash
# Pemeriksa ARTEFAK: memeriksa isi APK/AAB/libapp.so hasil build rilis dan
# gagal bila menemukan jejak fungsi admin/Founder.
#
# Pemeriksa sumber (guard-mobile-no-admin.sh) menjaga kode; skrip ini menjaga
# apa yang benar-benar dikirim ke pengguna, sehingga kebocoran yang lolos dari
# pola sumber (mis. lewat dependensi atau berkas hasil generate) tetap
# tertangkap. Wajib dijalankan pada berkas yang akan diunggah ke Play Console.
#
# Pemakaian: scripts/verify-mobile-artifact.sh <app-release.apk|app-release.aab|libapp.so>
set -euo pipefail

artifact="${1:?pemakaian: $0 <apk|aab|libapp.so>}"
[ -f "$artifact" ] || { echo "berkas tidak ada: $artifact"; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

case "$artifact" in
  *.apk|*.aab)
    unzip -q -o "$artifact" -d "$tmp" || { echo "gagal membuka $artifact"; exit 2; }
    ;;
  *)
    cp "$artifact" "$tmp/libapp.so"
    ;;
esac

# Kode Dart hasil kompilasi AOT ada di libapp.so; build debug menaruhnya di
# kernel_blob.bin (tidak dipangkas) sehingga TIDAK boleh diperiksa dengan skrip ini.
if find "$tmp" -name 'kernel_blob.bin' | grep -q .; then
  echo "GAGAL: artefak berisi kernel_blob.bin (build debug). Periksa build rilis (--release)."
  exit 2
fi

libs=()
while IFS= read -r line; do libs+=("$line"); done < <(find "$tmp" -name 'libapp.so')
[ "${#libs[@]}" -gt 0 ] || { echo "GAGAL: libapp.so tidak ditemukan di $artifact"; exit 2; }

# Penanda yang tidak boleh ada di aplikasi mobile.
MARKERS=(
  "/admin/"
  "/api/v1/admin"
  "founder-platinum"
  "founder-chairman"
  "Founder Program"
  "Super Admin Dashboard"
  "SUPER_ADMIN"
  # Alur distribusi direct (pembelian membership, KTP, penarikan) sudah dihapus:
  # aplikasi hanya beredar lewat Google Play, upgrade membership lewat web.
  "/membership/orders"
  "/wallet/withdrawals"
  "/wallet/bank-account"
  "/referrals/claim"
  "Form Membership"
  "Upload KTP dan foto diri"
)
# Kontrol positif: string yang PASTI ada di aplikasi user. Bila tidak ditemukan,
# artinya pemindaian ini tidak bekerja (mis. build diobfuscate) — jangan
# mengaku lolos tanpa bukti.
CONTROL="${VERIFY_CONTROL_STRING:-/wallet/transfer}"

violations=0
control_seen=0
for lib in "${libs[@]}"; do
  dump="$tmp/strings.txt"
  strings -a "$lib" > "$dump"
  if grep -qF -- "$CONTROL" "$dump"; then control_seen=1; fi
  for marker in "${MARKERS[@]}"; do
    if grep -qF -- "$marker" "$dump"; then
      echo "PELANGGARAN: '$marker' ada di ${lib#"$tmp"/}"
      violations=$((violations + 1))
    fi
  done
done

if [ "$violations" -gt 0 ]; then
  echo "GAGAL: $violations jejak admin/Founder di $artifact"
  exit 1
fi
if [ "$control_seen" -eq 0 ]; then
  echo "GAGAL: string kontrol '$CONTROL' tidak ditemukan — pemindaian tidak dapat dipercaya."
  echo "Bila aplikasi ini bukan user_app, set VERIFY_CONTROL_STRING ke string yang pasti ada."
  exit 2
fi
echo "OK: tidak ada jejak admin/Founder di $artifact"
