#!/usr/bin/env bash
# Backup harian PostgreSQL -> Cloudflare R2 (S3-compatible).
#
# Dijalankan di VPS produksi lewat cron (lihat infra/cron/tapgo-backup.cron).
# TIDAK menyentuh Node/Docker sama sekali — murni pg_dump + aws CLI, supaya
# tetap jalan meski container backend sedang direstart/down.
#
# Variabel wajib (baca dari environment, mis. dari /etc/tapgo-backup.env yang
# di-source cron, lihat infra/cron/tapgo-backup.cron):
#   DATABASE_URL          - connection string Postgres yang mau dibackup
#   R2_ACCOUNT_ID         - account ID Cloudflare
#   R2_ACCESS_KEY_ID
#   R2_SECRET_ACCESS_KEY
#   R2_BUCKET_NAME
# Opsional:
#   BACKUP_RETENTION_DAYS - default 7 (dump lokal lebih tua dihapus)
#   BACKUP_DIR            - default /var/backups/tapgo

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL wajib diisi}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID wajib diisi}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID wajib diisi}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY wajib diisi}"
: "${R2_BUCKET_NAME:?R2_BUCKET_NAME wajib diisi}"

BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tapgo}"
TIMESTAMP="$(date -u +%Y-%m-%d-%H%M%S)"
FILENAME="tapgo-backup-${TIMESTAMP}.dump"
FILEPATH="${BACKUP_DIR}/${FILENAME}"
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

mkdir -p "$BACKUP_DIR"

# DATABASE_URL di seluruh proyek ini pakai konvensi Prisma
# (...?schema=public) — bukan opsi libpq yang dikenali pg_dump, dan bikin
# pg_dump gagal dengan "invalid URI query parameter: schema". Buang bagian
# query string; pg_dump tanpa itu sudah mem-backup seluruh database
# (termasuk semua schema di dalamnya) apa adanya.
PG_DUMP_URL="${DATABASE_URL%%\?*}"

echo "[backup-db] Mem-dump database ke ${FILEPATH} ..."
# Format custom (-Fc): terkompresi, dan bisa dipulihkan sebagian lewat
# pg_restore (bukan cuma pg_restore seluruh dump sekaligus seperti dump SQL
# polos) — lebih fleksibel untuk pemulihan darurat.
pg_dump --format=custom --file="$FILEPATH" "$PG_DUMP_URL"

echo "[backup-db] Mengunggah ke R2 (bucket: ${R2_BUCKET_NAME}) ..."
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  aws s3 cp "$FILEPATH" "s3://${R2_BUCKET_NAME}/${FILENAME}" \
    --endpoint-url "$R2_ENDPOINT"

echo "[backup-db] Menghapus dump lokal lebih tua dari ${BACKUP_RETENTION_DAYS} hari ..."
# Retensi di R2 sendiri (berapa lama disimpan di cloud) diatur lewat lifecycle
# rule di dashboard Cloudflare, di luar kendali skrip ini — retensi di sini
# HANYA untuk disk lokal VPS supaya tidak penuh.
find "$BACKUP_DIR" -name "tapgo-backup-*.dump" -mtime "+${BACKUP_RETENTION_DAYS}" -delete

echo "[backup-db] Selesai: ${FILENAME}"
