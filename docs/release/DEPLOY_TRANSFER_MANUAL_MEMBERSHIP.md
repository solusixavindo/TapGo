# Deploy: upgrade membership lewat transfer bank manual

Dokumen ini untuk Owner/operator yang mengeksekusi di VPS produksi. Tidak ada nilai rahasia di sini; semua nilai nyata diisi langsung di `.env` VPS.

**Cakupan PR:** [solusixavindo/TapGo#1](https://github.com/solusixavindo/TapGo/pull/1) membawa tiga hal sekaligus — remediasi audit keamanan 30 September, kesiapan driver_app, dan transfer manual membership. Jadi deploy backend ini juga membawa dua kelompok pertama (flag-nya tetap mati bawaan, lihat bagian 3).

**Kondisi VPS (dicek baca-saja lewat SSH, 3 Oktober 2026):**
- `api.tapgolion.id` → 145.79.11.118 (host SSH `myxavi-vps`). Backend berjalan di **pm2** (`tapgo-api`, online), **tanpa Docker**, Node 22. Server ini juga menampung aplikasi lain (`griyacare`, `myxavi-api`, `xavindo-wa-bot`): **restart hanya `tapgo-api`**.
- Deploy memakai **folder rilis per commit**: pm2 berjalan dari `/var/www/releases/tapgo-<sha>/apps/backend` (saat ini `tapgo-656b249` = `main` sebelum PR ini). Tiap folder rilis adalah checkout git dengan `.env`-nya sendiri. `/var/www/Tapgo` adalah salinan lama (Juni) dan **bukan** target deploy; `git pull` di sana tidak berpengaruh.
- Konsol admin statis ada di `/var/www/admin` (ada beberapa `admin.bak-*`: tradisi cadangan sebelum menimpa).
- **Landing page `tapgolion.id` ada di server LAIN** (145.223.108.166), bukan VPS ini. Cara deploy-nya di sana belum saya periksa.
- `cd.yml` (Docker, tag `v*`) **tidak dipakai** di VPS ini.
- Yang belum saya ketahui: perintah persis pembuatan folder rilis baru dan pergantian proses pm2 yang biasa Anda pakai (tidak ada skrip di server). Langkah 2.1 di bawah mengikuti pola yang terlihat; sesuaikan dengan kebiasaan Anda.

---

## 0. Keputusan yang harus diambil SEBELUM go-live

### 0.1 Penolakan dokumen pada pembayaran manual (sudah ditutup di kode)
Uang transfer manual tidak pernah lewat Midtrans, jadi refund via gateway tidak berlaku. Penanganannya:
- Tombol **"Tolak dan kembalikan dana"** mencatat kewajiban refund (status `PENDING`; label di konsol: "Ditolak, dana belum dikembalikan").
- Rute lama `execute-refund` untuk pesanan manual kini menjawab 409 `MEMBERSHIP_REFUND_MANUAL_REQUIRED` dan **tidak memanggil gateway**.
- **Super Admin** mengembalikan dana lewat transfer bank dari rekening perusahaan (menghubungi pemohon untuk rekening tujuan; nomor HP tampil penuh bagi Super Admin), lalu di konsol menekan **"Catat dana sudah dikembalikan"** dengan **nomor referensi transfer balik** dari mutasi bank (wajib).
- Hasilnya: payment dan invoice `REFUNDED`, audit `MEMBERSHIP_REFUND_COMPLETED` (pelaku, nominal, referensi bank). Tidak bisa dicatat dua kali. Admin biasa tidak dapat melakukannya.
- Pencatatan itu **hanya pembukuan**: sistem tidak menggerakkan uang. Pastikan transfer balik benar-benar sudah dilakukan sebelum menekan tombol.

### 0.2 Opsi pembayaran online (sudah dipisah: `MEMBERSHIP_ONLINE_PAYMENT_ENABLED`)
Jalur gateway untuk membership kini punya flag sendiri, **default mati**, terpisah dari kunci gateway. `DOKU_ENABLED` dan `MIDTRANS_SERVER_KEY` boleh tetap terisi untuk top up dan webhook tanpa membuka jalur online membership.
- Flag mati: halaman bayar hanya menampilkan "Bayar dengan transfer bank", dan rute `pay` menjawab 403 `MEMBERSHIP_ONLINE_PAYMENT_DISABLED` (jadi tidak cukup tersembunyi di UI saja).
- Nyalakan (`true`) hanya setelah gateway siap menjual membership; opsi online baru tampil bila flag hidup **dan** gateway terkonfigurasi.
- Webhook tidak ikut digerbangi: pembayaran online yang sudah terlanjur dimulai tetap diselesaikan.
- Selama Midtrans belum menjawab: biarkan `MEMBERSHIP_ONLINE_PAYMENT_ENABLED=false` (atau tidak diset). Tidak perlu mengosongkan kunci gateway.

### 0.3 Operator
Harus ada Super Admin yang rutin mencocokkan mutasi dan menekan **"Konfirmasi transfer masuk"**, serta Admin untuk verifikasi dokumen. Pengajuan tanpa konfirmasi kedaluwarsa dalam 24 jam (`MANUAL_TOPUP_EXPIRY_HOURS`, berlaku sama untuk top up dan membership).

### 0.4 Kondisi produksi saat ini (dicek baca-saja pada rilis aktif `tapgo-656b249`, 3 Okt 2026)
Nilai rahasia tidak dibaca; data hanya agregat.

| Variabel | Sekarang | Catatan |
|---|---|---|
| `NODE_ENV` | `production` | |
| `MIDTRANS_IS_PRODUCTION` | `true` | kunci berformat produksi (`Mid-server-…`): **Midtrans berjalan di mode PRODUKSI, uang nyata** |
| `EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED` / `MEMBERSHIP_PURCHASE_WEB_ENABLED` | `true` / `true` | pembelian web sudah terbuka |
| `DOKU_ENABLED` | `false` | |
| `WALLET_TOPUP_ENABLED` | `true` | top up gateway sudah jalan |
| `MANUAL_TOPUP_ENABLED` | `true` | top up manual sudah jalan; rekening, nama bank, dan pemilik sudah terisi |
| `WALLET_CASH_OUT_WEB_ENABLED` | `true` | penarikan lewat web sudah jalan |
| `PPOB_PROVIDER` | `digiflazz` | PPOB sungguhan |
| `MIDTRANS_NOTIFICATION_SECRET` | kosong | tidak dipakai; webhook memverifikasi signature dengan kunci server |
| `MEMBERSHIP_DOCUMENT_SECRET` | terisi | siap |
| `MANUAL_MEMBERSHIP_TRANSFER_ENABLED`, `MEMBERSHIP_ONLINE_PAYMENT_ENABLED` | belum ada | baru di PR ini |

Data produksi (agregat): 80 pengguna. Pesanan membership: 5 `PENDING` (web), 1 `PENDING` (tanpa kanal), 1 `CANCELLED`; **tidak ada yang lunas, tidak ada membership yang diaktifkan lewat jalur online**. Pembayaran membership: 2 Midtrans `PENDING` (`sandbox=false`). Top up: 4 manual `PENDING` (Rp201.151), 1 Midtrans `PENDING` (Rp10.000), **tidak ada top up lunas, tidak ada ledger `TOPUP`**.

**Hasil pemeriksaan risiko "pembayaran uji ikut mengaktifkan membership":** tidak terbukti. Dugaan awal bahwa Midtrans berjalan dengan kunci sandbox ternyata keliru (saya sempat membaca `.env` salinan lama di `/var/www/Tapgo`, bukan rilis aktif). Pengaman yang berlaku di kode: webhook wajib ber-signature yang diverifikasi dengan kunci server (ditolak bila kunci tidak ada atau signature salah), nominal callback harus sama persis dengan nominal order, status `challenge`/`deny` Midtrans tidak melunasi, dan simulator pembayaran ditolak di `NODE_ENV=production`.

Konsekuensi yang harus dipahami:
1. **Saat kode baru naik, jalur Midtrans untuk membership langsung tertutup** (flag online default mati), padahal gerbang pembelian web sudah terbuka. Bila `MANUAL_MEMBERSHIP_TRANSFER_ENABLED` belum `true` saat itu, halaman bayar menampilkan "belum tersedia". Karena itu **isi semua variabel baru di `.env` rilis baru SEBELUM memulai proses pm2 dari rilis itu**: satu kali pergantian, tanpa celah. Variabel baru diabaikan kode lama, jadi aman ditulis lebih dulu.
2. **Pesanan yang sudah memulai pembayaran Midtrans tidak bisa berpindah ke transfer manual** (ditolak 409 `MEMBERSHIP_PAYMENT_ALREADY_STARTED`). Ada 2 pesanan membership seperti itu. Webhook tidak digerbangi, jadi bila pemiliknya sempat membayar, pembayarannya tetap diselesaikan. Bila tidak, Super Admin dapat membatalkan pengajuan itu ("Batalkan pengajuan") agar pemiliknya mengajukan ulang dan memilih transfer bank.
3. **Rekening dipakai bersama top up manual yang sudah berjalan.** Kode unik transfer dialokasikan lintas top up dan membership, termasuk 4 top up manual yang sedang `PENDING`, sehingga nominal tidak akan kembar.
4. **Mode Midtrans produksi vs persetujuan merchant:** jalur online membership akan tertutup setelah deploy, tetapi top up gateway (`WALLET_TOPUP_ENABLED=true`) tetap memakai Midtrans produksi. Itu di luar PR ini dan tidak diubah.

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

### 2.1 Backend (folder rilis baru + pm2)
Pola yang terlihat di server: satu folder per commit. Ikuti kebiasaan Anda; intinya:
```bash
ssh myxavi-vps
cd /var/www/releases
# 1) Siapkan folder rilis baru untuk commit merge PR (checkout git seperti rilis sebelumnya)
#    contoh nama: tapgo-<sha-merge>
# 2) Salin .env dari rilis aktif lalu EDIT variabel baru (bagian 3) SEBELUM langkah 5
cp tapgo-656b249/apps/backend/.env tapgo-<sha>/apps/backend/.env && chmod 600 tapgo-<sha>/apps/backend/.env
cd tapgo-<sha>
npm ci
npx prisma generate --schema apps/backend/prisma/schema.prisma
# 3) Cadangkan DB, periksa saldo negatif (bagian 1), lalu migrasi memakai DATABASE_URL dari .env rilis baru
npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
# 4) Build
npm --workspace apps/backend run build
# 5) Ganti proses pm2 ke rilis baru (HANYA tapgo-api; jangan menyentuh griyacare dkk)
#    cara paling sederhana: pm2 delete tapgo-api; lalu start dari folder rilis baru dengan
#    cwd apps/backend dan script dist/src/server.js; pm2 save
curl -s https://api.tapgolion.id/health        # success:true
pm2 logs tapgo-api --lines 80 --nostream       # tidak ada galat saat start
```
Rilis aktif lama (`tapgo-656b249`) **jangan dihapus**: itulah jalur rollback (bagian 5).

### 2.2 Landing page (situs statis, di server lain)
`tapgolion.id` ada di 145.223.108.166, bukan VPS API. Build tanpa mode pratinjau:
```bash
cd apps/landing-page
# NEXT_PUBLIC_TAPGO_API_BASE_URL bawaan sudah https://api.tapgolion.id/api/v1
# JANGAN set NEXT_PUBLIC_TAPGO_UPGRADE_PREVIEW=true (itu menampilkan DATA CONTOH)
npm run build
```
Unggah isi `apps/landing-page/out/` ke server landing dengan cara yang selama ini Anda pakai (cara itu belum saya periksa). Pastikan `CORS_ORIGINS` backend memuat `https://tapgolion.id` (sudah terisi di produksi; periksa nilainya).

### 2.3 Konsol admin (statis, `/var/www/admin` di VPS API)
```bash
cd apps/admin_dashboard
NEXT_PUBLIC_TAPGO_API_BASE_URL=/api/v1 npm run build   # basePath mengikuti TAPGO_ADMIN_BASE_PATH bila dipakai
```
Ikuti tradisi di server: cadangkan dulu (`cp -a /var/www/admin /var/www/admin.bak-<tanggal>`), lalu salin hasil build ke `/var/www/admin`.

Aman bila UI naik sebelum flag: landing page yang gagal membaca opsi pembayaran kembali ke perilaku lama; panel transfer di admin hanya muncul untuk pesanan manual.

## 3. Env produksi

Edit `.env` di folder **rilis baru** (`/var/www/releases/tapgo-<sha>/apps/backend/.env`), bukan di rilis aktif, dan lakukan sebelum memulai pm2 dari rilis itu (lihat 0.4). Nilai di bawah adalah **nama dan bentuk**, bukan nilai nyata.

### 3.1 Yang perlu ditambah/dipastikan (status per 3 Okt 2026)
| Variabel | Nilai | Status di produksi |
|---|---|---|
| `MANUAL_MEMBERSHIP_TRANSFER_ENABLED` | `true` | **TAMBAH** (belum ada) |
| `MEMBERSHIP_ONLINE_PAYMENT_ENABLED` | `false` | **TAMBAH** (belum ada); jalur Midtrans/DOKU untuk membership tetap mati sampai gateway siap |
| `MANUAL_TOPUP_BANK_NAME` | nama bank | **PERIKSA** terisi dan nyata (nomor rekening sudah terisi) |
| `MANUAL_TOPUP_ACCOUNT_HOLDER` | nama pemilik rekening | **PERIKSA** terisi; harus sama dengan nama di bank |
| `MANUAL_TOPUP_ACCOUNT_NUMBER` | nomor rekening | sudah terisi; pastikan itu rekening yang akan menerima uang membership (dipakai bersama top up manual) |
| `EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED` | `true` | sudah `true` |
| `MEMBERSHIP_PURCHASE_WEB_ENABLED` | `true` | sudah `true` |
| `MEMBERSHIP_DOCUMENT_SECRET` | acak ≥ 32 karakter | sudah terisi; **jangan diganti** (mengganti membuat dokumen tersimpan tidak terbaca) |
| `MANUAL_TOPUP_MIN_AMOUNT` | `50000` | Minimal top up Saldo TapGo (driver dan perjalanan); bawaan sudah 50000, tidak perlu diubah |
| `MANUAL_TOPUP_PPOB_MIN_AMOUNT` | `25000` | **Opsional** (bawaan 25000): minimal top up Saldo PPOB |

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

Variabel baru berlaku saat proses pm2 dimulai dari rilis baru (langkah 2.1 nomor 5). Bila gagal start dengan galat env, `pm2 logs tapgo-api` menyebut variabel yang salah; perbaiki di `.env` rilis baru lalu mulai ulang, atau lakukan rollback (bagian 5).

## 4. Uji sekali di produksi (akun Anda sendiri)

1. Buka `https://tapgolion.id/upgrade`, login dengan akun uji milik Anda, pilih paket terendah.
2. Isi data, unggah KTP dan swafoto, lanjut ke pembayaran. **Hanya** "Bayar dengan transfer bank" yang tampil (flag online mati, walau kunci gateway terisi).
3. Catat nominal berkode unik, transfer **tepat** sebesar itu dari rekening Anda.
4. Login Super Admin → Verifikasi Keanggotaan → pastikan nominal tampil di antrean → cocokkan dengan mutasi → **Konfirmasi transfer masuk**.
5. Status member berubah ke "Menunggu verifikasi" (membership belum aktif).
6. Login Admin → **Verifikasi dan aktifkan** → status "Aktif"; periksa bonus sponsor (bila ada) dan satu baris audit `MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED`.
7. (Opsional, disarankan) Uji jalur tolak dengan akun uji kedua: Admin menolak dokumen, Super Admin mentransfer balik ke rekening Anda lalu mencatat referensinya; pastikan status berubah ke "Ditolak, dana dikembalikan".

Baru setelah lolos, umumkan ke pengguna.

## 5. Mematikan / rollback

- **Matikan transfer manual seketika:** `MANUAL_MEMBERSHIP_TRANSFER_ENABLED=false` di `.env` rilis aktif, lalu mulai ulang `tapgo-api` (`pm2 restart tapgo-api --update-env`). Pengajuan yang sudah dikonfirmasi tetap sah dan diteruskan ke verifikasi; yang belum dibayar kedaluwarsa sendiri. Dengan flag online juga mati, halaman bayar menampilkan "belum tersedia".
- **Menutup seluruh upgrade web:** `MEMBERSHIP_PURCHASE_WEB_ENABLED=false`.
- **Rollback kode:** mulai ulang pm2 dari folder rilis lama (`/var/www/releases/tapgo-656b249`, **jangan dihapus**) dengan `.env`-nya sendiri. Catatan: kode lama membuka kembali jalur Midtrans untuk membership dan tidak mengenal transfer manual (lihat 0.4 poin 1); pengajuan transfer manual yang sedang berjalan tetap tercatat di database, tetapi tidak bisa dikonfirmasi lewat konsol sampai kode baru naik lagi. Tiga migrasi baru bersifat aditif dan tidak perlu dibatalkan (constraint saldo justru melindungi); kode lama mengabaikannya.
- Konfirmasi transfer tetap bisa dilakukan Super Admin walau flag dimatikan, supaya uang yang terlanjur masuk tidak terkunci.

## 6. Setelah go-live (operasional harian)

- Cek antrean Verifikasi Keanggotaan secara berkala; transfer yang dikonfirmasi setelah batas waktu tampil dengan peringatan, dan ditolak sistem (409) bila nominalnya kembar dengan pesanan terbuka lain — cek mutasi manual.
- Dokumen identitas terhapus otomatis ≤ 24 jam; verifikasi sebelum itu.
- Tiap konfirmasi tercatat di audit log (`MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED`) dengan pelaku, nominal, dan kode unik.

## 7. Catatan teknis yang perlu diketahui

- Rute lama `POST /admin/member-requests/:id/approve` (Super Admin) masih bisa mengonfirmasi pesanan manual tanpa pemeriksaan nominal kembar untuk transfer terlambat. UI memakai `confirm-transfer`. Perannya sama (Super Admin), jadi bukan eskalasi hak akses.
- Versi aplikasi tidak dinaikkan; build rilis driver_app 1.0.0+4 dan uji lapangan driver belum dinyatakan lolos.

## 8. Top up: tujuan Saldo TapGo dan Saldo PPOB

Halaman `/topup` (satu-satunya tautan dari aplikasi user dan driver) kini meminta tujuan sebelum jumlah:

| Tujuan | Saldo yang dikredit | Minimal | Pilihan cepat | Keterangan |
|---|---|---|---|---|
| **Saldo TapGo** (bawaan) | `balance` + `cashBalance` | Rp50.000 | 50rb, 100rb, 200rb, 500rb, 1jt | Dipakai driver (komisi pesanan tunai dipotong dari saldo ini) dan pembayaran perjalanan |
| **Saldo PPOB** | `ppobBalance` saja | **Rp25.000** | **25rb**, 50rb, 100rb, 200rb, 500rb | Khusus pulsa, token, tagihan; **tidak dapat ditarik** |

- Maksimal per pesanan Rp5.000.000 (`MANUAL_TOPUP_MAX_AMOUNT`). Nominal yang dikreditkan = **nominal transfer penuh, termasuk kode unik** (mis. transfer Rp25.930 → Saldo PPOB Rp25.930).
- Tautan `https://tapgolion.id/topup?tujuan=ppob` memilihkan Saldo PPOB sejak masuk (tanpa `tujuan` = Saldo TapGo). Aplikasi mobile saat ini menautkan ke `/topup` tanpa parameter; menautkan layar PPOB ke `?tujuan=ppob` butuh rilis aplikasi dan sengaja tidak dikerjakan di rilis ini.
- Tujuan disimpan di metadata pesanan (tanpa migrasi). Pesanan lama tanpa penanda dibaca sebagai Saldo TapGo. Konsol admin (Top Up Manual) menampilkan tujuan dan nominal yang akan dikreditkan, sehingga Super Admin tahu saldo mana yang bertambah saat menekan Konfirmasi.
- Rekening dan kode unik dipakai bersama membership, top up Saldo TapGo, dan top up Saldo PPOB; nominal transfer tidak pernah kembar di antara pesanan terbuka.

## 9. Invoice pembayaran (landing page saja)

Halaman bayar top up (`/topup/bayar`) dan upgrade (`/upgrade/bayar`) kini menampilkan **invoice**: nomor, tanggal, nama pemohon, rincian (nominal/harga + kode unik = total transfer), rekening perusahaan (bank, nomor, atas nama), dan batas waktu. Tombol: **Cetak / simpan PDF** (hanya invoice yang tercetak, satu halaman), **Kirim ke WhatsApp**, dan **Salin semua**. Halaman status top up yang masih menunggu menautkan kembali ke invoice. Isinya "petunjuk pembayaran, bukan bukti bayar".

- Perubahan **hanya di sisi tampilan**: tidak ada perubahan backend, tidak ada pekerjaan VPS. Cukup unggah zip landing baru.
- Slot **QRIS** sudah disediakan di komponen (`qris` pada `PaymentInvoice`) tetapi belum diisi. Baru dipasang setelah QRIS resmi perusahaan tersedia dan isinya diperiksa (nama merchant dan CRC). Catatan: pembayaran QRIS dipotong MDR dan sering diselesaikan H+1, sehingga pencocokannya memakai laporan transaksi QRIS, bukan mutasi rekening biasa.
