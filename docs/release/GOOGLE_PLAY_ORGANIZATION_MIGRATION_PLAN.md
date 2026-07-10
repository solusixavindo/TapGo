# Google Play Organization Migration Plan

Tanggal: 2026-06-18  
Aplikasi: TapGo  
Package name: `id.tapgolion.tapgo`

## 1. Tujuan

Mengubah jalur distribusi TapGo agar memenuhi syarat Google Play untuk aplikasi dengan financial products/services, yaitu menggunakan **Organization developer account**.

## 2. Kondisi Saat Ini

| Item | Status |
|---|---|
| Closed Testing | Aktif |
| v2 `1.0.1` | Berhasil tersedia untuk tester |
| v3 `1.0.2` | Ditolak |
| Alasan reject | Financial products/services require organization accounts |
| App package | `id.tapgolion.tapgo` |
| Developer name | TapGo Indonesia |

## 3. Verifikasi Jenis Akun Saat Ini

Langkah verifikasi di Play Console:

1. Buka Play Console.
2. Masuk sebagai account owner.
3. Buka **Developer account > Account details / About you / Developer profile**.
4. Cek account type:
   - Personal
   - Organization
5. Cek Google Payments profile yang tertaut.
6. Cek apakah ada banner/verifikasi "Play Console Requirements".
7. Cek apakah Google meminta D-U-N-S atau data organisasi.

Jika account type saat ini **Personal**, maka reject Google sesuai dengan pesan resmi.

## 4. Dokumen yang Perlu Disiapkan

Berdasarkan requirement Google untuk Organization account:

- D-U-N-S number PT TAPGO LION INDONESIA.
- Nama organisasi sesuai dokumen legal.
- Alamat organisasi sesuai dokumen legal/D-U-N-S.
- Nomor telepon organisasi.
- Website organisasi: `https://tapgolion.id`.
- Nama kontak resmi.
- Email kontak resmi.
- Nomor telepon kontak resmi.
- Developer email publik.
- Developer phone publik.
- Google Payments profile organisasi.
- Dokumen legal perusahaan jika diminta Google.
- Rekening/bank/payment profile jika monetization/merchant account diperlukan.

Sumber: [Required information to create a Play Console developer account](https://support.google.com/googleplay/android-developer/answer/13628312)

## 5. Apakah PT TAPGO LION INDONESIA Memenuhi Syarat?

**Secara prinsip: YA, jika legalitas perusahaan valid dan D-U-N-S tersedia/berhasil dibuat.**

Syarat praktis:

- Nama legal di Google Payments profile harus cocok dengan data D-U-N-S.
- Alamat harus cocok.
- Nomor telepon/website harus aktif.
- Email organisasi sebaiknya memakai domain resmi, misalnya `support@tapgolion.id` atau email perusahaan lain yang aktif.

## 6. Strategi Utama yang Direkomendasikan

### Pilihan A — Ubah/upgrade akun saat ini menjadi Organization

**Rekomendasi utama: GO, jika Play Console menyediakan opsi perubahan account type atau support Google dapat memproses koreksi akun.**

Kelebihan:

- Risiko terhadap package `id.tapgolion.tapgo` paling kecil.
- Closed Testing dan tester opt-in kemungkinan tetap utuh.
- Tidak perlu transfer app.
- Tidak perlu membuat tester opt-in ulang.
- Riwayat app/release tetap di akun yang sama.

Kekurangan:

- Tidak selalu tersedia self-service.
- Bisa perlu kontak Play Support.
- Butuh data organisasi lengkap dan verifikasi.

### Pilihan B — Buat Organization account baru lalu transfer app

**Rekomendasi cadangan: GO hanya jika opsi A tidak tersedia/ditolak Google.**

Kelebihan:

- Akun baru sejak awal Organization.
- Data legal lebih bersih dan sesuai PT.

Kekurangan:

- Google menyatakan test groups tidak ikut transfer; closed testing groups perlu dibuat ulang dan user mungkin harus opt-in ulang.
- Perlu transfer request dan approval kedua akun.
- Perlu update integrasi seperti Firebase/Google APIs bila terkait.
- Reports tertentu tidak ikut transfer.

Sumber transfer: [Transfer apps to a different developer account](https://support.google.com/googleplay/android-developer/answer/6230247)

## 7. Urutan Eksekusi yang Disarankan

### Fase 1 — Freeze dan backup metadata

1. Jangan upload release baru sampai strategi akun jelas.
2. Export/download:
   - release notes
   - screenshots
   - store listing
   - data safety answers
   - financial declaration answers
   - content rating
   - tester list
   - closed testing link
   - current policy/rejection message
3. Catat app id/package: `id.tapgolion.tapgo`.

### Fase 2 — Verifikasi akun

1. Cek account type.
2. Jika Personal, buka Play Console support.
3. Sampaikan bahwa TapGo adalah aplikasi PT TAPGO LION INDONESIA dan Google meminta Organization account.
4. Minta opsi resmi:
   - convert/correct current account to Organization, atau
   - create Organization target account and transfer app.

### Fase 3 — Siapkan Organization verification

1. Cek/minta D-U-N-S.
2. Pastikan data PT di D-U-N-S cocok dengan dokumen legal.
3. Siapkan website, email, phone, dan Google Payments profile.
4. Siapkan dokumen perusahaan jika diminta.

### Fase 4 — Perbaiki App Content

1. Isi Financial features declaration secara jujur.
2. Perbarui Data Safety agar cocok dengan Privacy Policy.
3. Isi App access dengan credential reviewer.
4. Review wording store listing.
5. Pastikan payment disclosure jelas.

### Fase 5 — Resubmit release

1. Setelah akun Organization verified, upload/resubmit v3 atau release berikutnya.
2. Jika harus transfer, selesaikan transfer dulu, buat ulang closed testing groups, lalu upload release.

## 8. Risiko terhadap Package ID dan Closed Testing

| Area | Risiko | Mitigasi |
|---|---|---|
| Package ID | Rendah jika akun dikonversi; sedang jika transfer | Jangan buat app baru dengan package sama; gunakan transfer resmi |
| Closed Testing | Rendah jika akun sama; tinggi jika transfer | Jika transfer, tester groups tidak ikut dan perlu opt-in ulang |
| Tester opt-in | Tetap jika akun sama; bisa hilang jika transfer | Export tester list/link sebelum tindakan |
| v2 tester access | Seharusnya tetap jika akun aktif | Jangan unpublish manual |
| v3 rejected | Bisa resubmit setelah account fix | Lengkapi declaration |

## 9. Rekomendasi Final

1. **Prioritas 1:** coba ubah/verify akun saat ini menjadi Organization melalui Play Console/Play Support.
2. **Prioritas 2:** jika Google tidak menyediakan konversi, buat Organization account baru milik PT TAPGO LION INDONESIA dan transfer app.
3. Jangan membuat aplikasi baru dengan package lain kecuali benar-benar dipaksa; itu akan mengorbankan continuity package `id.tapgolion.tapgo`.

