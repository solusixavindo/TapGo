# Panduan aktivasi Midtrans Bank Transfer (13 Okt 2026) — top up dan membership tanpa transfer manual

Semua langkah dijalankan Owner; tidak ada yang dijalankan otomatis. Rilis aktif sebelum panduan ini: `/var/www/releases/tapgo-e2e3ad7`.
**Tanpa migrasi** (hanya kode dan uji). Hash penuh backend: `4a1687a78d856dac470271c01239f9fd361c8d0a` (cabang `release/driver-rating`, ada di GitHub setelah push).

Isi rilis (tiga commit di atas `e2e3ad7`):
1. `7b9b7ad` — daftar metode Snap dapat diatur lewat `MIDTRANS_ENABLED_PAYMENTS` (`all` = semua metode yang aktif di akun Midtrans);
   pembayaran transfer bank Midtrans masuk jalur pengembalian dana MANUAL (Midtrans menolak refund virtual account lewat API).
2. `4a1687a` — top up online: pelanggan membayar nominal + biaya layanan Rp4.440 (Rp4.000 + PPN 11%), saldo bertambah sebesar nominal saja.
   Webhook memeriksa total yang ditagih. Halaman Midtrans mengembalikan pelanggan ke `/topup/status/` atau `/upgrade/status/`.
3. `4a1687a` — cek harga PPOB prabayar (`/ppob/orders/inquiry`) hanya menghitung saldo PPOB (perbaikan audit M1 yang selama ini belum ada di
   cabang rilis): pelanggan yang mengisi Saldo TapGo tidak lagi melihat tombol bayar aktif lalu ditolak. Ditambah tes alur top up online sampai bayar pulsa dan tagihan.

Urutan penting: **kode dulu (Tahap 1), pengaturan Midtrans (Tahap 2), baru saklar `.env` (Tahap 3)**. Selama Tahap 3 belum dilakukan, perilaku produksi tidak berubah.

## Tahap 1. Cutover backend (kode saja, perilaku belum berubah)

Pastikan proses aktif masih `tapgo-e2e3ad7`:
```bash
pm2 describe tapgo-api | grep -q "/var/www/releases/tapgo-e2e3ad7/apps/backend" && echo "OK: proses aktif = tapgo-e2e3ad7" || echo "BERHENTI: proses aktif bukan tapgo-e2e3ad7"
```
Folder rilis baru dan build (tidak menyentuh pm2):
```bash
cd /var/www/releases && git clone "$(git -C tapgo-e2e3ad7 remote get-url origin)" tapgo-4a1687a && cd tapgo-4a1687a && git checkout 4a1687a78d856dac470271c01239f9fd361c8d0a && git rev-parse HEAD && cp /var/www/releases/tapgo-e2e3ad7/apps/backend/.env apps/backend/.env
```
```bash
cd /var/www/releases/tapgo-4a1687a && npm ci && npx prisma generate --schema apps/backend/prisma/schema.prisma && npm run build --workspace apps/backend
```
```bash
cd /var/www/releases/tapgo-4a1687a && ls -l apps/backend/dist/src/server.js && (cd apps/backend && node -e "require('argon2'); require('@prisma/client'); console.log('MODUL OK')") && grep -c "resolveMidtransEnabledPayments" apps/backend/dist/src/modules/payments/application/MidtransPaymentService.js && grep -c "topUpOnlineFee" apps/backend/dist/src/core/finance/midtransFees.js && grep -c "createOnlineOrder" apps/backend/dist/src/modules/wallets/application/WalletTopUpPaymentService.js && git status --short
```
Syarat lanjut: `rev-parse` = hash penuh di atas; `MODUL OK`; ketiga `grep -c` bernilai 1 atau lebih; `git status` kosong.

Gerbang migrasi (harus "Database schema is up to date!"; bila tidak, **BERHENTI** dan kirim keluarannya):
```bash
cd /var/www/releases/tapgo-4a1687a/apps/backend && npx prisma migrate status 2>&1 | grep -E "up to date|pending|not yet|failed"
```
Cutover (`delete` sebelum `start`):
```bash
cd /var/www/releases/tapgo-4a1687a/apps/backend && pm2 delete tapgo-api && pm2 start dist/src/server.js --name tapgo-api --cwd /var/www/releases/tapgo-4a1687a/apps/backend && pm2 save
```
Verifikasi:
```bash
pm2 describe tapgo-api | grep -E "exec cwd|status|restarts"; curl -s -o /dev/null -w "health: %{http_code}\n" https://api.tapgolion.id/health; ss -ltnp | grep ':4000'
```
Hasil benar: `exec cwd` = `/var/www/releases/tapgo-4a1687a/apps/backend`, status `online`, `health: 200`, port 4000 dipegang satu `node`.

## Tahap 2. Pengaturan di dashboard Midtrans (Anda, lewat peramban)

Masuk ke dashboard Midtrans **mode Production**, lalu:
1. **Settings → Configuration → Payment Notification URL**: isi `https://api.tapgolion.id/api/v1/payments/midtrans/notification` lalu Simpan.
   Tanpa ini Midtrans tidak memberi tahu server bahwa pelanggan sudah membayar, dan saldo/membership tidak akan bertambah otomatis.
2. **Settings → Snap Preferences → System Settings**: biarkan *Finish Redirect URL* kosong (server sudah mengirim alamat kembali sendiri
   dari `APP_URL`). Bila kolom itu wajib diisi, isi `https://tapgolion.id/topup/status/`.
3. Pastikan **Bank Transfer** (Bank Transfer Aggregator) berstatus aktif di **Settings → Snap Preferences → Payment Channels / Payment Methods**.

Periksa `APP_URL` di server (nilai ini bukan rahasia):
```bash
grep -E '^(APP_URL|MIDTRANS_IS_PRODUCTION|DOKU_ENABLED)=' /var/www/releases/tapgo-4a1687a/apps/backend/.env; grep -c '^MIDTRANS_SERVER_KEY=SB-' /var/www/releases/tapgo-4a1687a/apps/backend/.env
```
Hasil benar: `APP_URL=https://tapgolion.id`, `MIDTRANS_IS_PRODUCTION=true`, `DOKU_ENABLED=false` (atau tidak ada), dan angka terakhir `0`
(angka 1 berarti kunci sandbox: **berhenti** dan kabari saya). Bila `APP_URL` kosong atau salah, perbaiki di Tahap 3.

## Tahap 3. Saklar `.env` (di sini perilaku berubah)

Transfer manual **masih dibiarkan menyala** sampai uji nyata lolos (Tahap 5).

Metode Snap sengaja dibatasi ke VA bank yang aktif di akun (BNI, BRI, CIMB Niaga, Permata, Mandiri). Jangan memakai `all`: GoPay juga aktif di akun
dan biayanya 2% dari nominal, sedangkan biaya yang ditagihkan ke pelanggan pada top up hanya Rp4.440. Bila kelak BSI/BCA/dst. diaktifkan, tambahkan
kode metodenya ke daftar ini.
```bash
cd /var/www/releases/tapgo-4a1687a/apps/backend && for kv in "MIDTRANS_ENABLED_PAYMENTS=bni_va,bri_va,cimb_va,permata_va,echannel" "MEMBERSHIP_ONLINE_PAYMENT_ENABLED=true" "EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED=true" "MEMBERSHIP_PURCHASE_WEB_ENABLED=true" "WALLET_TOPUP_ENABLED=true"; do k=${kv%%=*}; if grep -q "^$k=" .env; then sed -i "s|^$k=.*|$kv|" .env; else echo "$kv" >> .env; fi; done; grep -E '^(MIDTRANS_ENABLED_PAYMENTS|MEMBERSHIP_ONLINE_PAYMENT_ENABLED|EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED|MEMBERSHIP_PURCHASE_WEB_ENABLED|WALLET_TOPUP_ENABLED|APP_URL)=' .env
```
Jika `APP_URL` tidak muncul atau bukan `https://tapgolion.id`, jalankan:
```bash
cd /var/www/releases/tapgo-4a1687a/apps/backend && (grep -q '^APP_URL=' .env && sed -i 's|^APP_URL=.*|APP_URL=https://tapgolion.id|' .env || echo 'APP_URL=https://tapgolion.id' >> .env) && grep '^APP_URL=' .env
```
Mulai ulang proses agar `.env` terbaca:
```bash
pm2 restart tapgo-api --update-env && sleep 5 && curl -s -o /dev/null -w "health: %{http_code}\n" https://api.tapgolion.id/health
```

## Tahap 4. Unggah landing

Berkas: `tapgolion-hostinger-upload-topup-online.zip` (ada di Desktop). Unggah dan ekstrak ke `public_html` Hostinger seperti zip sebelumnya
(timpa berkas lama). Pastikan `.htaccess` ikut terunggah. Setelah itu buka `https://tapgolion.id/topup/` dengan penyegaran paksa (Cmd+Shift+R).

## Tahap 5. Uji nyata dengan nominal terkecil

1. Di `https://tapgolion.id/topup/`, masuk dengan akun uji Anda, pilih **Saldo PPOB**, nominal **Rp25.000**.
2. Halaman harus menampilkan: Top up Rp25.000, Biaya layanan pembayaran Rp4.440, **Total yang dibayar Rp29.440**. Tekan **Bayar Rp29.440**.
3. Di halaman Midtrans pilih bank, bayar **tepat Rp29.440** dari m-banking Anda.
4. Kembali ke halaman status: status **Berhasil**, dan Saldo PPOB di aplikasi bertambah **Rp25.000** (bukan Rp29.440).

Pemeriksaan di server (hanya membaca):
```bash
DB=$(grep '^DATABASE_URL=' /var/www/releases/tapgo-4a1687a/apps/backend/.env | cut -d= -f2- | tr -d '"'); psql "${DB%%\?*}" -c "select reference, status, amount, metadata->>'paymentType' as jenis, metadata->>'grossAmount' as ditagih, metadata->>'feeAmount' as biaya, paid_at from wallet_topup_orders order by created_at desc limit 3;"; unset DB
```
Hasil benar: `status = PAID`, `amount = 25000.00`, `ditagih = 29440`, `biaya = 4440`. **Kirimkan kolom `jenis` kepada saya**: itu nama jenis
pembayaran yang dilaporkan Midtrans untuk Bank Transfer Aggregator, dan saya mencocokkannya dengan tabel biaya serta aturan refund manual.

Jika setelah membayar status tetap "Menunggu pembayaran" lebih dari 5 menit:
```bash
pm2 logs tapgo-api --lines 200 --nostream | grep -i -E "midtrans|notification" | tail -15
```
dan kirim hasilnya (tanpa menyalin kunci apa pun). Penyebab paling mungkin: Payment Notification URL (Tahap 2) belum tersimpan.

## Tahap 6. Matikan transfer manual (hanya setelah Tahap 5 lolos)

Pastikan tidak ada pesanan transfer manual yang masih menunggu:
```bash
DB=$(grep '^DATABASE_URL=' /var/www/releases/tapgo-4a1687a/apps/backend/.env | cut -d= -f2- | tr -d '"'); psql "${DB%%\?*}" -c "select 'topup' as jenis, count(*) from wallet_topup_orders where provider='MANUAL_BANK' and status='PENDING' union all select 'membership', count(*) from membership_payments where provider='MANUAL_BANK' and status='PENDING';"; unset DB
```
Bila ada yang masih menunggu, konfirmasi atau tolak dulu di konsol admin (Super Admin) sebelum lanjut. Konfirmasi dan penolakan tetap berfungsi
setelah saklar dimatikan, jadi transfer yang terlanjur dikirim pelanggan masih dapat diproses.
```bash
cd /var/www/releases/tapgo-4a1687a/apps/backend && for kv in "MANUAL_MEMBERSHIP_TRANSFER_ENABLED=false" "MANUAL_TOPUP_ENABLED=false"; do k=${kv%%=*}; if grep -q "^$k=" .env; then sed -i "s|^$k=.*|$kv|" .env; else echo "$kv" >> .env; fi; done; grep -E '^(MANUAL_MEMBERSHIP_TRANSFER_ENABLED|MANUAL_TOPUP_ENABLED)=' .env && pm2 restart tapgo-api --update-env && sleep 5 && curl -s -o /dev/null -w "health: %{http_code}\n" https://api.tapgolion.id/health
```
Setelah ini halaman web hanya menawarkan pembayaran online. Jika Midtrans sedang bermasalah, pelanggan melihat pesan "Top up sedang tidak tersedia"
(bukan error teknis); untuk membuka transfer manual lagi cukup ubah kedua saklar di atas menjadi `true` dan mulai ulang.

## Tahap 7. Konsol admin (menyusul, tidak mendesak)

Konsol admin yang terpasang belum menampilkan kotak "pengembalian dana manual" untuk pembayaran membership lewat transfer bank Midtrans.
Dampaknya hanya pada kasus dokumen ditolak setelah pelanggan membayar lewat transfer bank; server sudah benar (menolak refund lewat gateway dan
menerima pencatatan refund manual). Agar saya membangun konsol dengan alamat dasar yang sama dengan yang terpasang, jalankan dan kirim hasilnya:
```bash
grep -o '/[A-Za-z0-9_-]*/_next/static' /var/www/admin/index.html | head -1
```

## Pengembalian dana (refund) setelah ini
- Membership dibayar transfer bank (manual maupun Midtrans) lalu dokumen ditolak: refund manual dari rekening perusahaan, lalu Super Admin
  mencatatnya di konsol admin dengan nomor referensi bank.
- Top up yang sudah berhasil tidak dikembalikan otomatis; saldo dapat dipakai atau (Saldo TapGo) dicairkan sesuai aturan yang berlaku.
- Biaya layanan Rp4.440 tidak termasuk saldo dan tidak ikut dikembalikan.

## ROLLBACK — hanya bila Tahap 1/3 gagal
Matikan jalur online tanpa mengganti kode (cukup `.env` rilis aktif):
```bash
cd /var/www/releases/tapgo-4a1687a/apps/backend && for kv in "MEMBERSHIP_ONLINE_PAYMENT_ENABLED=false" "MANUAL_MEMBERSHIP_TRANSFER_ENABLED=true" "MANUAL_TOPUP_ENABLED=true" "WALLET_TOPUP_ENABLED=false"; do k=${kv%%=*}; if grep -q "^$k=" .env; then sed -i "s|^$k=.*|$kv|" .env; else echo "$kv" >> .env; fi; done; pm2 restart tapgo-api --update-env
```
Kembali ke kode sebelumnya (tidak ada migrasi):
```bash
pm2 delete tapgo-api && pm2 start /var/www/releases/tapgo-e2e3ad7/apps/backend/dist/src/server.js --name tapgo-api --cwd /var/www/releases/tapgo-e2e3ad7/apps/backend && pm2 save
```
