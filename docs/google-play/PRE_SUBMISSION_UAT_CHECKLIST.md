# Pre-Submission UAT Checklist - TapGo User App

Tanggal: 15 Juli 2026

## Install & Session

- [ ] Fresh install opens splash then login/register without hang.
- [ ] Register new user works.
- [ ] Login works.
- [ ] Logout works.
- [ ] Logout/login ulang restores correct session.
- [ ] Session expired routes user back to login.
- [ ] Offline state shows user-friendly error.
- [ ] Slow network does not create infinite loading.

## Membership & Payment

- [ ] Basic membership active after registration.
- [ ] Silver package visible with correct price and benefit.
- [ ] Checkout creates invoice.
- [ ] Payment failure/cancel leaves invoice pending/failed and does not activate membership.
- [ ] DOKU checkout opens from backend-created payment URL.
- [ ] No sandbox/test credential visible to user.
- [ ] No Midtrans/DOKU secret in mobile app.

## Wallet, Referral, PPOB

- [ ] Wallet cash and PPOB display separately.
- [ ] PPOB is not withdrawable cash.
- [ ] Referral code visible.
- [ ] Referral tree loads without dummy-only data.
- [ ] Bonus/reward wording does not promise fixed income.

## KYC/Upload

- [ ] Camera permission requested only when upload feature is used.
- [ ] Gallery permission requested only when upload feature is used.
- [ ] Denying permission does not crash the app.
- [ ] KTP/selfie image preview works.

## Legal & Account

- [ ] Privacy Policy opens in app.
- [ ] Terms & Conditions opens in app.
- [ ] Hapus Akun opens in app.
- [ ] Public delete-account page live: `https://tapgolion.id/delete-account`.
- [ ] Support email visible: `support@tapgolion.id`.

## Visual QA

- [ ] No debug banner.
- [ ] No blank page.
- [ ] No obvious overflow on common Android screen sizes.
- [ ] No placeholder/developer text visible.
- [ ] No test password/token/API secret shown.
- [ ] No screenshot/listing asset contains private account, KTP, or full bank account data.
