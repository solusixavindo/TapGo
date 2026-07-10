# Google Play Rejection Root Cause Audit

Tanggal: 2026-06-18  
Aplikasi: TapGo  
Package name: `id.tapgolion.tapgo`  
Developer name saat ini: TapGo Indonesia  
Status: Closed Testing aktif; v2 `1.0.1` tersedia untuk tester; v3 `1.0.2` ditolak Google Play.

## 1. Ringkasan Keputusan

**ROOT CAUSE CONFIRMED: YA, dengan tingkat keyakinan tinggi.**

Alasan resmi Google:

> "Violation of Play Console Requirements. Some types of apps can only be distributed by organizations. Financial products and services require organization accounts."

Berdasarkan wording tersebut, penolakan v3 bukan terutama karena bug teknis AAB, package name, signing, atau crash splash. Penolakan mengarah ke syarat jenis akun developer: aplikasi dengan financial products/services harus didistribusikan melalui **Organization account**, bukan personal account.

## 2. Dasar Kebijakan Google Play

Sumber resmi Google Play:

- Google Play Financial Services policy menyatakan financial products/services mencakup produk atau layanan terkait pengelolaan atau investasi uang dan crypto, termasuk personalized advice. Google juga menyatakan app yang memiliki financial features wajib mengisi Financial features declaration di Play Console.  
  Sumber: [Financial Services - Play Console Help](https://support.google.com/googleplay/android-developer/answer/9876821)

- Google Play developer account memiliki dua tipe utama: Personal dan Organization. Organization account membutuhkan informasi organisasi seperti D-U-N-S number, organization name, address, phone number, website, contact name/email/phone, developer email, dan developer phone.  
  Sumber: [Required information to create a Play Console developer account](https://support.google.com/googleplay/android-developer/answer/13628312)

- Data Safety harus menjelaskan praktik pengumpulan, penggunaan, sharing, dan keamanan data aplikasi.  
  Sumber: [Provide information for Google Play's Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469)

## 3. Kenapa TapGo Diklasifikasikan Financial Services

Fitur TapGo yang sangat mungkin memicu klasifikasi financial/financial-adjacent:

| Fitur TapGo | Dampak klasifikasi |
|---|---|
| Membership berbayar | Transaksi berbayar untuk paket layanan |
| Wallet / TapGoPay | Pengelolaan saldo aplikasi |
| PPOB balance / benefit | Saldo/benefit untuk transaksi pembayaran layanan |
| Referral commission | Komisi yang masuk ke wallet |
| Sponsor bonus | Bonus uang/saldo kepada user |
| Level bonus | Struktur komisi bertingkat |
| Withdrawal payout | Pencairan saldo ke rekening/user |
| Midtrans integration | Payment gateway untuk transaksi membership |
| Profit sharing | Pembagian hasil berbasis konfigurasi bisnis |
| Admin financial report | Pelaporan keuangan internal |

Kesimpulan: meskipun TapGo bukan aplikasi pinjaman, TapGo tetap memiliki financial features karena mengelola saldo, komisi, payout, dan pembayaran membership.

## 4. Apakah Penolakan Murni Karena Account Type?

**Kemungkinan besar YA.**

Indikator:

1. Pesan Google secara eksplisit menyebut "Financial products and services require organization accounts."
2. v2 sudah tersedia untuk tester, sehingga package id dan signing dasar sudah diterima sebelumnya.
3. v3 ditolak dengan alasan Play Console Requirements, bukan alasan teknis seperti crash, malware, permission, target SDK, atau signing.
4. TapGo memiliki fitur financial yang secara wajar membuat reviewer meminta Organization account.

Hal yang belum bisa dipastikan tanpa akses Play Console:

- Apakah akun saat ini memang Personal.
- Apakah Financial features declaration sudah diisi lengkap dan konsisten.
- Apakah kategori app dipilih sebagai Finance atau Business/Productivity/Tools.
- Apakah ada reviewer note tambahan di Policy status.

## 5. App Content Declaration yang Perlu Diaudit

| Area Play Console | Status risiko | Catatan |
|---|---:|---|
| Financial features declaration | KRITIS | Wajib karena TapGo memiliki wallet, payout, commission, payment, dan PPOB |
| Data Safety | TINGGI | Harus konsisten dengan Privacy Policy dan permission kamera/media/storage |
| App access | TINGGI | Google reviewer perlu credential atau instruksi login jika fitur terkunci |
| Ads declaration | RENDAH | Isi "No ads" jika memang tidak ada ads SDK/ads serving |
| Target audience | SEDANG | Target harus dewasa/umum, bukan anak-anak, karena financial features |
| Financial features/payment disclosure | KRITIS | Jelaskan membership berbayar, wallet, reward/commission, withdrawal, Midtrans |
| Account deletion | TINGGI | Harus punya instruksi/hubungan dengan Privacy Policy |
| Content rating | SEDANG | Financial/commercial features harus dijawab konsisten |

## 6. Potensi Deklarasi Salah atau Tidak Konsisten

Risiko yang perlu dicek di Play Console:

1. Mengisi aplikasi sebagai non-financial padahal ada wallet/withdrawal/commission.
2. Tidak mengisi Financial features declaration.
3. Tidak menjelaskan bahwa pembayaran membership diproses oleh Midtrans/backend.
4. Menggunakan kategori yang membuat reviewer melihat mismatch dengan fitur.
5. Data Safety tidak menyebut financial info, transaction info, user IDs, phone number, photos/media jika fitur upload masih ada.
6. Store listing terlalu menonjolkan reward/bonus/profit sehingga terlihat seperti financial investment atau money-making app.
7. Tidak menyediakan reviewer credential untuk mengecek dashboard/membership/wallet.

## 7. Risiko Policy Lain Setelah Organization

Setelah account type diperbaiki, risiko berikut tetap mungkin muncul:

| Risiko | Level | Mitigasi |
|---|---:|---|
| Financial declaration kurang lengkap | P1 | Isi semua financial features dengan jujur |
| Payment policy mismatch | P1 | Jelaskan membership sebagai layanan/benefit; audit apakah harus memakai Google Play Billing atau eligible memakai Midtrans |
| Data Safety mismatch | P1 | Selaraskan Privacy Policy, Data Safety, permission, dan fitur aktual |
| Referral/profit sharing wording dianggap "profit promise" | P1 | Hindari kata "profit dijamin", "passive income pasti", "cepat kaya", "investasi" |
| Sensitive permission untuk financial/personal loan salah konteks | P2/P1 | Tegaskan TapGo bukan personal loan app; kamera/media untuk upload dokumen/profil |
| Tester tidak bisa login | P1 | Isi App access dengan credential UAT valid |

## 8. Kesimpulan

**ROOT CAUSE CONFIRMED:** penolakan v3 sangat kuat disebabkan oleh mismatch tipe akun developer dengan klasifikasi TapGo sebagai financial services app.

Namun setelah migrasi ke Organization, TapGo masih perlu memastikan semua deklarasi App Content konsisten, terutama:

- Financial features declaration
- Data Safety
- App access
- Payment disclosure
- Account deletion
- Store listing wording

