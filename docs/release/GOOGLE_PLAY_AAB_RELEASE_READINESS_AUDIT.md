# Google Play AAB Release Readiness Audit

Tanggal audit: 2026-06-13

Status scope:

- Tidak deploy.
- Tidak cleanup execute.
- Tidak mengubah production database.
- Tidak build AAB final.
- Audit dilakukan terhadap konfigurasi Android/Flutter, source mobile, legal/store assets, dan validasi `flutter analyze` / `flutter test`.

## Referensi Google Play

- Google Play mewajibkan developer mengisi Data Safety form dan menyertakan privacy policy; developer bertanggung jawab atas deklarasi data yang lengkap dan akurat. Sumber: [Google Play Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469).
- Jika aplikasi memungkinkan pembuatan akun, Google Play mensyaratkan jalur in-app untuk request delete account dan web link untuk request delete account/data deletion. Sumber: [Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111).
- New apps dan app updates harus menargetkan Android 15/API 35 atau lebih tinggi untuk Google Play. Sumber: [Google Play target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878).

## Executive Summary

| Area | Status | Catatan |
| --- | --- | --- |
| Android package identity | PASS | `applicationId` dan namespace sudah `id.tapgo.membership`. |
| App name | PASS | Manifest label `TapGo`. |
| Version | PASS | `1.0.0+1`; siap initial upload, naikkan untuk release berikutnya. |
| SDK target | PASS | Flutter 3.44 default: compileSdk 36, targetSdk 36, minSdk 24. |
| Release signing | REVIEW REQUIRED | Release fallback ke debug jika `android/key.properties` tidak ada. Untuk Play final wajib upload keystore/release signing valid. |
| Launcher/adaptive icon | PASS | Launcher icon dan adaptive icon tersedia. |
| Manifest permissions | REVIEW REQUIRED | `INTERNET` OK; `CAMERA`, `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE` perlu justifikasi Data Safety karena image picker KTP/selfie masih dipakai. |
| Cleartext traffic | PASS | Tidak ada `usesCleartextTraffic=true`. |
| Deep link | PASS/NOT USED | Tidak ada deep link app intent; tidak wajib untuk release. |
| Production API base URL | PASS | Production mode memaksa `https://api.tapgolion.id`. |
| Old tunnel/local URL | PASS | Tidak ditemukan `localhost`, `127.0.0.1`, `10.0.2.2`, `trycloudflare`, atau `ngrok` di mobile app. |
| Mobile secrets | PASS | Tidak ditemukan Midtrans server key/client key hardcoded di mobile source. |
| Debug logging | REVIEW REQUIRED | Ada banyak `debugPrint` response auth/wallet; sebaiknya dimatikan untuk release walau password sudah dimask. |
| Test credentials hardcoded | PASS | Tidak ditemukan `Admin123`, `User123`, atau nomor UAT credential di mobile source. |
| Flutter analyze/test | PASS | `flutter analyze` dan `flutter test` berhasil. |
| Store assets | PARTIAL PASS | Feature graphic valid; 5 screenshot final ada, 4 screenshot final admin/PPOB masih belum ada. |
| Legal compliance | PASS WITH REVIEW | Privacy Policy, Terms, Delete Account page tersedia; Data Safety/App Content tetap harus diisi di Play Console. |
| Midtrans/payment readiness | WAITING | Payment channel Midtrans masih menunggu jawaban, sehingga AAB final sebaiknya menunggu channel aktif/flow pembayaran jelas. |

## 1. Android / Flutter Configuration Audit

| Item | Status | Evidence | Risk / Action |
| --- | --- | --- | --- |
| applicationId / package name | PASS | `apps/user_app/android/app/build.gradle.kts`: `applicationId = "id.tapgo.membership"` | Pastikan package name ini final karena Play package name tidak bisa diganti setelah publish. |
| namespace | PASS | `namespace = "id.tapgo.membership"` | Sesuai package. |
| app name | PASS | `AndroidManifest.xml`: `android:label="TapGo"` | OK. |
| versionCode | PASS | `pubspec.yaml`: `version: 1.0.0+1`; `local.properties`: `flutter.versionCode=1` | OK untuk upload pertama. Naikkan setiap release berikutnya. |
| versionName | PASS | `1.0.0` | OK. |
| minSdk | PASS | Flutter SDK default `minSdkVersion = 24` | OK untuk modern Android support. |
| targetSdk | PASS | Flutter SDK default `targetSdkVersion = 36` | Memenuhi requirement Google Play API 35+. |
| compileSdk | PASS | Flutter SDK default `compileSdkVersion = 36` | OK. |
| signing config | REVIEW REQUIRED | `release` memakai `key.properties` jika ada, fallback ke debug jika tidak ada | Wajib pastikan `apps/user_app/android/key.properties` ada di build machine final dan mengarah ke upload keystore. Jangan upload AAB signed debug. |
| keystore config | REVIEW REQUIRED | `key.properties.example` ada; `key.properties` tidak ditemukan di workspace | Buat/siapkan upload keystore sebelum final AAB. |
| launcher icon | PASS | `mipmap-* / ic_launcher.png` tersedia | OK. |
| adaptive icon | PASS | `mipmap-anydpi-v26/ic_launcher.xml` + foreground tersedia | OK. |
| internet permission | PASS | `android.permission.INTERNET` | Wajib untuk API. |
| network state permission | PASS | `ACCESS_NETWORK_STATE` | Wajar untuk network check. |
| camera/media/storage permissions | REVIEW REQUIRED | `CAMERA`, `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE maxSdk 32` | Masih dipakai image picker untuk KTP/selfie membership. Harus dideklarasikan pada Data Safety jika data dikirim/disimpan. |
| cleartext traffic | PASS | Tidak ditemukan `usesCleartextTraffic=true` | OK. |
| deep link | PASS/NOT USED | Manifest hanya launcher intent | Tidak ada deep link yang perlu diverifikasi. |

## 2. Release Security Audit

| Item | Status | Evidence | Risk / Action |
| --- | --- | --- | --- |
| Debug banner | PASS | `debugShowCheckedModeBanner: false` | OK. |
| Production API | PASS | `TAPGO_API_BASE_URL` default `https://api.tapgolion.id/api/v1`; production mode reset server override dan set `_productionApiRootUrl` | OK. |
| Local/tunnel URL | PASS | `rg` tidak menemukan localhost/127/10.0.2.2/trycloudflare/ngrok di mobile source | OK. |
| Server config override in production | PASS | `_prepareProductionFinalSync()` reset saved server config; production set base URL ke `https://api.tapgolion.id` | OK. |
| Midtrans server key in app | PASS | Tidak ditemukan `MIDTRANS_SERVER_KEY` atau secret key di mobile source | OK. |
| Midtrans client key in app | PASS | Tidak ditemukan hardcoded client key di mobile source | OK. |
| Test credential hardcoded | PASS | Tidak ditemukan `Admin123`, `User123`, `08000000000x` di mobile source | OK. |
| Sensitive logs | REVIEW REQUIRED | `tapgo_api_client.dart` masih `debugPrint` login/register/wallet response body | Rekomendasi: sebelum AAB final, gate logging dengan `kDebugMode`/non-production agar token/user data tidak muncul di release logs. |
| Demo/local data fallback | REVIEW REQUIRED | Source masih memiliki model bernama `Demo*` dan widget test mode; banyak screen mengambil API lalu fallback empty/local structures | Perlu final QA manual memastikan production build tidak menampilkan dummy jika API gagal. |

## 3. Google Play Compliance Audit

| Item | Status | Evidence | Action |
| --- | --- | --- | --- |
| Privacy Policy URL | PASS | `https://tapgolion.id/privacy-policy`; page exists in `apps/landing-page/src/app/privacy-policy/page.tsx`; docs in `docs/PRIVACY_POLICY.md` | Pastikan sudah live dan accessible tanpa login. |
| Terms URL | PASS | `https://tapgolion.id/terms-and-conditions`; page exists; docs in `docs/TERMS_AND_CONDITIONS.md` | Pastikan sudah live. |
| Delete account page | PASS | `apps/landing-page/src/app/delete-account/page.tsx` exists; includes web request form route | Pastikan URL final di Play Console mengarah ke `https://tapgolion.id/delete-account` atau path live setara. |
| In-app delete account instruction | PASS WITH REVIEW | Existing app menu pernah dibuat; source route `DeleteAccountRequestScreen` referenced | Manual QA perlu pastikan reachable dari APK final. |
| Data Safety draft | REVIEW REQUIRED | Listing/privacy docs identify data types, but Play Console form not visible locally | Isi Data Safety sesuai data: name, phone, user ID, membership, transaction, wallet/PPOB, bank account, photos/docs if KTP/selfie, diagnostics/notifications if enabled. |
| App content checklist | REVIEW REQUIRED | Needs Play Console completion | Complete: Data Safety, Target audience, Ads, Financial features, News, Government apps, Health, Data deletion. |
| Target audience | PASS RECOMMENDATION | Membership/financial app | Target: adults/general users, not children. Avoid Families policy. |
| Ads declaration | REVIEW REQUIRED | No ad SDK found in source | Declare “No ads” if no ads are served. |
| Financial features declaration | REVIEW REQUIRED | App has wallet-like balance, membership payment, withdrawal, PPOB benefit | Complete Play Console financial features declaration truthfully; avoid investment/guaranteed income wording. |
| Payment disclosure | PASS WITH MIDTRANS BLOCKER | Store listing states payment via Midtrans; Midtrans channel still waiting | Do not submit production payment flow until channel issue is resolved or reviewer notes explain sandbox/pending state. |
| Account deletion instruction | PASS | Privacy Policy and Delete Account page include contact and process | OK. |

## 4. Store Assets Audit

| Asset | Status | Evidence | Action |
| --- | --- | --- | --- |
| Feature graphic | PASS | `google-play-assets/feature-graphic-1024x500.png`: 1024 x 500 | Ready. |
| Feature graphic preview | PASS | `feature-graphic-preview.png`: 1024 x 500 | Ready. |
| App icon | PASS | Android launcher/adaptive icon resources exist | Verify in Play preview after upload. |
| Screenshot 01 Dashboard User | PASS | `google-play-assets/screenshots/final/01-dashboard-user.png`: 1080 x 1920 | Ready. |
| Screenshot 02 Membership Package | PASS | 1080 x 1920 | Ready. |
| Screenshot 03 Membership Checkout | PASS | 1080 x 1920 | Ready. |
| Screenshot 04 Wallet TapGoPay | PASS | 1080 x 1920 | Ready. |
| Screenshot 05 Referral Network | PASS | 1080 x 1920 | Ready. |
| Screenshot 06 PPOB Benefit | MISSING FINAL | Template exists only | Capture final screenshot if needed for store. |
| Screenshot 07 Admin Dashboard | MISSING FINAL | Template exists only | Optional for public listing; only use if no sensitive admin data. |
| Screenshot 08 Financial Report | MISSING FINAL | Template exists only | Optional; avoid exposing financial/admin data. |
| Screenshot 09 Super Admin Dashboard | MISSING FINAL | Template exists only | Optional; avoid exposing sensitive admin data. |
| Short description | PASS | 56/80 chars | Safe wording. |
| Full description | PASS | Avoids prohibited wording; states no fixed result | OK. |
| Contact email | PASS | `support@tapgolion.id` | OK. |
| Website | PASS | `https://tapgolion.id` | OK. |

## 5. Validation Results

| Command | Result | Notes |
| --- | --- | --- |
| `flutter analyze` | PASS | No issues found. |
| `flutter test` | PASS | 7 widget tests passed. |
| Backend build | NOT RUN | Not needed for AAB release audit; no backend code changed in this task. |
| AAB build | NOT RUN | Explicitly not run per instruction. |

Flutter toolchain:

```text
Flutter 3.44.0 stable
Dart 3.12.0
```

## Risks Found

| Priority | Risk | File / Area | Recommendation |
| --- | --- | --- | --- |
| P1 | Release build may be signed with debug key if `key.properties` is missing | `apps/user_app/android/app/build.gradle.kts` | Before final AAB, require release keystore and fail build if missing for production release. |
| P1 | Midtrans payment channel not active yet | Payment readiness | Wait for Midtrans channel activation or document reviewer flow clearly before production release. |
| P1 | Production logs may include auth/wallet response body via `debugPrint` | `apps/user_app/lib/services/tapgo_api_client.dart` | Gate logs to debug/staging only before final AAB. |
| P2 | CAMERA/media/storage permissions require clear Data Safety disclosure | `AndroidManifest.xml`, `image_picker` usage | Declare photos/files/docs collection if KTP/selfie upload remains in release. |
| P2 | Final screenshot set only has 5 user-facing screenshots | `google-play-assets/screenshots/final/` | Enough for Play minimum in many cases, but recommended add PPOB/benefit final screenshot; avoid admin screenshots if sensitive. |
| P2 | Source still uses `Demo*` naming and local fallback models | `apps/user_app/lib/data`, screens/widgets | Not necessarily visible in production, but final QA should confirm no dummy data appears when API fails. |

## File Yang Harus Diperbaiki Sebelum AAB Final

Recommended before final AAB:

1. `apps/user_app/android/app/build.gradle.kts`
   - Remove debug fallback for release or make production release fail if `key.properties` is missing.

2. `apps/user_app/lib/services/tapgo_api_client.dart`
   - Disable response-body `debugPrint` in production/release.

3. `apps/user_app/android/app/src/main/AndroidManifest.xml`
   - Keep permissions only if still needed; otherwise remove unused permission.
   - If kept, make sure Data Safety declares camera/photos/files appropriately.

4. Play Console, not repo:
   - Complete Data Safety.
   - Complete account deletion form.
   - Complete financial features declaration.
   - Complete ads declaration.

## Boleh Lanjut Build AAB Final Setelah Midtrans Selesai?

Status: **BELUM FULL GO, CONDITIONAL GO SETELAH P1 DITUTUP.**

TapGo boleh lanjut build AAB final setelah:

1. Midtrans payment channel aktif atau ada keputusan release strategy yang jelas.
2. Release keystore tersedia dan release build tidak fallback ke debug signing.
3. Production debug logging response body dimatikan.
4. Play Console Data Safety dan financial declarations siap.

Jika hanya untuk internal/closed testing Play Console, kondisi saat ini cukup kuat. Untuk production public listing, P1 di atas sebaiknya ditutup dulu.

## Checklist Terakhir Sebelum Upload Play Console

- [ ] Midtrans payment channel aktif dan payment flow tidak berhenti di “No payment channels available”.
- [ ] `key.properties` release tersedia di build machine.
- [ ] AAB ditandatangani upload key/release key, bukan debug key.
- [ ] Build command final memakai:

```bash
flutter build appbundle --release --dart-define=TAPGO_APP_MODE=production --dart-define=TAPGO_API_BASE_URL=https://api.tapgolion.id
```

- [ ] Verifikasi AAB tidak mengandung localhost/tunnel URL.
- [ ] Verifikasi no Midtrans server key di mobile artifact.
- [ ] Debug response body logs dimatikan untuk production.
- [ ] Privacy Policy URL live.
- [ ] Terms URL live.
- [ ] Delete Account URL live.
- [ ] Data Safety completed and consistent with privacy policy.
- [ ] Financial features declaration completed.
- [ ] Ads declaration completed.
- [ ] Target audience set to non-children/adult/general.
- [ ] Feature graphic uploaded.
- [ ] At least 5 final screenshots uploaded.
- [ ] Reviewer notes include test account if required.

## Readiness Score

| Area | Score |
| --- | ---: |
| Android configuration | 82% |
| Release security | 78% |
| Google Play compliance | 80% |
| Store assets | 86% |
| Payment readiness | 55% |
| Overall readiness | 78% |

Final recommendation: **LAYAK untuk closed/internal testing preparation; belum disarankan upload production public sampai Midtrans channel, release signing, and production logging are closed.**
