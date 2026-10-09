# Panduan cutover backend `e95cbed` (9 Okt 2026) — token PLN, satu sesi per akun, satu akun per HP, rekonsiliasi PPOB, bukti transaksi semua produk

Semua langkah dijalankan Owner di VPS; tidak ada yang dijalankan otomatis. Rilis aktif sebelum panduan ini: `/var/www/releases/tapgo-ebc3a5b`.
**Tanpa migrasi** (hanya kode dan uji). Hash penuh: `e95cbede83d5e831904b55cd9f4663b04ef8f682` (cabang `release/driver-rating`, sudah ada di GitHub setelah push).

Isi rilis (tiga commit di atas `ebc3a5b`):
1. `dd37db9` — server mengirim `serialNumber` (nomor token PLN) ke aplikasi; satu sesi aktif per akun USER kanal APP (login di HP kedua
   mematikan HP pertama dan menghapus token push-nya); batas satu akun per HP saat mendaftar (409 `DEVICE_ACCOUNT_LIMIT`); pendaftaran hanya
   menerima nomor seluler Indonesia (081-089, 10-13 digit, bukan deretan sama/berurutan; login tidak berubah).
2. `e95cbed` — rekonsiliasi PPOB menyala bawaan; token PLN "Sukses" tanpa SN ditahan PROCESSING; transaksi terbuka > 30 menit dicatat sebagai error.

Catatan perilaku yang perlu Anda ketahui:
- Sesi yang sudah ada tetap berlaku sampai pemiliknya login lagi; baru saat login berikutnya HP lain dikeluarkan.
- Login di HP juga mengakhiri sesi web (halaman /upgrade) akun itu; pengguna cukup login ulang di web.
- Batas akun per HP bisa diubah tanpa rilis ulang lewat `REGISTRATION_MAX_ACCOUNTS_PER_DEVICE` di `.env` (bawaan 1; 0 = mati), lalu `pm2 restart tapgo-api`.
- Aplikasi +43 yang beredar tidak mengenal pesan batas akun (menampilkan galat umum); +44 mengenalnya.

## Langkah 1. Pastikan proses aktif masih `tapgo-ebc3a5b`
```bash
pm2 describe tapgo-api | grep -q "/var/www/releases/tapgo-ebc3a5b/apps/backend" && echo "OK: proses aktif = tapgo-ebc3a5b" || echo "BERHENTI: proses aktif bukan tapgo-ebc3a5b"
```

## Langkah 2. Folder rilis baru dan build (tidak menyentuh pm2)
```bash
cd /var/www/releases && git clone "$(git -C tapgo-ebc3a5b remote get-url origin)" tapgo-e95cbed && cd tapgo-e95cbed && git checkout e95cbede83d5e831904b55cd9f4663b04ef8f682 && git rev-parse HEAD && cp /var/www/releases/tapgo-ebc3a5b/apps/backend/.env apps/backend/.env
```
```bash
cd /var/www/releases/tapgo-e95cbed && npm ci && npx prisma generate --schema apps/backend/prisma/schema.prisma && npm run build --workspace apps/backend
```
```bash
cd /var/www/releases/tapgo-e95cbed && ls -l apps/backend/dist/src/server.js && (cd apps/backend && node -e "require('argon2'); require('@prisma/client'); console.log('MODUL OK')") && grep -c "lacksRequiredSerial" apps/backend/dist/src/modules/ppob/domain/ppobProvider.js && grep -c "DEVICE_ACCOUNT_LIMIT" apps/backend/dist/src/modules/auth/infrastructure/PrismaAuthRepository.js && grep -c "findBillInquiriesByReferences" apps/backend/dist/src/modules/ppob/infrastructure/PrismaPpobRepository.js && git status --short
```
Syarat lanjut: `rev-parse` = hash penuh di atas; `MODUL OK`; ketiga `grep -c` bernilai 1 atau lebih; `git status` kosong.

## Langkah 3. Gerbang migrasi
```bash
cd /var/www/releases/tapgo-e95cbed/apps/backend && npx prisma migrate status 2>&1 | grep -E "up to date|pending|not yet|failed"
```
Harus "Database schema is up to date!". Bila tidak: **BERHENTI** dan kirim keluarannya.

## Langkah 4. Cutover (`delete` sebelum `start`)
```bash
cd /var/www/releases/tapgo-e95cbed/apps/backend && pm2 delete tapgo-api && pm2 start dist/src/server.js --name tapgo-api --cwd /var/www/releases/tapgo-e95cbed/apps/backend && pm2 save
```

## Langkah 5. Verifikasi
```bash
pm2 describe tapgo-api | grep -E "exec cwd|status|restarts"; curl -s -o /dev/null -w "health: %{http_code}\n" https://api.tapgolion.id/health; ss -ltnp | grep ':4000'
```
Hasil benar: `exec cwd` = `/var/www/releases/tapgo-e95cbed/apps/backend`, status `online`, `health: 200`, port 4000 dipegang satu `node` yang PID-nya sama dengan `pm2 pid tapgo-api`.

Tunggu 60 detik, lalu cek log (tanpa nilai rahasia):
```bash
pm2 logs tapgo-api --lines 120 --nostream | grep -i -E "reconcil|postpaid catalog|DIGIFLAZZ_WEBHOOK|PPOB:" | tail -12
```
Yang diharapkan: peringatan `DIGIFLAZZ_WEBHOOK_SECRET kosong` (wajar sampai webhook dipasang), dan TIDAK ada baris error
"PPOB_PROVIDER=digiflazz tetapi PPOB_RECONCILE_ENABLED=false". Bila muncul "ada transaksi tertahan lebih dari 30 menit", cek panel Digiflazz untuk transaksi itu.

## Langkah 6. Cek transaksi tertahan (hanya membaca)
```bash
DB=$(grep '^DATABASE_URL=' /var/www/releases/tapgo-e95cbed/apps/backend/.env | cut -d= -f2- | tr -d '"'); psql "${DB%%\?*}" -c "select status, category, count(*), min(created_at) as tertua from ppob_transactions where status in ('PENDING','PROCESSING') group by 1,2 order by 3 desc;"; unset DB
```
Dalam kondisi normal hasilnya kosong, atau hanya transaksi yang baru dibuat (kurang dari beberapa menit).

## Webhook Digiflazz (disarankan, bisa menyusul)
Rekonsiliasi per menit sudah menutup masalah transaksi tertahan. Webhook membuat hasil muncul seketika:
1. Isi `DIGIFLAZZ_WEBHOOK_SECRET` di `.env` rilis aktif dengan teks acak minimal 16 karakter, lalu `pm2 restart tapgo-api`.
2. Di panel Digiflazz pasang alamat `https://api.tapgolion.id/api/v1/webhooks/ppob/digiflazz` dengan secret yang sama.

## ROLLBACK — hanya bila Langkah 4/5 gagal
Tidak ada migrasi, jadi cukup kembali ke rilis sebelumnya:
```bash
pm2 delete tapgo-api && pm2 start /var/www/releases/tapgo-ebc3a5b/apps/backend/dist/src/server.js --name tapgo-api --cwd /var/www/releases/tapgo-ebc3a5b/apps/backend && pm2 save
```
