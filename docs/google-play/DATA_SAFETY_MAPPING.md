# Data Safety Mapping - TapGo User App

Tanggal: 15 Juli 2026  
Scope: `apps/user_app`, backend TapGo, landing page legal

## Data Yang Dikumpulkan

| Data | Dikumpulkan | Wajib/Opsional | Tujuan | Dibagikan ke Pihak Ketiga | Disimpan | Dapat Diminta Dihapus |
|---|---:|---|---|---|---:|---:|
| Nama | Ya | Wajib untuk akun/membership | Identitas akun, invoice, support | Tidak untuk iklan; dapat diproses oleh backend/hosting | Ya | Ya, kecuali catatan legal/transaksi |
| Nomor telepon | Ya | Wajib login/akun | Autentikasi, kontak, anti-abuse | Tidak untuk iklan | Ya | Ya, dengan batasan audit/legal |
| Email | Ya jika diisi | Opsional/tergantung fitur | Support, membership, reviewer/demo | Tidak untuk iklan | Ya | Ya |
| Alamat | Ya pada form tertentu | Opsional/fitur membership | Profil membership/KYC operasional | Tidak untuk iklan | Ya | Ya, dengan batasan legal |
| NIK/KTP number | Ya pada form membership | Wajib jika fitur KYC dipakai | Verifikasi identitas membership | Tidak untuk iklan | Ya | Dapat diminta hapus jika tidak wajib dipertahankan |
| Foto KTP/selfie | Ya jika user upload | Wajib untuk KYC tertentu | Verifikasi identitas | Tidak untuk iklan | Ya/lokal-backend sesuai flow | Dapat diminta hapus jika tidak wajib dipertahankan |
| Device identifier/fingerprint | Ya, non-sensitive generated value | Otomatis | Anti-abuse, fraud prevention, keamanan akun | Tidak untuk iklan | Ya/log keamanan | Terbatas, dapat dipertahankan untuk security |
| Membership/order/invoice | Ya | Wajib transaksi | Aktivasi membership dan audit | Payment gateway menerima data transaksi yang diperlukan | Ya | Tidak selalu, dapat dipertahankan legal |
| Wallet/PPOB/ledger | Ya | Wajib fitur wallet | Saldo cash, PPOB, bonus, withdrawal, audit | Tidak untuk iklan | Ya | Retention terbatas oleh audit/legal |
| Referral/network | Ya jika dipakai | Opsional fitur | Referral, bonus sesuai syarat, fraud prevention | Tidak untuk iklan | Ya | Terbatas jika terkait transaksi |
| Bank account withdrawal | Ya jika user mengisi | Opsional fitur withdrawal | Pencairan saldo cash | Tidak untuk iklan | Ya | Terbatas jika terkait withdrawal |
| Crash/diagnostic logs | Terbatas | Otomatis jika tersedia | Stabilitas, debugging, security | Firebase/hosting jika aktif | Ya/retensi teknis | Terbatas |
| Location | Tidak ditemukan di manifest | Tidak dipakai | Tidak berlaku | Tidak | Tidak | Tidak berlaku |

## SDK/Pihak Ketiga

| Komponen | Status | Data yang Relevan | Catatan |
|---|---|---|---|
| DOKU | Primary payment gateway | Invoice, amount, customer/payment metadata yang diperlukan | Credential hanya backend. |
| Midtrans | Secondary/fallback | Invoice/payment metadata jika dipakai | Menunggu/review fallback, credential tidak di Flutter. |
| Firebase Messaging | Dependency tersedia | Token/perangkat jika notifikasi diaktifkan | Manifest utama belum meminta `POST_NOTIFICATIONS`; jika push aktif, update disclosure. |
| Google Maps | Dependency tersedia | Tidak ada permission lokasi di manifest utama | Jika fitur lokasi diaktifkan nanti, perlu update permission dan Data Safety. |
| Image Picker | Aktif | Foto KTP/selfie/profil | Memicu kamera/media permission. |

## Keamanan

- Data dikirim melalui HTTPS.
- Secret payment gateway tidak berada di aplikasi Flutter.
- Endpoint payment memvalidasi transaksi di backend.
- Account deletion tersedia melalui aplikasi dan halaman web.

