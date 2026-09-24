#!/usr/bin/env bash
# Pemeriksa sumber: aplikasi MOBILE (user_app, driver_app) tidak boleh memuat
# fungsi admin / Founder dalam bentuk apa pun — bukan "dinonaktifkan", bukan
# "disembunyikan", tetapi TIDAK ADA di kode.
#
# Latar belakang: pada 2026-09-19 dashboard admin di user_app hanya
# "disembunyikan" (getter isAdmin dipaksa false) sementara 2.785 baris layar
# admin dan puluhan pemanggilan API /admin tetap ada. Kode yang tidak punya
# jalur akses hari ini adalah satu refactor dari aktif kembali, dan build lama
# sebelum tanggal itu benar-benar mengarahkan akun admin ke dashboard admin.
# Lihat docs/release/LAPORAN_KODE_ADMIN_DI_APLIKASI_USER.md.
#
# Pemakaian: scripts/guard-mobile-no-admin.sh [direktori-repo]
# Keluar dengan kode 1 bila ada pelanggaran (dipakai CI dan pra-rilis).
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APPS=("apps/user_app" "apps/driver_app")

# Pola isi berkas. Sengaja sempit agar tidak menangkap teks sah seperti
# "Biaya admin" (adminFee), tombol "Hubungi Admin" (dukungan pelanggan), atau
# lencana Founder milik member (tampilan status sendiri, bukan fungsi admin).
PATTERNS=(
  "['\"]/admin"                       # pemanggilan rute /admin dari klien
  "api/v1/admin"
  "\bisAdmin\b"
  "\bisSuperAdmin\b"
  "SUPER_ADMIN"
  "founder-(platinum|chairman)"       # rute admin Founder
  "Founder Program"                   # judul layar admin Founder
  "(admin|update)Founder"             # metode klien API admin Founder
)

violations=0

for app in "${APPS[@]}"; do
  dir="$ROOT/$app/lib"
  [ -d "$dir" ] || continue

  # 1) nama berkas: admin_*.dart
  while IFS= read -r f; do
    echo "PELANGGARAN [nama berkas] ${f#"$ROOT"/}"
    violations=$((violations + 1))
  done < <(find "$dir" -type f -iname 'admin_*.dart')

  # 2) isi berkas
  for pattern in "${PATTERNS[@]}"; do
    while IFS= read -r hit; do
      echo "PELANGGARAN [isi: $pattern] ${hit#"$ROOT"/}"
      violations=$((violations + 1))
    done < <(grep -rEn --include='*.dart' -e "$pattern" "$dir" || true)
  done
done

if [ "$violations" -gt 0 ]; then
  echo
  echo "GAGAL: $violations pelanggaran. Aplikasi mobile tidak boleh memuat kode admin/Founder."
  echo "Hapus kodenya (jangan disembunyikan). Fitur admin hanya ada di konsol web."
  exit 1
fi

echo "OK: tidak ada kode admin/Founder di ${APPS[*]}."
