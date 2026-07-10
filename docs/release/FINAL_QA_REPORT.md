# FINAL QA REPORT - TAPGO UAT

Tanggal: 5 Juni 2026
Target UAT: Presentasi klien Senin, 8 Juni 2026
Mode build: staging/UAT

## Ringkasan Status

Status aplikasi: READY FOR CLIENT UAT

Catatan: status ini berlaku untuk UAT staging dengan backend aktif, seed/admin tersedia, dan payment simulator staging atau Midtrans sandbox. Tidak ada bug Critical yang tersisa dari audit kode dan validasi otomatis. Satu bug Major pada referral register ditemukan dan sudah diperbaiki.

## Validasi Otomatis

| Area | Command | Status | Catatan |
| --- | --- | --- | --- |
| Backend build | `npm --workspace apps/backend run build` | PASS | TypeScript build selesai tanpa error. |
| Backend test | `npm --workspace apps/backend run test` | PASS | 5 test aktif lulus; 60 integration/e2e test diskip karena `TAPGO_TEST_DATABASE_URL` tidak aktif. |
| Flutter analyze | `flutter analyze` | PASS | No issues found. |
| Flutter test | `flutter test` | PASS | 7/7 widget test lulus. |
| Flutter build APK UAT | `flutter build apk --debug --dart-define=TAPGO_APP_MODE=staging` | PASS | APK debug staging berhasil dibuat. |

APK UAT terbaru:

`dist/TapGo-UAT-08062026-vFinal.apk`

## QA Flow Matrix

| Flow | Status | Severity | Hasil Audit |
| --- | --- | --- | --- |
| Register member baru | PASS | - | Register wajib nama, nomor HP, dan password. Tidak ada tombol preview bypass. |
| Login member | PASS | - | Login memakai backend auth; backend mati tidak masuk dashboard. |
| Logout dan session restore | PASS | - | Session/token tersimpan dan direstore melalui storage lokal aman. |
| Pilih paket Silver | PASS | - | Order membership dibuat melalui endpoint membership order. |
| Pilih paket Gold | PASS | - | Order membership dibuat melalui endpoint membership order. |
| Pilih paket Platinum | PASS | - | Order membership dibuat melalui endpoint membership order. |
| Checkout | PASS | - | Invoice/order dibuat, tidak ditemukan blank screen dari widget test flow. |
| Payment simulator staging | PASS | - | Endpoint simulator diguard dari production. |
| Midtrans callback | PASS WITH RISK | Minor | Handler dan signature guard production tersedia; perlu uji sandbox publik dengan key/callback nyata sebelum Go Live. |
| Membership aktif | PASS | - | Payment success atomic: invoice PENDING ke PAID sebelum membership/benefit diproses. |
| Referral code terbentuk | PASS | - | User response membawa referral code dari backend. |
| Referral sponsor saat register | PASS | Major fixed | Bug ditemukan: register mengirim kode referral tetapi belum klaim sponsor. Sudah diperbaiki dengan `POST /referrals/claim` setelah register sukses. |
| Referral tree A -> B -> C -> D | PASS WITH RISK | Minor | Engine recursive referral ada dan test integration tersedia, tetapi test live DB diskip tanpa `TAPGO_TEST_DATABASE_URL`. |
| Sponsor bonus | PASS | - | Duplicate prevention memakai unique commission key dan transaction. |
| Level bonus | PASS | - | Level 1-10 dihitung di payment success dengan eligibility direct sponsor. |
| Reward bonus | PASS | - | Platinum 10 direct sponsor memakai unique milestone commission. |
| Wallet balance | PASS | - | Wallet update memakai transaction ledger. |
| Wallet tidak negatif | PASS | - | Withdrawal reserve memakai `updateMany` dengan `balance >= amount`. |
| Histori transaksi wallet | PASS | - | Setiap credit/debit penting mencatat `wallet_transactions`. |
| Withdraw request | PASS | - | Minimum Rp50.000 dan saldo cukup divalidasi. |
| Withdraw approve | PASS | - | Hanya status PENDING bisa APPROVED. |
| Withdraw reject | PASS | - | Refund hanya untuk PENDING dan guard existing refund. |
| Withdraw paid | PASS | - | Hanya APPROVED bisa PAID; SUPER_ADMIN-only di admin endpoint. |
| Double approve/reject/paid | PASS | - | State guard + serializable transaction. |
| SUPER_ADMIN full access | PASS | - | Role menu sensitif hanya SUPER_ADMIN. |
| ADMIN limited access | PASS | - | Menu sensitif tidak tampil untuk ADMIN, endpoint sensitif diguard. |
| MEMBER admin access | PASS | - | Member tidak melihat dashboard admin; backend admin route memakai `requireRoles`. |
| Backend mati | PASS | - | Auth tidak bypass; UI menampilkan pesan profesional/retry, bukan stack trace. |
| Blank screen / infinite loading | PASS | - | Widget test dasar flow utama lulus; loading/error state tersedia. |

## Bug Ditemukan

| ID | Bug | Severity | Status |
| --- | --- | --- | --- |
| QA-001 | Kode referral saat register belum otomatis membuat relasi sponsor/upline karena Flutter hanya mengirim `referralCode` ke `/auth/register`, sedangkan relasi referral dibuat lewat endpoint terpisah `/referrals/claim`. | Major | FIXED |

## Bug Diperbaiki

### QA-001 - Referral register tidak tercatat

Perbaikan:

- Menambahkan client method `claimReferral()` ke `apps/user_app/lib/services/tapgo_api_client.dart`.
- Setelah register sukses dan access token tersedia, `apps/user_app/lib/screens/auth_screen.dart` memanggil `POST /api/v1/referrals/claim` dengan kode referral yang diinput.
- Menambahkan pesan user-friendly untuk kode referral invalid dan self-referral.

Dampak:

- Flow Member A -> Member B sekarang dapat membentuk sponsor/upline saat B register memakai kode A.
- Basic sponsor bonus tetap memakai engine referral existing, tanpa mengubah business engine.

## Bug Tersisa

| ID | Risiko | Severity | Rekomendasi |
| --- | --- | --- | --- |
| R-001 | Integration/e2e backend test diskip jika `TAPGO_TEST_DATABASE_URL` tidak disediakan. | Minor | Jalankan lagi di mesin UAT dengan test database terpisah sebelum production release. |
| R-002 | Midtrans callback nyata perlu diuji dengan sandbox key dan callback URL publik. | Minor | Lakukan smoke test sandbox sebelum demo pembayaran real. |
| R-003 | Nama internal file/provider masih memakai kata `demo` untuk kompatibilitas kode lama, tetapi bukan label UI/bypass staging. | Minor | Refactor nama internal setelah UAT, bukan sebelum presentasi. |

## File Diubah Saat Bug Hunt

- `apps/user_app/lib/services/tapgo_api_client.dart`
- `apps/user_app/lib/screens/auth_screen.dart`
- `dist/TapGo-UAT-08062026-vFinal.apk`
- `FINAL_QA_REPORT.md`

## Keputusan QA

READY FOR CLIENT UAT

Alasan:

- Tidak ada Critical blocker tersisa.
- Register/login tidak bisa melewati backend.
- Referral register blocker sudah ditutup.
- Payment, wallet, commission, withdrawal, dan admin role guard sudah memakai transaction/state guard.
- Flutter analyze/test/build lulus setelah patch terakhir.

Tidak direkomendasikan untuk Play Store production sebelum:

- Semua integration/e2e test dijalankan dengan `TAPGO_TEST_DATABASE_URL`.
- Midtrans sandbox callback diuji end-to-end dari jaringan publik.
- Release signing dan privacy/terms final diverifikasi ulang.
