#!/usr/bin/env bash
set -euo pipefail

# Menyiapkan data routing OSRM (Indonesia) untuk RIDE_DISTANCE_PROVIDER=OSRM.
#
# Sekali pakai per checkout/server: mengunduh ekstrak OSM Indonesia dari
# Geofabrik lalu memprosesnya lewat osrm-extract/partition/customize
# (image resmi osrm/osrm-backend, tidak perlu install OSRM di host).
# Hasilnya disimpan di infra/osrm-data/ dan dipakai oleh service "osrm"
# pada infra/docker-compose.yml (profile "osrm").
#
# Perkiraan: unduhan ~500MB, proses ekstraksi butuh beberapa GB RAM dan
# bisa memakan 10-30 menit tergantung mesin. Jalankan ini SEKALI, bukan
# tiap kali docker compose up.
#
# Pemakaian:
#   scripts/osrm-setup.sh
#   docker compose -f infra/docker-compose.yml --profile osrm up -d osrm
#   # lalu di apps/backend/.env:
#   #   RIDE_DISTANCE_PROVIDER=OSRM
#   #   OSRM_BASE_URL=http://localhost:5001

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$REPO_ROOT/infra/osrm-data"
PBF_URL="${OSRM_PBF_URL:-https://download.geofabrik.de/asia/indonesia-latest.osm.pbf}"
PBF_FILE="$DATA_DIR/indonesia-latest.osm.pbf"
OSRM_IMAGE="osrm/osrm-backend:v5.27.1"

info() {
  printf '[osrm-setup] %s\n' "$1"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf '[osrm-setup] FAIL: perintah wajib tidak ditemukan: %s\n' "$1" >&2
    exit 1
  }
}

require_cmd docker
require_cmd curl

mkdir -p "$DATA_DIR"

if [ -f "$DATA_DIR/indonesia-latest.osrm" ]; then
  info "Data routing sudah ada di $DATA_DIR — hapus folder ini dulu bila ingin membangun ulang."
  exit 0
fi

if [ ! -f "$PBF_FILE" ]; then
  info "Mengunduh ekstrak OSM Indonesia dari Geofabrik (~500MB, sekali saja)..."
  curl -fL --progress-bar "$PBF_URL" -o "$PBF_FILE.tmp"
  mv "$PBF_FILE.tmp" "$PBF_FILE"
else
  info "Ekstrak OSM sudah terunduh, lewati unduhan."
fi

info "Menjalankan osrm-extract (profil mobil)..."
docker run --rm -t -v "$DATA_DIR:/data" "$OSRM_IMAGE" \
  osrm-extract -p /opt/car.lua /data/indonesia-latest.osm.pbf

info "Menjalankan osrm-partition..."
docker run --rm -t -v "$DATA_DIR:/data" "$OSRM_IMAGE" \
  osrm-partition /data/indonesia-latest.osrm

info "Menjalankan osrm-customize..."
docker run --rm -t -v "$DATA_DIR:/data" "$OSRM_IMAGE" \
  osrm-customize /data/indonesia-latest.osrm

info "Selesai. Jalankan servernya dengan:"
info "  docker compose -f infra/docker-compose.yml --profile osrm up -d osrm"
info "Lalu di apps/backend/.env set RIDE_DISTANCE_PROVIDER=OSRM dan OSRM_BASE_URL=http://localhost:5001"
