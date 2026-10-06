# Panduan cutover backend `e8d40b3` (6 Okt 2026)

Semua langkah dijalankan Owner di VPS; tidak ada yang dijalankan otomatis. Rilis aktif sebelum panduan ini: `/var/www/releases/tapgo-fb57f6e`.
Isi rilis: bunyi notifikasi per perangkat, PPOB pascabayar (BPJS, PDAM, PLN pasca, BPJS TK, Telkom, internet, TV, HP pasca, angsuran, PBB, gas, e-money).
Tiga migrasi baru, semuanya aditif: `20261006120000_push_token_sound`, `20261006150000_ppob_postpaid_bills`, `20261006160000_ppob_postpaid_categories`.

Hash penuh: `e8d40b3aa0a4a83b15f4337cb1e2f3bbb07fb6f5` (cabang `release/driver-rating`).
Bila tulisan **BERHENTI** muncul, jangan lanjut dan kirim keluarannya.

## Langkah 1. Pastikan proses aktif masih `tapgo-fb57f6e`
```bash
pm2 describe tapgo-api | grep -q "/var/www/releases/tapgo-fb57f6e/apps/backend" && echo "OK: proses aktif = tapgo-fb57f6e" || echo "BERHENTI: proses aktif bukan tapgo-fb57f6e"
```

## Langkah 2. Cadangan database (wajib)
```bash
DB=$(grep '^DATABASE_URL=' /var/www/releases/tapgo-fb57f6e/apps/backend/.env | cut -d= -f2- | tr -d '"')
pg_dump "${DB%%\?*}" -Fc -f /root/tapgo-pra-e8d40b3-$(date +%F-%H%M).dump
chmod 600 /root/tapgo-pra-e8d40b3-*.dump
ls -lh /root/tapgo-pra-e8d40b3-*.dump
pg_restore --list /root/tapgo-pra-e8d40b3-*.dump | head -3
psql "${DB%%\?*}" -tAc "show server_version"
unset DB
```
Versi PostgreSQL harus 12 atau lebih baru (migrasi kategori menambah nilai enum). Bila lebih lama: **BERHENTI**.

## Langkah 3. Folder rilis baru dan build (tidak menyentuh pm2)
```bash
cd /var/www/releases
git clone "$(git -C tapgo-fb57f6e remote get-url origin)" tapgo-e8d40b3
cd tapgo-e8d40b3
git checkout e8d40b3aa0a4a83b15f4337cb1e2f3bbb07fb6f5
git rev-parse HEAD
cp /var/www/releases/tapgo-fb57f6e/apps/backend/.env apps/backend/.env
npm ci
npx prisma generate --schema apps/backend/prisma/schema.prisma
npm run build --workspace apps/backend
ls -l apps/backend/dist/src/server.js
(cd apps/backend && node -e "require('argon2'); require('@prisma/client'); console.log('MODUL OK')")
grep -c "bills/inquiry" apps/backend/dist/src/modules/ppob/presentation/ppob.routes.js
grep -c "pushChannelForSound" apps/backend/dist/src/modules/notifications/infrastructure/FcmClient.js
grep -c "PPOB_POSTPAID_CATALOG_SYNC_ENABLED" apps/backend/dist/src/config/env.js
git status --short
```
Syarat lanjut: `rev-parse` = hash penuh di atas; `MODUL OK`; ketiga `grep -c` bernilai 1 atau lebih; `git status` kosong.

## Langkah 4. Gerbang migrasi (hanya tiga migrasi ini yang boleh menggantung)
```bash
cd /var/www/releases/tapgo-e8d40b3/apps/backend
npx prisma migrate status 2>&1 | tail -14
PENDING=$(npx prisma migrate status 2>&1 | grep -E '^[0-9]{14}_[a-z0-9_]+$' | tr '\n' ' ')
echo "menggantung: [$PENDING]"
[ "$PENDING" = "20261006120000_push_token_sound 20261006150000_ppob_postpaid_bills 20261006160000_ppob_postpaid_categories " ] && echo "GERBANG OK: tepat tiga migrasi" || echo "BERHENTI: migrasi menggantung tidak sesuai"
```

## Langkah 5. Terapkan migrasi (hanya bila Langkah 4 menulis GERBANG OK)
```bash
npx prisma migrate deploy
npx prisma migrate status 2>&1 | tail -3
cd /var/www/releases/tapgo-e8d40b3
```
Harus berakhir "Database schema is up to date!". Bila gagal: jangan cutover, kirim galatnya. Proses lama masih melayani dan kode lama tidak terganggu migrasi aditif ini.

## Langkah 6. Cutover (`delete` sebelum `start`)
```bash
pm2 delete tapgo-api
pm2 start dist/src/server.js --name tapgo-api --cwd /var/www/releases/tapgo-e8d40b3/apps/backend
pm2 save
```

## Langkah 7. Verifikasi
```bash
pm2 status
pm2 describe tapgo-api | grep -E "exec cwd|status|restarts"
git -C /var/www/releases/tapgo-e8d40b3 rev-parse --short HEAD
curl -s -o /dev/null -w "health: %{http_code}\n" https://api.tapgolion.id/health
ss -ltnp | grep ':4000'
pm2 logs tapgo-api --lines 30 --nostream
DB=$(grep '^DATABASE_URL=' /var/www/releases/tapgo-e8d40b3/apps/backend/.env | cut -d= -f2- | tr -d '"')
psql "${DB%%\?*}" -c "\d ppob_bill_inquiries" | head -8
psql "${DB%%\?*}" -tAc "select column_name from information_schema.columns where table_name='push_tokens' and column_name='sound'"
psql "${DB%%\?*}" -tAc "select enum_range(null::\"PpobCategory\")"
unset DB
```
Hasil yang benar: `exec cwd` = `/var/www/releases/tapgo-e8d40b3/apps/backend`, status `online`, satu `tapgo-api`, restarts 0; `rev-parse` = `e8d40b3`; `health: 200`; port 4000 dipegang satu `node`; log tanpa galat baru (`EADDRINUSE` lama di berkas galat adalah sisa dan bukan bukti); tabel `ppob_bill_inquiries` ada; kolom `sound` ada; enum memuat `BPJS_TK`, `TELKOM`, `INTERNET`, `TV`, `HP_POSTPAID`, `MULTIFINANCE`, `PBB`, `GAS`, `EMONEY`.

## Langkah 8. Katalog pascabayar (SETELAH Langkah 7 benar dan probe daftar harga berhasil)
Probe dulu (tunggu beberapa menit sejak percobaan terakhir; batas pengecekan Digiflazz `rc=83`):
```bash
node /root/digiflazz-pasca-probe.mjs --env /var/www/releases/tapgo-e8d40b3/apps/backend/.env
```
Tempel hasilnya ke saya sebelum menyalakan sinkronisasi, supaya pengelompokan kategori bisa disesuaikan lebih dulu. Lalu nyalakan saklarnya (tidak mengubah harga prabayar; saklar harga prabayar terpisah):
```bash
echo 'PPOB_POSTPAID_CATALOG_SYNC_ENABLED=true' >> /var/www/releases/tapgo-e8d40b3/apps/backend/.env
pm2 restart tapgo-api --update-env
sleep 20
pm2 logs tapgo-api --lines 80 --nostream | grep -i "postpaid catalog"
DB=$(grep '^DATABASE_URL=' /var/www/releases/tapgo-e8d40b3/apps/backend/.env | cut -d= -f2- | tr -d '"')
psql "${DB%%\?*}" -c "select category, count(*) from ppob_products where is_postpaid group by 1 order by 2 desc;"
unset DB
```
Log harus memuat "PPOB postpaid catalog sync completed" dengan `ignoredBrands` (brand pascabayar yang belum dibuka, jawaban "layanan apa saja yang ada"). Tempel hasilnya.

## ROLLBACK — hanya bila Langkah 6/7 gagal; jangan dijalankan bersama blok lain
Urutan penting: nonaktifkan produk pascabayar dulu. Kode lama tidak mengenalnya: produk berharga 0 bisa muncul di katalog prabayar lama.
```bash
DB=$(grep '^DATABASE_URL=' /var/www/releases/tapgo-e8d40b3/apps/backend/.env | cut -d= -f2- | tr -d '"')
psql "${DB%%\?*}" -c "update ppob_products set is_active=false where is_postpaid;"
unset DB
pm2 delete tapgo-api
pm2 start /var/www/releases/tapgo-fb57f6e/apps/backend/dist/src/server.js --name tapgo-api --cwd /var/www/releases/tapgo-fb57f6e/apps/backend
pm2 save
```
Rollback tidak membatalkan migrasi (aditif; tabel, kolom, dan nilai enum tertinggal tanpa mengganggu kode lama). Catatan: pelanggan yang SUDAH membayar tagihan kategori baru akan gagal memuat riwayat PPOB mereka di kode lama (nilai enum tak dikenal) sampai rilis maju lagi. Setelah rollback, hubungi saya sebelum mencoba ulang.

## Yang aktif setelah cutover
- Bunyi pilihan driver saat aplikasi tertutup (APK driver +14/+15).
- Tile Tagihan di user_app +40/+41 (mengisi daftar produk setelah Langkah 8).
- Rute prabayar lama tidak diubah. Perbaikan `Idempotency-Key` wajib untuk pembelian PPOB prabayar BELUM ada di produksi (hanya rute pascabayar baru yang mewajibkannya).

---

# Lanjutan: rilis `55a85a4` (tanpa migrasi) — katalog pascabayar bebas dari batas rc=83

Dasar: log produksi 6 Okt menunjukkan `PPOB_PRICE_SYNC_ENABLED=true`; sinkronisasi harga prabayar ikut meminta daftar `pasca` (sia-sia) dan menghabiskan jatah Digiflazz tiap start. `55a85a4` menghentikan itu, memberi katalog satu permintaan per siklus, dan mengulang 15 menit (maks 6x) bila kena batas.
Hash penuh: lihat `git rev-parse release/driver-rating` saat panduan diberikan. Rilis aktif sebelumnya: `tapgo-e8d40b3`. Tidak ada migrasi baru, jadi cadangan database tidak wajib (cadangan Langkah 2 di atas masih terbaru).

1. Pastikan aktif `tapgo-e8d40b3`.
2. Clone ke `tapgo-55a85a4`, checkout hash penuh, salin `.env`, tambahkan `PPOB_POSTPAID_CATALOG_SYNC_ENABLED=true`, `npm ci`, `prisma generate`, build, cek `MODUL OK`.
3. `prisma migrate status` harus "Database schema is up to date!" (tidak ada yang menggantung).
4. Cutover: `pm2 delete tapgo-api` lalu `pm2 start ... --cwd <folder baru>/apps/backend`, `pm2 save`.
5. Verifikasi: cwd, restarts 0, `health: 200`, dan log "PPOB postpaid catalog sync completed" (atau peringatan rc=83 yang diulang 15 menit).
6. Hitung produk: `select category, count(*) from ppob_products where is_postpaid group by 1;`

Rollback: nonaktifkan produk pascabayar (`update ppob_products set is_active=false where is_postpaid;`) lalu jalankan kembali `tapgo-e8d40b3` (skema sama).
