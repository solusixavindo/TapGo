#!/usr/bin/env bash
# Gerbang rilis driver_app: SEMUA langkah harus lolos sebelum APK/AAB diserahkan.
# Tujuannya satu: setiap versi baru tidak boleh mengulang kesalahan versi
# sebelumnya. Kesalahan yang pernah dilaporkan tercatat di
# docs/release/REGRESSION_REGISTER.md dan masing-masing punya uji otomatis
# yang dijalankan di langkah 3.
#
# Pemakaian: scripts/release-gate-driver-app.sh [--skip-build]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
app="$root/apps/driver_app"
skip_build=0; [ "${1:-}" = "--skip-build" ] && skip_build=1
step() { printf '\n== %s\n' "$*"; }
fail() { printf 'GAGAL: %s\n' "$*" >&2; exit 1; }

version_line="$(grep -E '^version:' "$app/pubspec.yaml" | awk '{print $2}')"
name="${version_line%%+*}"; build="${version_line##*+}"
notes="$root/docs/release/DRIVER_APP_${name//./_}_${build}_RELEASE_NOTES.md"

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

step "4. Build rilis APK dan AAB"
flutter build apk --release 2>&1 | tail -2
flutter build appbundle --release 2>&1 | tail -2
apk="$app/build/app/outputs/flutter-apk/app-release.apk"
aab="$app/build/app/outputs/bundle/release/app-release.aab"

step "5. Pemeriksa artefak dan identitas paket"
"$root/scripts/verify-mobile-artifact.sh" "$apk"
"$root/scripts/verify-mobile-artifact.sh" "$aab"
aapt="$(ls -d "$HOME"/Library/Android/sdk/build-tools/*/aapt 2>/dev/null | tail -1)"
if [ -n "$aapt" ]; then
  badging="$("$aapt" dump badging "$apk")"
  echo "$badging" | grep -q "package: name='com.xavindo.tapgo.driver' versionCode='$build' versionName='$name'" \
    || fail "package/versionCode/versionName tidak cocok dengan pubspec ($version_line)"
  # Aplikasi driver tidak boleh meminta izin lokasi latar belakang tanpa deklarasi Play.
  if echo "$badging" | grep -q "ACCESS_BACKGROUND_LOCATION"; then fail "ACCESS_BACKGROUND_LOCATION terdeteksi; butuh keputusan dan deklarasi Play"; fi
fi

step "6. Salin ke Desktop dan checksum"
out="$HOME/Desktop/tapgo-driver-$version_line"
cp "$apk" "$out.apk"; cp "$aab" "$out.aab"
( cd "$HOME/Desktop" && shasum -a 256 "tapgo-driver-$version_line.apk" "tapgo-driver-$version_line.aab" | tee "tapgo-driver-$version_line.sha256" )
echo; echo "GERBANG LOLOS untuk $version_line"
