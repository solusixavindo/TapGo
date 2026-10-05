#!/usr/bin/env bash
# Memeriksa keselarasan 16 KB pustaka native 64-bit (arm64-v8a, x86_64) pada APK/AAB.
# Play mensyaratkan dukungan ukuran halaman 16 KB untuk aplikasi yang menarget
# Android 15+. Pemeriksaan: setiap segmen LOAD ELF 64-bit harus beralignment >= 16384.
# Pemakaian: scripts/check-native-alignment.sh <berkas.apk|berkas.aab> [--forbid-abi x86_64]
# Gagal (keluar 1) bila ada pustaka yang tidak selaras, atau ABI terlarang masih ada.
set -euo pipefail
file="${1:?pemakaian: $0 <apk|aab> [--forbid-abi ABI]}"
shift || true
forbid=""
if [ "${1:-}" = "--forbid-abi" ]; then forbid="${2:?ABI?}"; fi
python3 - "$file" "$forbid" <<'PY'
import struct, sys, zipfile

path, forbid = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(path)
bad, checked, forbidden = [], 0, []
for name in z.namelist():
    full = "/" + name
    if "/lib/" not in full or not name.endswith(".so"):
        continue
    abi = full.split("/lib/")[-1].split("/")[0]
    if forbid and abi == forbid:
        forbidden.append(name)
    if abi not in ("arm64-v8a", "x86_64"):
        continue
    data = z.read(name)
    if data[:4] != b"\x7fELF" or data[4] != 2:  # hanya ELF 64-bit
        continue
    checked += 1
    phoff = struct.unpack_from("<Q", data, 32)[0]
    phentsize, phnum = struct.unpack_from("<HH", data, 54)
    for i in range(phnum):
        off = phoff + i * phentsize
        if struct.unpack_from("<I", data, off)[0] == 1:  # PT_LOAD
            align = struct.unpack_from("<Q", data, off + 48)[0]
            if align < 16384:
                bad.append((name, align))
                break
print(f"pustaka 64-bit diperiksa: {checked}")
if forbidden:
    print(f"GAGAL: ABI terlarang {forbid} masih ada ({len(forbidden)} berkas)")
    sys.exit(1)
if bad:
    for name, align in bad:
        print(f"GAGAL: tidak selaras 16 KB (alignment {align}): {name}")
    sys.exit(1)
print("OK: semua pustaka 64-bit selaras 16 KB")
PY
