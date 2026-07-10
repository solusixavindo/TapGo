# Google Play Financial App Policy Review

Tanggal: 2026-06-18  
Aplikasi: TapGo

## 1. Kesimpulan

TapGo sangat mungkin diklasifikasikan oleh Google sebagai aplikasi dengan **financial features** karena memiliki wallet, komisi, payout, PPOB balance, membership berbayar, dan Midtrans payment integration.

Namun TapGo harus diposisikan dengan jelas sebagai:

> Platform membership digital dengan wallet aplikasi, PPOB benefit, reward/commission sesuai syarat, dan pembayaran membership.

TapGo **bukan**:

- aplikasi pinjaman;
- penyedia payday loan;
- peer-to-peer lending;
- trading/investment app;
- crypto app;
- gambling app;
- aplikasi yang menjanjikan profit pasti.

## 2. Dasar Resmi Google

Google Play Financial Services policy:

- Tidak mengizinkan aplikasi yang mengekspos user pada produk/layanan financial yang deceptive atau harmful.
- Financial products/services dipandang sebagai layanan terkait pengelolaan atau investasi uang/crypto, termasuk personalized advice.
- App yang memiliki financial features wajib mengisi Financial features declaration form.

Sumber: [Financial Services - Play Console Help](https://support.google.com/googleplay/android-developer/answer/9876821)

## 3. Mapping Fitur TapGo

| Fitur | Klasifikasi Google risk | Wajib dinyatakan? | Catatan |
|---|---:|---:|---|
| Membership berbayar | Payment / commercial service | YA | Jelaskan paket Silver/Gold/Platinum |
| Wallet / TapGoPay | Financial feature | YA | Jelaskan saldo aplikasi/cash wallet |
| PPOB benefit | Financial/payment-adjacent | YA | Jelaskan sebagai benefit/transaksi PPOB |
| Referral commission | Financial incentive | YA | Hindari wording profit pasti |
| Sponsor bonus | Financial incentive | YA | Sesuai syarat dan setelah transaksi valid |
| Level bonus | Financial incentive | YA | Perlu disclosure jelas |
| Withdrawal payout | Financial feature | YA | Pencairan saldo withdrawable |
| Midtrans payment | Payment integration | YA | Payment via backend/Midtrans |
| Profit sharing | High policy sensitivity | YA jika aktif/terlihat | Hindari klaim investasi/ROI |
| Admin financial report | Internal ops | Tidak untuk user, tapi relevan | Jangan tampilkan ke user umum |

## 4. Personal Loan Risk

TapGo tidak boleh terlihat seperti loan app.

Yang perlu dipastikan:

- Tidak ada kata "pinjaman", "loan", "kredit", "cicilan", "tenor", "APR".
- Tidak ada fitur memberi dana talangan.
- Tidak ada repayment schedule.
- Tidak ada debt collection.
- Tidak ada akses kontak/lokasi untuk pinjaman.

Catatan penting: Google Financial Services policy melarang personal loan apps mengakses permission sensitif tertentu seperti `READ_EXTERNAL_STORAGE` dan `READ_MEDIA_IMAGES`. Larangan ini spesifik untuk personal loan/EWA context. TapGo harus menjelaskan bahwa permission media/kamera dipakai untuk upload gambar/dokumen/profil, bukan pinjaman.

## 5. Payment Policy Risk

Sumber Google Payments policy: [Payments - Play Console Help](https://support.google.com/googleplay/android-developer/answer/9858738)

Poin yang perlu ditinjau owner/legal:

- Google Play Billing wajib untuk in-app purchases berupa fitur digital/content tertentu.
- Google menyebut beberapa pembayaran untuk physical goods/services atau remittance utility bills sebagai pengecualian dari Play billing.
- TapGo membership adalah paket akses/benefit digital + layanan operasional. Karena TapGo memakai Midtrans, perlu memastikan justification payment flow aman.

Rekomendasi:

1. Di App Content/reviewer notes, jelaskan payment purpose sebagai membership/service package yang diproses melalui payment gateway Indonesia.
2. Hindari wording "membeli saldo virtual untuk dipakai dalam app" jika tidak akurat.
3. Jika Google menolak karena Payments policy, siapkan argumen bahwa membership terkait layanan/benefit/kemitraan dan payment gateway lokal, namun siap mengikuti arahan Google jika Billing diperlukan.

## 6. Data Safety Risk

Data yang kemungkinan perlu dinyatakan:

- Nama.
- Nomor HP.
- Email jika ada.
- User ID.
- Referral code/referral relation.
- Membership status/order/invoice.
- Wallet balance/transaction history.
- PPOB benefit/transaction.
- Withdrawal/bank data jika dikumpulkan.
- Photos/media jika upload dokumen/profil/KYC.
- Device ID/fingerprint anti-abuse.
- Crash/diagnostic data jika Firebase/analytics aktif.

Sumber: [Data Safety - Play Console Help](https://support.google.com/googleplay/android-developer/answer/10787469)

## 7. Store Listing / Marketing Risk

Harus dihindari:

- Menonjolkan bonus besar sebagai janji.
- Menampilkan profit sharing sebagai return investasi.
- "Passive income pasti".
- "Cepat kaya".
- "Investasi aman".
- "ROI".
- "Dijamin".

Bahasa aman:

- "Referral reward sesuai syarat."
- "Komisi sesuai ketentuan program."
- "Membership benefit."
- "Wallet aplikasi untuk mencatat saldo dan transaksi."
- "PPOB benefit untuk kebutuhan digital."

## 8. Final Policy Position

TapGo bisa dilanjutkan ke Google Play dengan syarat:

1. Developer account menjadi Organization.
2. Financial features declaration diisi lengkap.
3. Store listing aman dari klaim profit/investasi.
4. Payment flow Midtrans dijelaskan jujur.
5. Data Safety dan Privacy Policy konsisten.
6. Reviewer diberi credential dan instruksi flow.

