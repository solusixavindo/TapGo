# TapGo UAT Execution Report

Tanggal: 4 Juni 2026  
Target UAT: Membership + Referral + Wallet + Admin Console  
Build mode target: `staging/UAT`

## Ringkasan Status

| Area | Status | Catatan |
| --- | --- | --- |
| Mobile member flow | PASS | Flow utama tersedia dan lulus Flutter widget test. |
| Admin role routing | PASS | `SUPER_ADMIN`, `ADMIN`, dan `USER` diarahkan sesuai role. |
| Backend business engine | PASS | Backend unit test komisi lulus; integration test menunggu `TAPGO_TEST_DATABASE_URL`. |
| Midtrans sandbox | PENDING | Struktur endpoint tersedia, butuh sandbox key dan callback publik untuk UAT penuh. |
| Production release | PENDING | Signing release, legal review, dan Play Store metadata belum final. |

## Test Case UAT

| No | Test Case | Expected Result | Status | Evidence / Catatan |
| --- | --- | --- | --- | --- |
| 1 | Register member | User baru tersimpan, masuk dashboard member | PASS | Flow register backend dan local session tersedia. |
| 2 | Login/logout | User dapat login, logout, dan session bersih | PASS | Role-based landing berjalan setelah login/session restore. |
| 3 | Beli Silver | Order Silver dibuat, invoice terbentuk | PASS | Backend membership order API dan activation test tersedia. |
| 4 | Beli Gold | Order Gold dibuat, invoice terbentuk | PASS | Backend membership order API dan activation test tersedia. |
| 5 | Beli Platinum | Order Platinum dibuat, invoice terbentuk | PASS | Dashboard membership membaca status aktif. |
| 6 | Upload KTP/selfie | User dapat memilih gambar dan preview tampil | PASS | `image_picker` terpasang, preview tersimpan lokal per user. |
| 7 | Payment simulator staging | Simulator aktif di development/staging/UAT | PASS | Simulator dimatikan saat `TAPGO_APP_MODE=production`. |
| 8 | Midtrans sandbox | Snap payment, callback, dan status polling berjalan | PENDING | Butuh `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, dan callback URL publik. |
| 9 | Membership aktif | Paket aktif muncul setelah payment success | PASS | Session dan membership snapshot tersimpan. |
| 10 | PPOB benefit | PPOB benefit masuk sesuai paket | PASS | Modul activation backend dan UI wallet menampilkan PPOB. |
| 11 | Referral sponsor bonus | Sponsor menerima bonus direct | PASS | Modul Sponsor Bonus 8% telah diimplementasi dan diuji di backend. |
| 12 | Level bonus | Upline menerima bonus level sesuai eligibility | PASS | Modul Level Bonus 1-10 telah diimplementasi dan diuji di backend. |
| 13 | Reward bonus | Platinum 10 direct sponsor menerima Rp500.000 sekali | PASS | Modul Reward Bonus telah diimplementasi dan diuji di backend. |
| 14 | Wallet | Saldo dan ledger transaksi tampil | PASS | Wallet endpoint dan UI binding tersedia. |
| 15 | Withdraw request | Member dapat mengajukan withdrawal | PASS | Withdrawal API tersedia dan validasi saldo/minimum diterapkan. |
| 16 | Admin approve withdrawal | Admin dapat approve dari `PENDING` | PASS | Endpoint approve dan UI action tersedia. |
| 17 | Admin reject withdrawal | Admin dapat reject dan saldo direfund | PASS | Endpoint reject dan refund ledger tersedia. |
| 18 | Admin mark paid | Super Admin dapat mark paid dari `APPROVED` | PASS | UI membatasi mark paid untuk Super Admin. |
| 19 | Super Admin login | Masuk langsung ke Super Admin Dashboard | PASS | Role gate aktif di Flutter. |
| 20 | Admin login | Masuk langsung ke Admin Dashboard | PASS | Menu sensitif disembunyikan dari Admin. |
| 21 | User biasa tidak bisa akses admin | Tampil pesan tidak memiliki akses admin | PASS | Guard Flutter dan backend role middleware tersedia. |
| 22 | Admin Dashboard real data | Summary/member/payment/wallet/withdrawal membaca backend | PASS | Provider admin memakai endpoint backend real. |
| 23 | Placeholder menu | Tidak terlihat seperti fitur final | PASS | Menu belum final diarahkan ke approval production state. |

## Mode Runtime

| Mode | Flutter flag | Backend env | Payment simulator | Local fallback | Midtrans signature |
| --- | --- | --- | --- | --- | --- |
| Development | `--dart-define=TAPGO_APP_MODE=development` | `NODE_ENV=development` | Aktif | Aktif | Tidak wajib |
| Staging/UAT | `--dart-define=TAPGO_APP_MODE=staging` | `NODE_ENV=staging` | Aktif | Aktif dengan pesan profesional | Disarankan |
| Production | `--dart-define=TAPGO_APP_MODE=production` | `NODE_ENV=production` | Nonaktif | Nonaktif | Wajib |

## Catatan UAT

- Gunakan `staging/UAT` untuk presentasi klien agar simulator payment tetap tersedia.
- Gunakan backend seed demo/UAT sebelum sesi agar dashboard admin langsung berisi data.
- Jangan gunakan production mode untuk presentasi jika Midtrans sandbox callback publik belum siap.
- Integration test backend penuh harus dijalankan dengan `TAPGO_TEST_DATABASE_URL` sebelum production freeze.
