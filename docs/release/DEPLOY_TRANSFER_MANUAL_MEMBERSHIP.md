# Deploy: upgrade membership lewat transfer bank manual

Dokumen ini untuk Owner/operator yang mengeksekusi di VPS produksi. Tidak ada nilai rahasia di sini; semua nilai nyata diisi langsung di `.env` VPS.

**Cakupan PR:** [solusixavindo/TapGo#1](https://github.com/solusixavindo/TapGo/pull/1) membawa tiga hal sekaligus — remediasi audit keamanan 30 September, kesiapan driver_app, dan transfer manual membership. Jadi deploy backend ini juga membawa dua kelompok pertama (flag-nya tetap mati bawaan, lihat bagian 3).

**Asumsi yang belum saya verifikasi:** cara backend berjalan di VPS saat ini. Dokumen lama (`docs/midtrans/MIDTRANS_VPS_CHECKLIST.md`) memakai **pm2** di `/var/www/Tapgo` dengan proses `tapgo-api`. Workflow `cd.yml` (Docker, tag `v*`) belum disiapkan secrets-nya. Langkah di bawah memakai pm2; sesuaikan bila VPS sudah memakai Docker.

---

## 0. Keputusan yang harus diambil SEBELUM go-live

### 0.1 Penolakan dokumen pada pembayaran manual (sudah ditutup di kode)
Uang transfer manual tidak pernah lewat Midtrans, jadi refund via gateway tidak berlaku. Penanganannya:
- Tombol **"Tolak dan kembalikan dana"** mencatat kewajiban refund (status `PENDING`; label di konsol: "Ditolak, dana belum dikembalikan").
- Rute lama `execute-refund` untuk pesanan manual kini menjawab 409 `MEMBERSHIP_REFUND_MANUAL_REQUIRED` dan **tidak memanggil gateway**.
- **Super Admin** mengembalikan dana lewat transfer bank dari rekening perusahaan (menghubungi pemohon untuk rekening tujuan; nomor HP tampil penuh bagi Super Admin), lalu di konsol menekan **"Catat dana sudah dikembalikan"** dengan **nomor referensi transfer balik** dari mutasi bank (wajib).
- Hasilnya: payment dan invoice `REFUNDED`, audit `MEMBERSHIP_REFUND_COMPLETED` (pelaku, nominal, referensi bank). Tidak bisa dicatat dua kali. Admin biasa tidak dapat melakukannya.
- Pencatatan itu **hanya pembukuan**: sistem tidak menggerakkan uang. Pastikan transfer balik benar-benar sudah dilakukan sebelum menekan tombol.

### 0.2 Opsi pembayaran online ikut tampil bila kunci gateway terisi
Halaman bayar menampilkan tombol online bila `DOKU_ENABLED=true` **atau** `MIDTRANS_SERVER_KEY` terisi (kunci sandbox pun terhitung). Selama Midtrans belum menjawab, pengguna bisa memilih jalur online yang belum siap.
- Bila `MIDTRANS_SERVER_KEY` dipakai fitur lain (top up, webhook), jangan dikosongkan sembarangan. Katakan bila Anda ingin saya memisahkan "online untuk membership" menjadi flag tersendiri.
- Bila tidak dipakai fitur lain: `DOKU_ENABLED=false` dan kosongkan `MIDTRANS_SERVER_KEY` agar hanya transfer bank yang tampil.

### 0.3 Operator
Harus ada Super Admin yang rutin mencocokkan mutasi dan menekan **"Konfirmasi transfer masuk"**, serta Admin untuk verifikasi dokumen. Pengajuan tanpa konfirmasi kedaluwarsa dalam 24 jam (`MANUAL_TOPUP_EXPIRY_HOURS`, berlaku sama untuk top up dan membership).

---

## 1. Persiapan (sebelum menyentuh produksi)

1. PR #1 sudah lolos CI (GitGuardian: tiga false positive sudah Anda tandai). Review lalu **merge** — keputusan merge ada pada Owner.
2. Cadangkan database:
   ```bash
   bash scripts/backup-db.sh        # atau pg_dump -Fc manual ke lokasi aman di luar VPS
   ```
3. **Periksa saldo negatif** (migrasi ke-3 berhenti bila ada). Catatan: `npm run audit:production-data` TIDAK memeriksa ini (itu audit data uji/dummy); pakai SQL:
   ```sql
   SELECT id, user_id, balance, cash_balance, ppob_balance
   FROM wallets
   WHERE balance < 0 OR cash_balance < 0 OR ppob_balance < 0;
   ```
   Harus 0 baris. Bila ada, telusuri dan perbaiki datanya dengan jejak audit; jangan memaksa melewati constraint.
4. Pastikan `nginx` mengizinkan unggahan dokumen: `client_max_body_size 6M;` (sudah ada di `infra/nginx/tapgo-backend.conf`; batas aplikasi 5 MB per berkas).

## 2. Deploy kode (flag masih mati)

Urutan ini disengaja: kode dan UI naik **lebih dulu**, fitur dinyalakan **terakhir**.

### 2.1 Backend
```bash
cd /var/www/Tapgo
git fetch origin && git checkout main && git pull --ff-only
npm ci
npx prisma generate --schema apps/backend/prisma/schema.prisma
npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
npm --workspace apps/backend run build
pm2 restart tapgo-api --update-env
pm2 save
curl -s https://api.tapgolion.id/health        # harus success:true
pm2 logs tapgo-api --lines 80                  # tidak ada galat saat start
```
Tiga migrasi baru dijalankan: `ride_sos_alerts`, `driver_fatigue_and_face_recheck`, `wallet_balance_check_constraints`. Semuanya aditif.

### 2.2 Landing page (situs statis)
Build dengan **tanpa** mode pratinjau:
```bash
cd apps/landing-page
# NEXT_PUBLIC_TAPGO_API_BASE_URL bawaan sudah https://api.tapgolion.id/api/v1
# JANGAN set NEXT_PUBLIC_TAPGO_UPGRADE_PREVIEW=true (itu menampilkan DATA CONTOH)
npm run build
```
Salin isi `apps/landing-page/out/` ke root web `tapgolion.id` dengan cara yang selama ini Anda pakai. Pastikan `CORS_ORIGINS` backend memuat `https://tapgolion.id`.

### 2.3 Konsol admin (statis, satu domain dengan API)
```bash
cd apps/admin_dashboard
NEXT_PUBLIC_TAPGO_API_BASE_URL=/api/v1 npm run build   # basePath mengikuti TAPGO_ADMIN_BASE_PATH bila dipakai
```
Salin hasilnya ke lokasi `/admin/` seperti biasa (lihat komentar di `apps/admin_dashboard/next.config.mjs`).

Aman bila UI naik sebelum flag: landing page yang gagal membaca opsi pembayaran kembali ke perilaku lama; panel transfer di admin hanya muncul untuk pesanan manual.

## 3. Env produksi

Edit `apps/backend/.env` di VPS. Nilai di bawah adalah **nama dan bentuk**, bukan nilai nyata.

### 3.1 Wajib diisi untuk transfer manual
| Variabel | Nilai | Catatan |
|---|---|---|
| `EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED` | `true` | Gerbang induk pembayaran membership |
| `MEMBERSHIP_PURCHASE_WEB_ENABLED` | `true` | Kanal web terbuka; aplikasi Play tetap tertutup |
| `MANUAL_MEMBERSHIP_TRANSFER_ENABLED` | `true` | **Terakhir dinyalakan** |
| `MANUAL_TOPUP_BANK_NAME` | nama bank | Rekening perusahaan yang **nyata** |
| `MANUAL_TOPUP_ACCOUNT_NUMBER` | nomor rekening | Dipakai bersama top up manual |
| `MANUAL_TOPUP_ACCOUNT_HOLDER` | nama pemilik rekening | Harus sama dengan nama di bank |
| `MEMBERSHIP_DOCUMENT_SECRET` | acak ≥ 32 karakter | Buat: `openssl rand -hex 32`. Tanpa ini unggah KTP/swafoto selalu gagal (503). Simpan; mengganti nilainya membuat dokumen tersimpan tidak terbaca |

### 3.2 Tetap dipastikan
| Variabel | Nilai |
|---|---|
| `MEMBERSHIP_PURCHASE_APP_ENABLED` | `false` (aplikasi Play tidak boleh menjual; bawaan sudah false) |
| `MANUAL_TOPUP_EXPIRY_HOURS` | `24` (bawaan) |
| `MEMBERSHIP_DOCUMENT_RETENTION_HOURS` | `24` (bawaan) |
| `CORS_ORIGINS` | memuat `https://tapgolion.id` |
| `NODE_ENV` | `production` |

### 3.3 Jangan diubah oleh deploy ini
`DRIVER_COMMISSION_ENABLED`, `DRIVER_FACE_CHECK_ENABLED`, `DRIVER_LEGACY_CLIENT_BLOCK_ENABLED` dan flag produksi lain tetap seperti sekarang. Keputusan mengaktifkannya terpisah dari upgrade membership.

Terapkan:
```bash
pm2 restart tapgo-api --update-env && pm2 save
```
Bila gagal start dengan galat env, `pm2 logs tapgo-api` menyebut variabel yang salah; kembalikan flag ke `false` dan restart.

## 4. Uji sekali di produksi (akun Anda sendiri)

1. Buka `https://tapgolion.id/upgrade`, login dengan akun uji milik Anda, pilih paket terendah.
2. Isi data, unggah KTP dan swafoto, lanjut ke pembayaran. **Hanya** "Bayar dengan transfer bank" yang tampil (bila 0.2 sudah dibereskan).
3. Catat nominal berkode unik, transfer **tepat** sebesar itu dari rekening Anda.
4. Login Super Admin → Verifikasi Keanggotaan → pastikan nominal tampil di antrean → cocokkan dengan mutasi → **Konfirmasi transfer masuk**.
5. Status member berubah ke "Menunggu verifikasi" (membership belum aktif).
6. Login Admin → **Verifikasi dan aktifkan** → status "Aktif"; periksa bonus sponsor (bila ada) dan satu baris audit `MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED`.
7. (Opsional, disarankan) Uji jalur tolak dengan akun uji kedua: Admin menolak dokumen, Super Admin mentransfer balik ke rekening Anda lalu mencatat referensinya; pastikan status berubah ke "Ditolak, dana dikembalikan".

Baru setelah lolos, umumkan ke pengguna.

## 5. Mematikan / rollback

- **Matikan fitur seketika:** `MANUAL_MEMBERSHIP_TRANSFER_ENABLED=false` lalu `pm2 restart tapgo-api --update-env`. Pengajuan yang sudah dikonfirmasi tetap sah dan diteruskan ke verifikasi; yang belum dibayar kedaluwarsa sendiri.
- **Menutup seluruh upgrade web:** `MEMBERSHIP_PURCHASE_WEB_ENABLED=false`.
- **Rollback kode:** `git checkout <commit/tag sebelumnya>`, build, restart. Tiga migrasi bersifat aditif dan tidak perlu dibatalkan (constraint saldo justru melindungi).
- Konfirmasi transfer tetap bisa dilakukan Super Admin walau flag dimatikan, supaya uang yang terlanjur masuk tidak terkunci.

## 6. Setelah go-live (operasional harian)

- Cek antrean Verifikasi Keanggotaan secara berkala; transfer yang dikonfirmasi setelah batas waktu tampil dengan peringatan, dan ditolak sistem (409) bila nominalnya kembar dengan pesanan terbuka lain — cek mutasi manual.
- Dokumen identitas terhapus otomatis ≤ 24 jam; verifikasi sebelum itu.
- Tiap konfirmasi tercatat di audit log (`MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED`) dengan pelaku, nominal, dan kode unik.

## 7. Catatan teknis yang perlu diketahui

- Rute lama `POST /admin/member-requests/:id/approve` (Super Admin) masih bisa mengonfirmasi pesanan manual tanpa pemeriksaan nominal kembar untuk transfer terlambat. UI memakai `confirm-transfer`. Perannya sama (Super Admin), jadi bukan eskalasi hak akses.
- Versi aplikasi tidak dinaikkan; build rilis driver_app 1.0.0+4 dan uji lapangan driver belum dinyatakan lolos.
