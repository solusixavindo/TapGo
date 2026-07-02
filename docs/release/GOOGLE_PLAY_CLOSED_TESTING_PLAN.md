# Google Play Closed Testing Plan

Dokumen ini menyiapkan closed testing tanpa build/upload otomatis.

## Closed Testing Checklist

- [ ] Tester list minimal sesuai kebutuhan Play Console.
- [ ] Internal support channel siap.
- [ ] Build terbaru sudah melewati `flutter analyze` dan `flutter test`.
- [ ] Release notes jelas.
- [ ] Payment test restrictions dikomunikasikan.
- [ ] Crash/bug reporting channel aktif.
- [ ] DOKU payment UAT tidak dilakukan oleh tester umum tanpa arahan.

## Tester Onboarding

1. Terima link Closed Testing dari owner.
2. Install aplikasi.
3. Gunakan akun UAT atau daftar akun baru sesuai instruksi.
4. Jangan memasukkan data sensitif asli kecuali diminta.
5. Jangan melakukan pembayaran nyata tanpa instruksi.
6. Laporkan bug dengan screenshot/video.

## Install Instructions

- Buka link opt-in Google Play.
- Join testing.
- Install TapGo.
- Pastikan aplikasi versi terbaru.
- Jika update tidak muncul, clear Play Store cache atau tunggu propagasi.

## Feedback Collection

Gunakan format:

```text
Nama:
Device:
Android version:
App version:
Role:
Fitur:
Langkah:
Expected:
Actual:
Screenshot/video:
Severity:
```

## Crash Monitoring Checklist

- [ ] Crash saat splash/startup.
- [ ] Crash saat login/register.
- [ ] Crash saat dashboard.
- [ ] Crash saat membership package.
- [ ] Crash saat checkout.
- [ ] Crash saat wallet/referral.
- [ ] Crash saat logout/login ulang.

## Payment Test Restrictions

- DOKU adalah primary gateway.
- Midtrans fallback tidak diuji oleh tester umum kecuali owner meminta.
- Xendit tidak digunakan.
- Tester tidak melakukan pembayaran nyata tanpa approval.
- Jika membuka payment page, cek nominal dan invoice saja.

## Production Rollout Criteria

Rollout boleh dipertimbangkan jika:

- Tidak ada P0/P1 open.
- DOKU webhook production UAT PASS.
- Startup/splash stabil di perangkat tester.
- Register/login/membership/wallet/referral PASS.
- Store listing dan Data Safety selesai.

