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

# Audit 4 Okt 2026: sejak pinning TLS masuk (e7eea10, 1 Okt) build rilis TANPA
# TAPGO_TLS_PIN_SHA256 menghasilkan aplikasi yang menolak SEMUA permintaan
# jaringan (fail-closed by design), tetapi lolos semua langkah gerbang ini dan
# verify-mobile-artifact.sh. Gerbang driver sudah dijaga (02e2798); user_app
# belum. Nilai HANYA dari environment shell, TIDAK PERNAH dari file di repo.
if [ -z "${TAPGO_TLS_PIN_SHA256:-}" ]; then
  fail "TAPGO_TLS_PIN_SHA256 kosong di environment shell ini — build rilis dibatalkan (fail-closed). Jalankan: export TAPGO_TLS_PIN_SHA256=<hash SPKI produksi>, lalu ulangi skrip ini."
fi

# Let's Encrypt memutar kunci leaf tiap perpanjangan: pin yang kemarin benar
# bisa hari ini salah (regresi driver_app 1.0.0+4, 4 Okt 2026). Dibandingkan
# dengan sertifikat yang disajikan server SEKARANG.
step "3b. Pin TLS cocok dengan sertifikat live"
if [ "${TAPGO_SKIP_LIVE_PIN_CHECK:-0}" = "1" ]; then
  echo "DILEWATI (TAPGO_SKIP_LIVE_PIN_CHECK=1) — pin TIDAK diverifikasi terhadap server."
else
  "$root/scripts/check-tls-pin-live.sh" || fail "pin TLS tidak cocok / tidak dapat diverifikasi terhadap sertifikat live — build dibatalkan"
fi

step "4. Build rilis APK dan AAB"
flutter build apk --release --dart-define=TAPGO_TLS_PIN_SHA256="$TAPGO_TLS_PIN_SHA256" 2>&1 | tail -2
flutter build appbundle --release --dart-define=TAPGO_TLS_PIN_SHA256="$TAPGO_TLS_PIN_SHA256" 2>&1 | tail -2
apk="$app/build/app/outputs/flutter-apk/app-release.apk"
aab="$app/build/app/outputs/bundle/release/app-release.aab"

step "5. Pemeriksa artefak dan identitas paket"
"$root/scripts/verify-mobile-artifact.sh" "$apk"
"$root/scripts/verify-mobile-artifact.sh" "$aab"
# Pin harus benar-benar tertanam di biner Dart di setiap ABI. Dihitung dengan
# grep -c (bukan -q): -q menutup pipa lebih awal, unzip kena SIGPIPE, dan
# pipefail menandai pemeriksaan gagal padahal pin ada.
for abi_so in $(unzip -Z1 "$apk" 'lib/*/libapp.so'); do
  found="$(unzip -p "$apk" "$abi_so" | grep -ac "${TAPGO_TLS_PIN_SHA256%%,*}" || true)"
  [ "${found:-0}" -ge 1 ] || fail "pin TLS tidak ditemukan di $abi_so — dart-define tidak terpasang"
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
