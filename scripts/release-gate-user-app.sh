#!/usr/bin/env bash
# Gerbang rilis user_app: SEMUA langkah harus lolos sebelum APK/AAB diserahkan.
# Tujuannya satu: setiap versi baru tidak boleh mengulang kesalahan versi
# sebelumnya. Kesalahan yang pernah dilaporkan tercatat di
# docs/release/REGRESSION_REGISTER.md dan masing-masing punya uji otomatis
# yang dijalankan di langkah 3.
#
# Pemakaian: scripts/release-gate-user-app.sh [--skip-build]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
app="$root/apps/user_app"
skip_build=0; [ "${1:-}" = "--skip-build" ] && skip_build=1
step() { printf '\n== %s\n' "$*"; }
fail() { printf 'GAGAL: %s\n' "$*" >&2; exit 1; }

version_line="$(grep -E '^version:' "$app/pubspec.yaml" | awk '{print $2}')"
name="${version_line%%+*}"; build="${version_line##*+}"
notes="$root/docs/release/USER_APP_${name//./_}_${build}_RELEASE_NOTES.md"

step "1. Catatan rilis untuk $version_line"
[ -f "$notes" ] || fail "catatan rilis tidak ada: $notes"
git -C "$root" tag --list >/dev/null
prev="$(git -C "$root" log --format=%H -n 1 -- "$app/pubspec.yaml")" || true

step "2. Pemeriksa sumber (tanpa kode admin/Founder) dan analisis semua level"
"$root/scripts/guard-mobile-no-admin.sh"
cd "$app"
analysis="$(flutter analyze 2>&1 || true)"
# Hanya berkas yang dilacak git yang dihitung; berkas kerja lokal belum di-commit diabaikan.
bad=0
while IFS= read -r line; do
  file="$(printf '%s' "$line" | sed -E 's/.* • ([^ ]+\.dart):[0-9]+:[0-9]+.*/\1/')"
  if git -C "$app" ls-files --error-unmatch "$file" >/dev/null 2>&1; then
    printf '%s\n' "$line"; bad=1
  fi
done < <(printf '%s\n' "$analysis" | grep -E '^ *(info|warning|error) •' || true)
[ "$bad" = 0 ] || fail "flutter analyze menemukan masalah pada berkas yang dilacak"

step "3. Seluruh uji (termasuk daftar regresi)"
flutter test >/tmp/gate-flutter-test.log 2>&1 || { tail -30 /tmp/gate-flutter-test.log; fail "flutter test gagal"; }
tail -1 /tmp/gate-flutter-test.log

[ "$skip_build" = 1 ] && { echo "OK (tanpa build)"; exit 0; }

# Handshake TLS SUNGGUHAN ke server produksi memakai kode pinning aplikasi
# sendiri (trust anchor yang dibundel), bukan perbandingan statis. Regresi
# 4 Okt 2026: pinning SPKI leaf lewat badCertificateCallback tidak pernah cocok
# terhadap rantai produksi (callback menerima sertifikat TERATAS, bukan leaf),
# sehingga driver_app +4..+7 dan user_app +33 menolak SEMUA permintaan padahal
# semua uji hijau. Gagal (1) atau server tidak terjangkau (2) sama-sama
# membatalkan build. TAPGO_SKIP_LIVE_TLS_CHECK=1 hanya untuk kondisi offline
# yang disengaja.
step "3b. Handshake TLS ke server live dengan trust anchor aplikasi"
if [ "${TAPGO_SKIP_LIVE_TLS_CHECK:-0}" = "1" ]; then
  echo "DILEWATI (TAPGO_SKIP_LIVE_TLS_CHECK=1) — handshake TIDAK diverifikasi terhadap server."
else
  "$root/scripts/check-tls-anchors-live.sh" user_app || fail "aplikasi tidak dapat terhubung ke server live dengan trust anchor yang dibundel — build dibatalkan"
fi

step "4. Build rilis APK dan AAB"
flutter build apk --release 2>&1 | tail -2
flutter build appbundle --release 2>&1 | tail -2
apk="$app/build/app/outputs/flutter-apk/app-release.apk"
aab="$app/build/app/outputs/bundle/release/app-release.aab"

step "5. Pemeriksa artefak dan identitas paket"
"$root/scripts/verify-mobile-artifact.sh" "$apk"
"$root/scripts/verify-mobile-artifact.sh" "$aab"
# Keselarasan 16 KB (syarat Play untuk target Android 15+).
"$root/scripts/check-native-alignment.sh" "$apk" || fail "keselarasan 16 KB pada APK"
"$root/scripts/check-native-alignment.sh" "$aab" || fail "keselarasan 16 KB pada AAB"
# Trust anchor harus benar-benar tertanam di biner Dart setiap ABI: baris
# pertama basis64 tiap anchor di lib/services/tls_pinning.dart dicari di libapp.so. Dihitung
# dengan grep -c (bukan -q): -q menutup pipa lebih awal, unzip kena SIGPIPE,
# dan pipefail menandai pemeriksaan gagal padahal anchor ada.
anchor_src="$app/lib/services/tls_pinning.dart"
anchor_lines="$(awk '/BEGIN CERTIFICATE/ {getline; print}' "$anchor_src")"
[ "$(printf '%s\n' "$anchor_lines" | grep -c .)" -ge 3 ] || fail "kurang dari 3 trust anchor di $anchor_src"
for abi_so in $(unzip -Z1 "$apk" 'lib/*/libapp.so'); do
  for line in $anchor_lines; do
    found="$(unzip -p "$apk" "$abi_so" | grep -acF "$line" || true)"
    [ "${found:-0}" -ge 1 ] || fail "trust anchor tidak ditemukan di $abi_so"
  done
done
aapt="$(ls -d "$HOME"/Library/Android/sdk/build-tools/*/aapt 2>/dev/null | tail -1)"
if [ -n "$aapt" ]; then
  badging="$("$aapt" dump badging "$apk")"
  echo "$badging" | grep -q "package: name='com.xavindo.tapgo' versionCode='$build' versionName='$name'" \
    || fail "package/versionCode/versionName tidak cocok dengan pubspec ($version_line)"
  echo "$badging" | grep -q "POST_NOTIFICATIONS" || fail "izin notifikasi tidak ada"
fi

step "6. Salin ke Desktop dan checksum"
out="$HOME/Desktop/tapgo-user-$version_line"
cp "$apk" "$out.apk"; cp "$aab" "$out.aab"
( cd "$HOME/Desktop" && shasum -a 256 "tapgo-user-$version_line.apk" "tapgo-user-$version_line.aab" | tee "tapgo-user-$version_line.sha256" )
echo; echo "GERBANG LOLOS untuk $version_line"
