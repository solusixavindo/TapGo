# TapGo Operational Monitoring Plan

Tanggal: 2026-06-17

## Tujuan

Monitoring plan ini dirancang untuk membantu owner, admin, dan super admin memantau kesehatan operasional TapGo sebelum dan setelah public launch.

## Monitoring Area

### A. User Growth

Metric:

- registrasi per hari
- login aktif harian
- user baru dari referral
- user suspicious
- user deleted/suspended

Alert threshold:

- Registrasi naik >300% dari rata-rata 7 hari tanpa campaign.
- >5 akun dari device fingerprint sama dalam 24 jam.
- >10 akun dari IP sama dalam 24 jam.
- Banyak user memakai referral yang sama dalam waktu pendek.

Owner action:

- Review anti-abuse report.
- Freeze bonus manual jika pola mencurigakan.
- Hubungi user jika perlu verifikasi.

### B. Membership

Metric:

- order pending
- order paid
- order expired
- upgrade per paket
- pending approval
- package mix Silver/Gold/Platinum

Alert threshold:

- Pending order >24 jam tanpa status.
- Paid order belum approved >4 jam kerja.
- Spike order paket tertentu >300% tanpa campaign.

Owner action:

- Rekonsiliasi invoice/payment.
- Cek Midtrans notification.
- Prioritaskan approval manual.

### C. Payment

Metric:

- Midtrans success
- Midtrans pending
- Midtrans failed
- webhook error
- duplicate notification
- unauthorized transaction
- no payment channel issue

Alert threshold:

- Webhook error >3 kali/jam.
- Payment failed rate >20% harian.
- Duplicate callback menghasilkan ledger duplicate.

Owner action:

- Cek Midtrans dashboard.
- Cek PM2 logs.
- Tunda bonus payout jika payment abnormal.

### D. Wallet

Metric:

- total wallet liability
- withdrawable cash balance
- PPOB balance liability
- negative balance detection
- ledger mismatch
- withdrawal requested/approved/paid

Alert threshold:

- Wallet cash balance negatif.
- `cashBalance` tidak sama dengan ledger credit-debit.
- PPOB balance masuk withdrawal.
- Withdrawal pending >2 hari kerja.

Owner action:

- Freeze withdrawal jika ledger mismatch.
- Lakukan rekonsiliasi manual.
- Eskalasi ke technical owner.

### E. Reward/Commission

Metric:

- sponsor bonus paid
- level bonus paid
- reward pending
- reward approved
- reward paid
- profit sharing period status
- suspicious bonus spike
- user dengan bonus abnormal

Alert threshold:

- Bonus user >Rp1.000.000/hari di fase awal.
- Reward threshold tercapai mendadak tanpa aktivitas wajar.
- Profit sharing period diproses dua kali.
- Reward pending >7 hari tanpa review.

Owner action:

- Manual review reward.
- Cek referral/downline paid/approved.
- Tunda payout jika pola farming.

### F. Anti-Abuse

Metric:

- multiple accounts same device
- multiple accounts same IP
- same phone normalized conflict
- referral chain suspicious
- Basic PPOB farming
- abuse flags open

Alert threshold:

- HIGH abuse flag muncul.
- 3+ akun dari device sama.
- 10+ registrasi IP sama dalam 24 jam.
- Referral chain circular/self-referral attempt.

Owner action:

- Review akun terkait.
- Suspend payout sementara jika perlu.
- Minta verifikasi tambahan.

### G. Admin Operation

Metric:

- withdrawal pending
- refund pending
- complaint pending
- admin actions
- super admin approvals
- role changes
- sensitive document access

Alert threshold:

- Complaint P0 tidak dijawab >2 jam kerja.
- Role change tanpa note.
- Sensitive document access tidak tercatat.
- Admin approve withdrawal milik sendiri.

Owner action:

- Audit admin logs.
- Terapkan dual control.
- Review SOP.

### H. Infrastructure

Metric:

- API health
- database health
- Redis health
- PM2 status
- disk usage
- memory/cpu
- backup status
- SSL certificate expiry

Alert threshold:

- API health fail 2x berturut-turut.
- Disk usage >80%.
- Memory usage >85%.
- Backup gagal 1 hari.
- PM2 restart loop.

Owner action:

- Restart service jika aman.
- Cek logs.
- Jalankan backup manual.
- Eskalasi VPS/provider.

## Daily Checklist

1. Cek API health.
2. Cek PM2 status.
3. Cek dashboard admin summary.
4. Cek order pending/paid/expired.
5. Cek withdrawal pending.
6. Cek wallet negative/mismatch.
7. Cek abuse flags.
8. Cek complaint/support inbox.
9. Cek Midtrans dashboard/payment status.
10. Catat issue harian.

## Weekly Checklist

1. Rekonsiliasi wallet ledger vs balance.
2. Rekonsiliasi PPOB liability.
3. Review reward pending/approved.
4. Review admin audit log.
5. Review suspicious referral patterns.
6. Review backup dan restore readiness.
7. Review uptime/error logs.
8. Review feedback tester/user.
9. Review legal/support complaint trend.

## Alert Threshold Summary

| Area | Threshold | Severity |
| --- | --- | --- |
| API down | 2x health fail | P0 |
| Ledger mismatch | saldo tidak cocok | P0 |
| Payment callback error | >3/jam | P1 |
| Withdrawal pending | >2 hari kerja | P1 |
| Abuse HIGH flag | >=1 | P1 |
| Disk usage | >80% | P1 |
| Reward spike | abnormal harian | P1 |
| Complaint no response | >2 jam kerja untuk P0 | P1 |

## Dashboard Rekomendasi

Minimal admin/super admin dashboard:

- User growth daily
- Membership funnel
- Payment status
- Wallet liability
- PPOB liability
- Withdrawal queue
- Reward/profit sharing status
- Anti-abuse alerts
- Admin action log
- System health

## Public Launch Monitoring Rule

Public launch sebaiknya hanya dimulai jika:

- backup harian aktif
- Midtrans channel aktif
- wallet/PPOB ledger stabil
- audit trail admin P1 selesai
- anti-abuse monitoring minimal aktif
- SOP support/finance dijalankan
