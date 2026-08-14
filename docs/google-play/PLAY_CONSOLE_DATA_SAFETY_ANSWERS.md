# Draft Jawaban Play Console Data Safety - TapGo

Tanggal: 15 Juli 2026

Gunakan draft ini sebagai panduan. Jawaban final tetap harus diisi owner di Play Console sesuai versi build yang diunggah.

## Data Collection

TapGo mengumpulkan data pengguna untuk membuat akun, membership, transaksi, wallet, referral, withdrawal, keamanan, dan support.

## Data Types

| Kategori Play Console | Jawaban | Alasan |
|---|---|---|
| Name | Collected | Nama akun/member/invoice/support. |
| Phone number | Collected | Login, kontak akun, anti-abuse. |
| Email address | Collected if provided | Support, reviewer/demo, kontak opsional. |
| Address | Collected if provided | Form profil/membership tertentu. |
| User IDs | Collected | ID akun internal. |
| Photos/videos | Collected if uploaded | Foto KTP/selfie/profil melalui camera/gallery. |
| Files/docs | Collected if uploaded | Dokumen KTP/selfie membership/KYC. |
| Purchase history | Collected | Membership order, invoice, payment status. |
| Financial info | Collected | Wallet ledger, withdrawal bank account, PPOB benefit; TapGo bukan layanan pinjaman. |
| App activity | Collected | Referral, membership, wallet, support activity. |
| App info/performance | Collected if diagnostics active | Crash/diagnostic/security log. |
| Device or other IDs | Collected | Device fingerprint non-sensitive untuk fraud prevention. |
| Location | Not collected | Tidak ada permission lokasi pada manifest utama. |
| Contacts | Not collected | Tidak ada contacts permission. |
| SMS | Not collected | Tidak ada SMS permission. |

## Sharing

Data dibagikan hanya sejauh diperlukan untuk:

- Payment processing melalui DOKU atau provider pembayaran resmi.
- Infrastruktur hosting/backend/cloud.
- Kewajiban hukum, audit, fraud prevention, atau permintaan otoritas yang sah.

Data tidak dijual dan tidak digunakan untuk iklan pihak ketiga.

## Security Practices

- Data encrypted in transit: Yes, HTTPS.
- User can request data deletion: Yes, melalui `https://tapgolion.id/delete-account` atau menu aplikasi.
- Data minimization: Use only for account, membership, payment, wallet, support, and security.
