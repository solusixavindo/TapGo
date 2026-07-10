# Google Play Pre-Submission Audit - TapGo

Tanggal audit: 12 Juni 2026

## Executive Summary

TapGo sudah memiliki paket aset Google Play yang cukup matang untuk tahap pre-submission: Privacy Policy, Terms & Conditions, feature graphic final, store listing draft, dan 5 screenshot user-facing final. Namun status saat ini belum sepenuhnya Go untuk upload production Google Play karena masih ada payment readiness blocker dan screenshot final belum lengkap.

Rekomendasi: **NO-GO untuk production upload final**, tetapi **GO untuk persiapan Play Console draft/internal testing**.

## Asset yang Diaudit

| Area | File / Lokasi | Status |
| --- | --- | --- |
| Privacy Policy | `docs/PRIVACY_POLICY.md` | PASS |
| Privacy Policy page | `apps/landing-page/src/app/privacy-policy/page.tsx` | PASS, perlu cek URL live |
| Terms & Conditions | `docs/TERMS_AND_CONDITIONS.md` | PASS |
| Terms page | `apps/landing-page/src/app/terms-and-conditions/page.tsx` | PASS, perlu cek URL live |
| Store Listing Draft | `GOOGLE_PLAY_STORE_LISTING_DRAFT.md` | PASS |
| Feature Graphic | `google-play-assets/feature-graphic-1024x500.png` | PASS |
| Screenshot final 1 | `google-play-assets/screenshots/final/01-dashboard-user.png` | PASS |
| Screenshot final 2 | `google-play-assets/screenshots/final/02-membership-package.png` | PASS |
| Screenshot final 3 | `google-play-assets/screenshots/final/03-membership-checkout.png` | PASS |
| Screenshot final 4 | `google-play-assets/screenshots/final/04-wallet-tapgopay.png` | PASS |
| Screenshot final 5 | `google-play-assets/screenshots/final/05-referral-network.png` | PASS |

## Feature Graphic Audit

| Check | Result |
| --- | --- |
| Required size 1024 x 500 px | PASS |
| Actual size | 1024 x 500 px |
| Format | PNG |
| Uses official TapGo logo | PASS |
| Text inside safe margin | PASS |
| No third-party logo | PASS |
| No aggressive financial claim | PASS |
| No Midtrans/payment blocker content | PASS |

Kesimpulan: Feature graphic memenuhi persyaratan dasar Google Play dan aman dari cropping utama.

## Screenshot Audit

| Screenshot | Size | Status | Notes |
| --- | --- | --- | --- |
| Dashboard User | 1080 x 1920 | PASS | Avatar wajah sudah dimask dengan logo TapGo. |
| Membership Package | 1080 x 1920 | PASS | User-facing, tidak ada password/token. |
| Membership Checkout | 1080 x 1920 | PASS | Menampilkan invoice/order UAT. |
| Wallet TapGoPay | 1080 x 1920 | PASS | Tidak ada nomor rekening pribadi. |
| Referral Network | 1080 x 1920 | PASS | Menampilkan nama UAT; masih layak, tetapi bisa dibuat lebih netral. |

Catatan risiko kecil:

- Nama user UAT seperti "Kiki Fatmala", "Dadan", "Caca", dan "Joni" masih terlihat. Ini bukan data sensitif jika memang akun UAT, tetapi untuk versi paling bersih bisa capture ulang memakai akun bernama "Member TapGo".
- Hanya 5 screenshot final tersedia. Google Play dapat menerima lebih sedikit, tetapi paket visual TapGo belum lengkap sesuai target internal 9 screenshot.

## Privacy Policy Audit

Status: PASS untuk konten.

Mencakup:

- Data yang dikumpulkan: nama, nomor HP, referral, membership, wallet, transaksi.
- Tujuan penggunaan data.
- Penyimpanan dan retensi data.
- Keamanan data.
- Pihak ketiga: Midtrans dan Google/Firebase jika digunakan.
- Kontak penghapusan akun.
- Email `support@tapgolion.id`.
- Website `https://tapgolion.id`.

Catatan:

- Route/file sudah tersedia.
- URL publik `https://tapgolion.id/privacy-policy` perlu dicek manual dari browser sebelum submit karena fetch eksternal dari environment audit gagal.

## Terms & Conditions Audit

Status: PASS untuk konten.

Mencakup:

- Penggunaan aplikasi.
- Membership Basic/Silver/Gold/Platinum.
- Referral, reward, komisi sesuai syarat.
- PPOB benefit.
- Wallet aplikasi.
- Pembayaran via Midtrans.
- Refund/cancel/reversal.
- Larangan penyalahgunaan.
- Perubahan ketentuan.
- Kontak resmi.

Catatan:

- Route/file sudah tersedia.
- URL publik `https://tapgolion.id/terms-and-conditions` perlu dicek manual dari browser sebelum submit karena fetch eksternal dari environment audit gagal.

## Store Listing Draft Audit

Status: PASS.

Strength:

- Short description 56/80 karakter.
- Full description menjelaskan membership, referral reward, wallet aplikasi, PPOB benefit, invoice, dan support secara aman.
- Ada disclaimer bahwa TapGo tidak menjanjikan hasil tetap.
- Kontak, website, dan Privacy Policy URL sudah dicantumkan.

Potential improvement before final copy:

- Jika Google Play meminta kategori yang lebih spesifik, gunakan `Business` sebagai utama. `Finance` dapat meningkatkan review sensitivity karena ada wallet/payment, jadi Business lebih aman untuk positioning awal.

## Risk Keyword Scan

Pencarian dilakukan untuk:

- `investasi`
- `passive income`
- `profit guaranteed`
- `cepat kaya`
- `money game`
- `MLM`

Result: **PASS**. Tidak ditemukan istilah tersebut pada file legal/listing/aset teks yang diaudit.

Catatan: dokumen listing memakai frasa defensif seperti "tidak menjanjikan hasil tetap" dan "guaranteed result" dalam konteks larangan/negasi. Ini aman secara tone karena tidak menjadi klaim promosi.

## Readiness Score

| Area | Score | Status | Rationale |
| --- | ---: | --- | --- |
| Legal | 88% | Ready with manual URL check | Konten siap, tetapi URL publik perlu dicek manual setelah deploy landing page terbaru. |
| Visual Assets | 76% | Partial Ready | Feature graphic PASS, 5 screenshot PASS, 4 screenshot target internal masih kurang. |
| Store Listing | 86% | Ready Draft | Copy aman, kategori dan reviewer notes sudah ada. |
| APK Readiness | 70% | Not audited in this task | User melarang build; readiness bergantung APK final dan AAB release process. |
| Payment Readiness | 55% | Blocked | Midtrans channel masih menunggu aktivasi/pengecekan. |
| Overall Readiness | 75% | Not final upload-ready | Siap untuk draft/internal prep, belum final production submission. |

## Temuan Risiko

| Priority | Risiko | Dampak | Rekomendasi |
| --- | --- | --- | --- |
| P1 | Midtrans payment channel belum aktif | Flow pembayaran membership bisa gagal saat review jika reviewer mencoba checkout. | Selesaikan aktivasi channel Midtrans sebelum production upload. |
| P1 | URL publik Privacy/Terms belum diverifikasi live dari environment audit | Google Play wajib bisa membuka Privacy Policy URL. | Cek manual `https://tapgolion.id/privacy-policy` dan `https://tapgolion.id/terms-and-conditions` di browser publik. |
| P2 | Screenshot final baru 5 dari target internal 9 | Listing visual masih kurang lengkap untuk menonjolkan admin/financial side. | Tambahkan screenshot PPOB Benefit, Admin Dashboard, Financial Report, Super Admin Dashboard jika ingin lengkap. |
| P2 | Nama akun UAT terlihat di screenshot | Bukan blocker jika data UAT, tapi kurang netral untuk store listing. | Opsional: capture ulang dengan akun "Member TapGo". |
| P2 | APK/AAB readiness belum divalidasi pada task ini | Submission final butuh AAB signed/release yang valid. | Jalankan validasi release terpisah saat user mengizinkan build. |

## Item yang Masih Kurang

1. Screenshot final PPOB Benefit.
2. Screenshot final Admin Dashboard.
3. Screenshot final Financial Report.
4. Screenshot final Super Admin Dashboard.
5. Verifikasi URL publik Privacy Policy.
6. Verifikasi URL publik Terms & Conditions.
7. Selesaikan Midtrans payment channel.
8. Build dan validasi AAB release saat sudah diizinkan.
9. Siapkan tester/reviewer credential untuk Google Play.

## Final Checklist Before Play Console Upload

- [ ] Privacy Policy URL dapat dibuka publik.
- [ ] Terms & Conditions URL dapat dibuka publik.
- [ ] Feature graphic final sudah diupload.
- [ ] Minimal 5 screenshot user-facing final sudah diupload.
- [ ] Screenshot tidak menampilkan password, token, server key, atau nomor rekening.
- [ ] Screenshot tidak menampilkan Midtrans channel blocker.
- [ ] Store listing tidak memakai istilah berisiko.
- [ ] Midtrans payment channel aktif atau checkout payment dinonaktifkan dari alur reviewer sampai aktif.
- [ ] AAB release signed berhasil dibuat dan diuji.
- [ ] Reviewer account disiapkan.
- [ ] Data Safety form Google Play diisi sesuai Privacy Policy.
- [ ] App access instructions diisi jika login diperlukan.
- [ ] Content rating questionnaire diselesaikan.

## Go / No-Go Recommendation

**NO-GO untuk upload production final Google Play hari ini.**

Alasan:

- Payment readiness masih blocked oleh Midtrans channel.
- URL publik legal perlu dicek manual.
- APK/AAB release belum dibuild dan belum diaudit pada task ini.

**GO untuk Play Console draft/internal preparation.**

Yang sudah aman dipakai:

- Privacy Policy content.
- Terms & Conditions content.
- Store listing draft.
- Feature graphic final.
- 5 screenshot user-facing final.

## Estimated Upload Readiness

Current readiness: **75%**

Estimated readiness after Midtrans channel resolved, public legal URLs verified, and AAB release validated: **92%**
