# Google Play Asset Readiness Report - TapGo

Tanggal: 11 Juni 2026

## Summary

Google Play legal and branding assets are mostly ready. The remaining manual work is capturing real app screenshots from the final APK after the Midtrans payment channel blocker is resolved or clearly excluded from screenshot flow.

## Privacy Policy Status

Status: Ready

Files:

- `apps/landing-page/src/app/privacy-policy/page.tsx`
- `docs/PRIVACY_POLICY.md`

Public URL target:

- `https://tapgolion.id/privacy-policy`

## Terms Status

Status: Ready

Files:

- `apps/landing-page/src/app/terms-and-conditions/page.tsx`
- `docs/TERMS_AND_CONDITIONS.md`

Public URL target:

- `https://tapgolion.id/terms-and-conditions`

## Feature Graphic Status

Status: Ready as draft final

File:

- `google-play-assets/feature-graphic-1024x500.png`

Notes:

- Size is 1024 x 500 px.
- Uses official TapGo logo from the Flutter app.
- Does not use third-party brand assets.
- Does not include financial guarantee wording.

## Logo Status

Status: Ready

Official source logo:

- `apps/user_app/assets/images/tapgo_logo.jpeg`

Current app usage:

- Login/Register screen.
- Flutter splash screen.
- Profile/dashboard fallback image.
- Launcher icon source via `flutter_launcher_icons`.

## Screenshot Status

Status: Not complete

Folder:

- `google-play-assets/screenshots/`

Required manual screenshots:

1. Dashboard User Premium
2. Membership Package
3. Membership Checkout
4. Wallet TapGoPay
5. Referral Network
6. PPOB Benefit
7. Membership Card
8. Admin Dashboard
9. Financial Report
10. Super Admin Dashboard

## Asset yang Masih Harus Diambil Manual

- Semua screenshot Google Play dari APK final.
- Screenshot harus memakai akun UAT dan data yang aman untuk publik.
- Payment/Midtrans screenshot sebaiknya tidak dipakai sebagai store screenshot sampai channel pembayaran aktif, agar tidak menampilkan blocker.

## Kesiapan Google Play

Current readiness: 78%

Estimated readiness after screenshots are captured and reviewed: 92%

Remaining blockers:

- Midtrans payment channel still waiting for activation/check.
- Store screenshots still need manual capture from APK final.
- Final Google Play Console metadata review still needed before upload.

## Recommendation

Proceed with screenshot capture once the APK final is confirmed stable. Do not include Midtrans channel blocker screenshots in Google Play public listing. Keep the Midtrans blocker evidence only for Midtrans support communication.
