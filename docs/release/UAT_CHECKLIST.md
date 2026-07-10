# TapGo UAT Checklist

Tanggal target UAT: Senin, 8 Juni 2026

## Command Validasi

Jalankan dari root project:

```bash
npm --workspace apps/backend run build
npm --workspace apps/backend run test
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo?schema=public npx prisma validate --schema apps/backend/prisma/schema.prisma
cd apps/user_app
flutter analyze
flutter test
flutter build apk --debug --dart-define=TAPGO_APP_MODE=staging
```

## Prasyarat UAT

- Backend TapGo aktif dan dapat diakses dari HP.
- Untuk UAT VPS, gunakan `https://api.tapgolion.id`.
- Endpoint health wajib sukses:
  - `https://api.tapgolion.id/health`
  - `https://api.tapgolion.id/api/v1/health`
- Database sudah menjalankan migration terbaru.
- APK dibuild dengan `TAPGO_APP_MODE=staging`.
- Jika memakai VPS, build APK dengan `--dart-define=TAPGO_API_BASE_URL=https://api.tapgolion.id`.
- Jika masih memakai tunnel sementara, Server Configuration di aplikasi diarahkan ke root URL tunnel, contoh `https://xxxx.trycloudflare.com`.

## 1. Test Referral

Checklist:

- [ ] Buat/login user A.
- [ ] Pastikan user A memiliki kode referral.
- [ ] Register user B memakai kode referral user A.
- [ ] Login kembali sebagai user A.
- [ ] Buka Referral Tree.

Expected result:

- Referral tree user A menampilkan user B sebagai downline.
- Nama yang tampil adalah nama asli user B.
- Tidak ada data dummy seperti A/B/B1.
- Data berasal dari backend/database.
- Jika backend memiliki downline, halaman tidak tampil kosong.

## 2. Test Silver

Checklist:

- [ ] Login sebagai user B.
- [ ] Pilih paket Silver.
- [ ] Isi Form Membership dan checkout.
- [ ] Selesaikan pembayaran sandbox/simulator staging.
- [ ] Buka Dashboard.
- [ ] Buka Membership Saya.
- [ ] Klik Lihat Invoice.

Expected result:

- Status member user B menjadi Silver.
- Saldo PPOB user B menjadi Rp100.000.
- TapGoPay tetap tampil sebagai angka Rupiah real, bukan “Gratis”.
- Invoice bisa dibuka.
- Invoice menampilkan nomor invoice/order ID, nama user, nomor HP, paket Silver, harga Rp500.000, tanggal transaksi, dan status pembayaran.

## 3. Test Withdraw

Checklist:

- [ ] Login sebagai user.
- [ ] Isi Rekening Bank jika belum ada.
- [ ] Buka Wallet & Withdraw.
- [ ] Ajukan withdraw minimal Rp50.000.
- [ ] Logout.
- [ ] Login kembali dengan user yang sama.
- [ ] Buka Wallet & Withdraw dan cek riwayat.

Expected result:

- Pengajuan withdraw tetap tersimpan.
- Status awal withdraw adalah Pending.
- Riwayat menampilkan nominal, bank, nomor rekening, nama rekening, status, dan tanggal pengajuan.
- Data berasal dari backend/database.

## 4. Test Rekening Bank

Checklist:

- [ ] Login sebagai user.
- [ ] Buka Akun > Rekening Bank.
- [ ] Isi nama bank, nomor rekening, dan nama pemilik rekening.
- [ ] Simpan.
- [ ] Logout lalu login kembali.
- [ ] Buka Rekening Bank lagi.
- [ ] Update data rekening.

Expected result:

- Data rekening tetap tersimpan setelah logout/login.
- Form menampilkan data sebelumnya.
- Update rekening berhasil.
- Data tersimpan di backend/database, bukan local dummy.

## 5. Test QR Referral

Checklist:

- [ ] Login sebagai user.
- [ ] Buka bagian Kode Referral di Dashboard atau Referral Dashboard.
- [ ] Klik tombol QRIS/QR Referral.
- [ ] Scan QR memakai HP lain.

Expected result:

- QR menampilkan kode referral user login.
- QR bisa discan dengan scanner standar.
- Hasil scan sama dengan kode referral user.
- QR dibuat menggunakan dependency standar `qr_flutter`.

## 6. Legal Google Play

Checklist:

- [ ] Akun > Privacy Policy dapat dibuka.
- [ ] Akun > Terms & Conditions dapat dibuka.
- [ ] Akun > Hapus Akun dapat dibuka dan submit request.
- [ ] Akun > Hubungi Kami dapat dibuka dan submit pesan.

Expected result:

- Halaman legal terbaca di light/dark mode.
- Request hapus akun tersimpan sebagai Pending di backend.
- Pesan contact tersimpan di backend/admin.

## 7. Admin Panel

Checklist:

- [ ] Login ADMIN/SUPER_ADMIN.
- [ ] Buka Approve Member.
- [ ] Approve/reject pengajuan member.
- [ ] Buka Withdrawal Management.
- [ ] Approve/reject/paid withdrawal sesuai role.
- [ ] Buka Laporan Bonus, Laporan PPOB, dan Laporan Reward.

Expected result:

- Semua data admin berasal dari backend.
- Empty state tampil jika data kosong.
- Tidak ada data dummy/simulasi.
- Approve member mengaktifkan membership lewat engine payment-success yang sama.

## 8. Role Access

Checklist:

- [ ] Login sebagai USER biasa.
- [ ] Pastikan menu Admin Dashboard tidak tampil.
- [ ] Coba akses endpoint admin memakai token USER.
- [ ] Login sebagai ADMIN.
- [ ] Buka Admin Dashboard dan akses Approve Member, Withdrawal Management, Laporan Bonus, Laporan PPOB, Laporan Reward, Contact Messages, dan Delete Account Requests.
- [ ] Login sebagai SUPER_ADMIN.
- [ ] Pastikan SUPER_ADMIN dapat membuka semua menu ADMIN dan menu sensitif yang diizinkan.

Expected result:

- USER mendapat `403 Forbidden` untuk semua endpoint `/api/v1/admin/*`.
- ADMIN dapat mengakses endpoint operasional admin.
- SUPER_ADMIN dapat mengakses seluruh endpoint admin, termasuk endpoint sensitif.

## 9. Public Legal URL

Checklist:

- [ ] Buka `https://tapgolion.id/privacy-policy` atau `/legal/privacy-policy`.
- [ ] Buka `https://tapgolion.id/terms-and-conditions` atau `/legal/terms-and-conditions`.
- [ ] Buka `https://tapgolion.id/contact` atau `/legal/contact-us`.
- [ ] Buka `/legal/delete-account`.

Expected result:

- Semua halaman dapat dibuka dari browser tanpa login.
- Halaman menampilkan data resmi PT. TapGo Lion Indonesia.
- Kontak resmi: `support@tapgolion.id`, WhatsApp `+62 838-0025-5588`, alamat Jalan Kp. Pasir Gendok No. 11, Desa Bojongleles, Kecamatan Rangkasbitung, Kabupaten Lebak, Banten, Indonesia.

## 10. Integration Test Database

Checklist:

- [ ] Baca `TESTING.md`.
- [ ] Siapkan `TAPGO_TEST_DATABASE_URL` ke database khusus test.
- [ ] Jalankan migration ke database test.
- [ ] Jalankan `npm test` dari `apps/backend`.

Expected result:

- Jika `TAPGO_TEST_DATABASE_URL` tidak ada, integration test skip aman.
- Jika env tersedia, test role guard, referral, Silver PPOB, withdraw, approve/reject withdraw, dan invoice berjalan di database test.

## 11. UAT VPS `api.tapgolion.id`

Checklist:

- [ ] Buka `https://api.tapgolion.id/health` dari browser HP.
- [ ] Buka `https://api.tapgolion.id/api/v1/health` dari browser HP.
- [ ] Login USER.
- [ ] Login ADMIN.
- [ ] Login SUPER_ADMIN.
- [ ] Register user A dan pastikan kode referral terbentuk.
- [ ] Register user B memakai referral user A.
- [ ] Login user A dan pastikan referral tree menampilkan user B.
- [ ] Login user B dan upgrade ke Silver.
- [ ] Pastikan invoice muncul.
- [ ] Pastikan PPOB Silver Rp100.000.
- [ ] Ajukan withdraw dan pastikan data tersimpan setelah logout/login.
- [ ] Login ADMIN/SUPER_ADMIN dan approve/reject withdraw.
- [ ] Tampilkan QR referral dan scan memakai HP lain.
- [ ] Buka public legal URL tanpa login.
- [ ] Buka admin report bonus/PPOB/reward.

Expected result:

- Semua request mobile memakai `https://api.tapgolion.id/api/v1/...`.
- Tidak ada ketergantungan ke `localhost` atau Cloudflare Tunnel.
- Data berasal dari backend/database VPS.
- Empty state tampil rapi jika database masih kosong.
