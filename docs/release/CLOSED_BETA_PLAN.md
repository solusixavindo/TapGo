# Closed Beta Plan

Dokumen ini menyiapkan closed beta TapGo tanpa deploy otomatis dan tanpa upload Google Play dari Codex.

## Objective

Memvalidasi stabilitas aplikasi, flow membership, payment readiness, wallet/PPOB, referral, dan support sebelum rollout lebih luas.

## Tester List Template

| No | Nama | Role | Phone/Email | Device | Android Version | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Owner/Test Lead | SUPER_ADMIN | Diisi manual | Diisi manual | Diisi manual | Pending |
| 2 | Admin Tester | ADMIN | Diisi manual | Diisi manual | Diisi manual | Pending |
| 3 | User Tester 1 | USER | Diisi manual | Diisi manual | Diisi manual | Pending |
| 4 | User Tester 2 | USER | Diisi manual | Diisi manual | Diisi manual | Pending |

## Testing Scenarios

- Install/update aplikasi dari Closed Testing.
- Register user baru.
- Login/logout.
- Dashboard render dan tidak stuck di splash.
- Membership package.
- Checkout DOKU tanpa pembayaran nyata kecuali disetujui.
- Invoice pending.
- Wallet/TapGoPay dan PPOB balance.
- Referral tree.
- Admin review.
- Withdraw request.
- Contact/support/delete account info.

## Bug Severity

| Severity | Definition | Example |
| --- | --- | --- |
| P0 | Crash, data uang salah, payment rusak, security bypass | Payment paid dobel, user bisa akses admin |
| P1 | Fitur utama gagal tapi tidak merusak uang/data | Checkout gagal, login role gagal |
| P2 | UI/wording/edge case minor | Text overflow kecil |

## Feedback Form Fields

- Nama tester.
- Device dan OS.
- App version.
- Akun/role.
- Langkah reproduksi.
- Expected result.
- Actual result.
- Screenshot/video.
- Severity.

## Go / No-Go Criteria

GO jika:

- Tidak ada P0 open.
- P1 payment/login/membership selesai atau ada workaround aman.
- DOKU production webhook UAT PASS.
- Support siap menerima laporan.

NO-GO jika:

- Payment webhook belum terbukti.
- Ada double bonus/ledger.
- Aplikasi stuck di splash/login.
- Role guard bermasalah.

