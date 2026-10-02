# Langkah Owner di Play Console — driver_app

Status: **BLOCKED**. Setiap langkah di bawah hanya bisa dilakukan di dalam Play
Console/Google Cloud Console sungguhan oleh Owner — tidak ada kredensial Google
Play di sesi ini, dan tidak seharusnya ada (login Play Console bukan sesuatu yang
boleh dilakukan agen otomatis). Dokumen ini adalah daftar langkah pasti, bukan
laporan bahwa langkahnya sudah selesai.

Semua berkas yang BISA disiapkan tanpa login Play Console sudah ada di repo
(lihat daftar "Sudah siap" di bawah) — Owner tinggal menyalin, bukan menyusun
dari nol.

## Sudah siap untuk disalin (tidak perlu dikerjakan ulang)

- `docs/release/GOOGLE_PLAY_DRIVER_APP_DATA_SAFETY_MAPPING.md` — jawaban form
  Data Safety, dipetakan ke perilaku kode sungguhan per 30 September 2026.
- `docs/release/GOOGLE_PLAY_DRIVER_APP_LISTING_DRAFT.md` — deskripsi
  singkat/panjang, ikon 512×512 dan feature graphic 1024×500 di
  `google-play-assets/driver/`.
- `docs/release/DRIVER_APP_REVIEWER_TEST_ACCOUNT.md` — cara menjalankan
  `npm run driver:reviewer-bootstrap`.
- Kebijakan privasi driver sudah live di landing page (bagian "Data yang
  Dikumpulkan oleh Aplikasi TapGo Driver").

## Langkah 1 — Screenshot dari HP asli (minimal 4)

**Tidak bisa dibuat dari sesi ini** — butuh HP Owner dengan aplikasi terpasang
dan data yang terlihat wajar (bukan layar kosong/error). Play Console mewajibkan
minimal 2 screenshot per jenis perangkat yang didukung (umumnya 4+ untuk telepon
sudah aman).

Saran urutan (tunjukkan fungsi inti, bukan layar login/splash):
1. Beranda driver dengan status Online dan kartu ringkasan hari ini.
2. Tawaran pesanan masuk (kartu dengan jarak, tarif, hitung mundur).
3. Perjalanan aktif dengan peta dan posisi bergerak.
4. Tab Pendapatan dengan ringkasan harian/mingguan.

Ambil di terang DAN gelap bila memungkinkan (tidak wajib keduanya, tapi
konsisten dengan tema yang diuji di lembar lapangan).

## Langkah 2 — Salin Data Safety ke form Play Console

1. Buka Play Console → App content → Data safety.
2. Salin baris demi baris dari `docs/release/GOOGLE_PLAY_DRIVER_APP_DATA_SAFETY_MAPPING.md` —
   jangan menjawab dari ingatan, ketidakcocokan antara form dan perilaku aplikasi
   sungguhan adalah pelanggaran kebijakan Play.
3. Simpan draft, tunggu Play Console menghitung ulang "pre-launch report" (bisa
   perlu rilis internal testing dulu agar laporan muncul).

## Langkah 3 — Deklarasi Foreground Service (lokasi)

1. Play Console → App content → cari bagian deklarasi "Foreground service
   permission" (nama persis bagian ini berubah-ubah di Play Console, cari
   berdasar kata kunci "foreground service").
2. Jenis: **Location**. Alasan: driver harus tetap terlihat online dan menerima
   tawaran pesanan saat layar mati/aplikasi di latar — notifikasi tetap "Anda
   online" ditampilkan selama service berjalan, berhenti otomatis saat driver
   offline.
3. Manifest driver_app SUDAH benar untuk deklarasi ini (`FOREGROUND_SERVICE` +
   `FOREGROUND_SERVICE_LOCATION`, **TANPA** `ACCESS_BACKGROUND_LOCATION`) — jadi
   jawaban jujurnya sudah didukung kode, tidak perlu menunggu perubahan apa pun.

## Langkah 4 — Akun reviewer Google

Di server produksi (bukan dari sesi ini — skrip butuh akses ke database produksi):

```bash
cd apps/backend
read -s TAPGO_REVIEWER_PASSWORD && export TAPGO_REVIEWER_PASSWORD
npm run driver:reviewer-bootstrap -- \
  --phone 081234567890 \
  --full-name "Google Play Reviewer" \
  --confirm-reviewer-bootstrap
```

Ganti nomor HP sesuai yang Owner siapkan. Password TIDAK PERNAH lewat argumen
CLI — hanya dari env yang dibaca interaktif (`read -s`), dan output skrip tidak
pernah mencetak password atau nomor utuh. Akun ini SENGAJA tanpa kendaraan
terverifikasi — reviewer bisa login dan menjelajah seluruh aplikasi tanpa risiko
tidak sengaja menerima order penumpang sungguhan. Masukkan nomor HP + password
yang sama ke kolom "App access" → "Login credentials" di Play Console.

## Langkah 5 — Publikasi OAuth consent screen (project `tapgo-c7cb3`)

**Kondisi sekarang** (per `REGRESSION_REGISTER.md`, uji 2 HP 29 Sep 2026): OAuth
consent screen project `tapgo-c7cb3` masih berstatus **Testing** dengan daftar
test user terbatas (`sandikanur404@gmail.com`, `febrina.delia@gmail.com`).
Selama status ini, login Google HANYA berhasil untuk akun yang ada di daftar test
user — ini SUDAH CUKUP untuk reviewer Google (bisa ditambahkan sebagai test user
tambahan di Langkah 4 bila reviewer login pakai Google, bukan nomor HP), tapi
**TIDAK CUKUP untuk pengguna publik** memakai Login dengan Google.

Langkah publikasi (Google Cloud Console → project `tapgo-c7cb3` → APIs & Services
→ OAuth consent screen):
1. Lengkapi halaman **Branding**: logo aplikasi, link kebijakan privasi
   (`https://tapgolion.id/privacy-policy`), link halaman utama.
2. Isi **App domain** dan **Authorized domains** bila belum (domain tapgolion.id).
3. Klik **Publish App** → pilih **In production** (keluar dari status Testing).
4. Google mungkin meminta verifikasi tambahan tergantung scope OAuth yang
   diminta (scope dasar profil/email biasanya tidak butuh review manual
   tambahan; bila muncul permintaan verifikasi, itu proses terpisah dengan
   linimasa Google sendiri — di luar kendali Owner/sesi ini).

Sampai langkah ini selesai, login Google driver_app TETAP terbatas pada test
user — bukan pemblokir untuk closed testing dengan driver pilot (mereka bisa
ditambahkan sebagai test user satu per satu), tapi WAJIB selesai sebelum rilis
produksi publik (F6) bila Login dengan Google tetap jadi salah satu cara masuk.

## Status F3

**BLOCKED** pada Langkah 1 (screenshot HP), 2-3 (isian form Play Console
sungguhan), dan 5 (publikasi OAuth consent screen) — keempatnya hanya bisa
dilakukan Owner. Langkah 4 (akun reviewer) sudah siap dijalankan kapan pun
Owner siap (skrip sudah ada dan teruji).

Selesai F3 bila: Langkah 1-5 di atas semuanya tuntas DAN pre-launch report Play
Console tidak menampilkan peringatan merah untuk aplikasi ini.
