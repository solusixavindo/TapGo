# TapGo Final UAT Checklist

Date: 2026-06-11  
Target API: `https://api.tapgolion.id`  
APK target name: `TapGo-UAT-production-final-financial-engine.apk`

## Status

Backend deployment status: Pending manual VPS deploy.  
Production smoke test status: Pending.  
APK final build status: Not allowed until smoke test PASS.

## A. Login Role

| Test Case | Expected | PASS/FAIL | Notes |
| --- | --- | --- | --- |
| Super Admin login | Masuk Super Admin Dashboard | | |
| Admin login | Masuk Admin Dashboard | | |
| User login | Masuk User Dashboard | | |
| Logout Super Admin | Kembali ke login dan tidak bisa back ke dashboard | | |
| Logout Admin | Kembali ke login dan tidak bisa back ke dashboard | | |
| Logout User | Kembali ke login dan tidak bisa back ke dashboard | | |

## B. User Flow Referral

| Test Case | Expected | PASS/FAIL | Notes |
| --- | --- | --- | --- |
| Register User A | User A aktif sebagai Basic | | |
| Register User B pakai referral A | B masuk downline A | | |
| Register User C pakai referral B | C masuk downline B dan network A | | |
| Register User D pakai referral C | D masuk downline C dan network A/B | | |
| Referral tree User A | Struktur A > B > C > D tampil benar | | |
| Referral tree tidak dummy | Nama user asli, bukan sample/mock | | |

## C. Membership

| Test Case | Expected | PASS/FAIL | Notes |
| --- | --- | --- | --- |
| User upgrade Silver | Order dibuat, payment Midtrans terbuka | | |
| User upgrade Gold | Order dibuat, payment Midtrans terbuka | | |
| User upgrade Platinum | Order dibuat, payment Midtrans terbuka | | |
| Invoice tampil | Nomor invoice, user, paket, nominal, tanggal, status tampil | | |
| Payment success Silver | Status membership menjadi Silver | | |
| Payment success Gold | Status membership menjadi Gold | | |
| Payment success Platinum | Status membership menjadi Platinum | | |
| Pending/failed payment | Membership tidak aktif dan bonus tidak keluar | | |

## D. Wallet / PPOB / Withdraw

| Test Case | Expected | PASS/FAIL | Notes |
| --- | --- | --- | --- |
| Basic baru user ke-1 sampai 1000 | PPOB Rp5.000, cash Rp0 | | |
| Basic baru setelah kuota | PPOB Rp0, cash Rp0 | | |
| Silver aktif | PPOB Rp100.000 | | |
| Gold aktif | PPOB Rp600.000 | | |
| Platinum aktif | PPOB Rp1.000.000 | | |
| Sponsor bonus | Masuk cash wallet | | |
| Level bonus | Masuk cash wallet | | |
| Reward paid | Masuk cash wallet setelah admin mark paid | | |
| Profit sharing paid | Masuk cash wallet | | |
| Withdraw | Hanya memakai cashBalance | | |
| Withdraw dengan PPOB saja | Ditolak, PPOB tidak berkurang | | |

## E. Admin

| Test Case | Expected | PASS/FAIL | Notes |
| --- | --- | --- | --- |
| Admin dashboard summary | Data production tampil | | |
| Approve member | Status membership berubah sesuai paket | | |
| Approve withdraw | Status withdraw approved/paid sesuai action | | |
| Reject withdraw | Refund cash jika saldo sudah reserved | | |
| Reward pending terlihat | Reward list menampilkan pending reward | | |
| Reward approve | Status menjadi APPROVED | | |
| Reward mark paid | Cash wallet bertambah, tidak dobel | | |
| Financial report | Cash/PPOB/reward/profit sharing summary tampil | | |
| USER akses admin | Ditolak 403 | | |
| ADMIN akses report | Diizinkan 200 | | |
| SUPER_ADMIN akses report | Diizinkan 200 | | |

## F. Midtrans Screenshot Flow

Use folder:

```text
midtrans-transaction-flow/screenshots/
```

| No | Screenshot | File Name | PASS/FAIL | Notes |
| ---: | --- | --- | --- | --- |
| 1 | Login/register | `01-login-register.png` | | |
| 2 | Dashboard | `02-dashboard-user.png` | | |
| 3 | Pilih paket/menu membership | `03-membership-menu.png` | | |
| 4 | Pilihan paket | `04-package-selection.png` | | |
| 5 | Form membership | `05-membership-form.png` | | |
| 6 | Checkout summary | `06-checkout-summary.png` | | |
| 7 | Tombol bayar | `07-pay-button.png` | | |
| 8 | Midtrans payment page | `08-midtrans-payment-page.png` | | |
| 9 | Payment method | `09-payment-method.png` | | |
| 10 | Payment success/pending | `10-payment-success.png` | | |
| 11 | Invoice | `11-invoice.png` | | |
| 12 | Membership active | `12-membership-active.png` | | |

## G. APK Build Gate

Build APK only after:

- [ ] Production backup completed.
- [ ] Backend migration deployed.
- [ ] PM2 restart successful.
- [ ] Production smoke test PASS.
- [ ] `PRODUCTION_SMOKE_TEST_REPORT.md` updated with actual results.

Build command:

```bash
cd apps/user_app
flutter build apk --release \
  --dart-define=TAPGO_APP_MODE=production \
  --dart-define=TAPGO_API_BASE_URL=https://api.tapgolion.id
```

Expected output copy:

```bash
mkdir -p ../../dist
cp build/app/outputs/flutter-apk/app-release.apk \
  ../../dist/TapGo-UAT-production-final-financial-engine.apk
```
