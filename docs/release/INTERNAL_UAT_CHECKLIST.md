# Internal UAT Checklist

Dokumen ini untuk UAT internal sebelum closed beta/public launch. Jangan gunakan data pribadi asli kecuali sudah disetujui owner.

## UAT Rules

- DOKU adalah primary gateway.
- Midtrans hanya secondary/fallback.
- Xendit tidak digunakan.
- Jangan melakukan pembayaran nyata tanpa persetujuan owner.
- Jangan mengubah data production tanpa backup dan approval.

## User Flow

| No | Scenario | Expected Result | Status |
| --- | --- | --- | --- |
| 1 | Register user baru | User Basic dibuat, referral code unik, tidak crash | Pending manual UAT |
| 2 | Login | Token/session valid, dashboard terbuka | Pending manual UAT |
| 3 | Membership Basic | Basic aktif, PPOB benefit sesuai rule production | Pending manual UAT |
| 4 | Membership Silver | Paket Silver terlihat Rp500.000 dan benefit benar | Pending manual UAT |
| 5 | DOKU checkout | Create payment menghasilkan `paymentUrl` | Pending DOKU UAT |
| 6 | Invoice pending | Invoice/order tetap pending sebelum webhook paid | Pending DOKU UAT |
| 7 | Webhook paid | Invoice/order paid dan membership aktif | Pending DOKU UAT |
| 8 | Wallet update | Cash/PPOB tidak tercampur | Pending manual UAT |
| 9 | Referral bonus | Bonus sponsor/referral sesuai rule dan tidak double | Pending DOKU UAT |
| 10 | Admin payment review | Admin melihat transaksi/invoice/payment status | Pending manual UAT |
| 11 | Withdraw | Withdraw hanya dari cash balance | Pending manual UAT |
| 12 | Logout/login ulang | Session konsisten, tidak stuck di splash | Pending manual UAT |

## Payment-Specific Checks

- Create payment hanya untuk order milik user atau ADMIN/SUPER_ADMIN.
- Amount selalu dari database.
- Signature webhook invalid ditolak.
- Duplicate paid webhook aman.
- Failed/expired setelah paid tidak downgrade.
- Unknown status tidak mengaktifkan membership.

## Evidence to Capture

- Screenshot dashboard.
- Screenshot package Silver.
- Screenshot checkout/invoice.
- Payment URL response sanitized.
- Webhook log sanitized.
- Invoice before/after.
- Wallet ledger before/after.

## Go / No-Go

GO internal beta hanya jika:

- Register/login/logout PASS.
- Membership order PASS.
- DOKU create payment PASS.
- DOKU webhook production UAT PASS.
- Wallet/referral idempotency PASS.
- Tidak ada P0/P1 open.

