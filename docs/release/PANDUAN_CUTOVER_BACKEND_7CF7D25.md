# Panduan cutover backend `7cf7d25` (6 Okt 2026) — katalog pascabayar (kategori Tagihan)

Semua langkah dijalankan Owner di VPS; tidak ada yang dijalankan otomatis. Rilis aktif sebelum panduan ini: `/var/www/releases/tapgo-55a85a4`.
**Tanpa migrasi** (hanya `DigiflazzPpobProvider.ts` dan satu berkas uji). Hash penuh: `7cf7d25285a049b5f03060e71f0614b1f595cafb` (cabang `release/driver-rating`, sudah ada di GitHub).

Isi rilis: pembaca daftar harga pascabayar kini menerima beberapa bentuk jawaban Digiflazz (larik di `data`, larik tingkat atas, atau objek berisi baris), dan pesan galatnya memuat BENTUK jawaban (kunci dan tipe saja, tanpa isi) bila masih tidak dikenali. Penyebab katalog kosong di produksi: log menunjukkan "price-list rejected (HTTP 200, cmd=pasca): no payload".

Catatan batas Digiflazz (rc=83): daftar harga hanya boleh diminta sekali per beberapa menit. Setiap start proses memicu satu permintaan katalog; bila ditolak, sinkronisasi mengulang tiap 15 menit (maksimal 6 kali). Jangan me-restart berulang-ulang.

## Langkah 1. Pastikan proses aktif masih `tapgo-55a85a4`
```bash
pm2 describe tapgo-api | grep -q "/var/www/releases/tapgo-55a85a4/apps/backend" && echo "OK: proses aktif = tapgo-55a85a4" || echo "BERHENTI: proses aktif bukan tapgo-55a85a4"
```

## Langkah 2. Folder rilis baru dan build (tidak menyentuh pm2)
```bash
cd /var/www/releases
git clone "$(git -C tapgo-55a85a4 remote get-url origin)" tapgo-7cf7d25
cd tapgo-7cf7d25
git checkout 7cf7d25285a049b5f03060e71f0614b1f595cafb
git rev-parse HEAD
cp /var/www/releases/tapgo-55a85a4/apps/backend/.env apps/backend/.env
npm ci
npx prisma generate --schema apps/backend/prisma/schema.prisma
npm run build --workspace apps/backend
ls -l apps/backend/dist/src/server.js
(cd apps/backend && node -e "require('argon2'); require('@prisma/client'); console.log('MODUL OK')")
grep -c "extractPriceListRows" apps/backend/dist/src/modules/ppob/infrastructure/DigiflazzPpobProvider.js
grep -c "PPOB_POSTPAID_CATALOG_SYNC_ENABLED" apps/backend/.env
git status --short
```
Syarat lanjut: `rev-parse` = hash penuh di atas; `MODUL OK`; kedua `grep -c` bernilai 1 atau lebih; `git status` kosong.

## Langkah 3. Gerbang migrasi (tidak boleh ada yang menggantung)
```bash
cd /var/www/releases/tapgo-7cf7d25/apps/backend
npx prisma migrate status 2>&1 | tail -4
cd /var/www/releases/tapgo-7cf7d25
```
Harus berakhir "Database schema is up to date!". Bila tidak: **BERHENTI** dan kirim keluarannya.

## Langkah 4. Cutover (`delete` sebelum `start`)
```bash
pm2 delete tapgo-api
pm2 start dist/src/server.js --name tapgo-api --cwd /var/www/releases/tapgo-7cf7d25/apps/backend
pm2 save
```

## Langkah 5. Verifikasi
```bash
pm2 status
pm2 describe tapgo-api | grep -E "exec cwd|status|restarts"
git -C /var/www/releases/tapgo-7cf7d25 rev-parse --short HEAD
curl -s -o /dev/null -w "health: %{http_code}\n" https://api.tapgolion.id/health
ss -ltnp | grep ':4000'
sleep 45
pm2 logs tapgo-api --lines 80 --nostream | grep -i "postpaid catalog"
```
Hasil yang benar: `exec cwd` = `/var/www/releases/tapgo-7cf7d25/apps/backend`, status `online`, satu `tapgo-api`, `rev-parse` = `7cf7d25`, `health: 200`, port 4000 dipegang satu `node`.
Log "PPOB postpaid catalog sync completed" = berhasil. Bila yang muncul peringatan **rc=83**, tunggu 15 menit (ulang otomatis). Bila muncul galat yang menyebut bentuk jawaban (kunci/tipe), **tempel baris itu ke saya** — itulah data yang menentukan penyesuaian berikutnya.

## Langkah 6. Hitung produk pascabayar
```bash
DB=$(grep '^DATABASE_URL=' /var/www/releases/tapgo-7cf7d25/apps/backend/.env | cut -d= -f2- | tr -d '"')
psql "${DB%%\?*}" -c "select category, count(*) from ppob_products where is_postpaid group by 1 order by 2 desc;"
unset DB
```
Setelah ada produk: buka user_app, menu Digital > Tagihan; kategori yang punya produk terbuka, yang belum tampil "belum tersedia".

## ROLLBACK — hanya bila Langkah 4/5 gagal
Tidak ada migrasi, jadi cukup kembali ke rilis sebelumnya:
```bash
pm2 delete tapgo-api
pm2 start /var/www/releases/tapgo-55a85a4/apps/backend/dist/src/server.js --name tapgo-api --cwd /var/www/releases/tapgo-55a85a4/apps/backend
pm2 save
```
Produk pascabayar yang sudah terisi tetap di database dan tetap dikenali kode lama.
