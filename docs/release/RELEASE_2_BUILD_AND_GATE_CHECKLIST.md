# Release 2 — Build & Gate Checklist

Checklist ini menjadi gate wajib sebelum AAB customer + driver di-upload ke
Play Console. Build APK/AAB dilakukan di mesin Owner (Mac); agent hanya
menyiapkan kode. Setiap item wajib dicentang dan ada bukti.

## 1. Prasyarat kode (workspace agent)

- [x] Customer `apps/user_app/pubspec.yaml` -> `version: 2.0.0+14`
- [x] Driver `apps/driver_app/pubspec.yaml` -> `version: 1.0.0+1`
- [x] Driver `build.gradle.kts` memakai pola signing fail-closed seperti
      customer (`key.properties` + penjaga task-graph release)
- [x] Driver `key.properties.example` tersedia tanpa secret nyata
      (hanya `CHANGE_ME`)
- [x] Verifikasi ignore: `android/key.properties`, `*.keystore`, `*.jks`
      tidak masuk git di kedua app (`git check-ignore -v`)

## 2. Gate backend (sebelum build APK)

- [ ] `cd apps/backend && npx tsc --noEmit` -> 0 error
- [ ] `cd apps/backend && npx eslint .` -> 0 error
- [ ] Backend test:
      `TAPGO_TEST_DATABASE_URL="postgresql://tapgo:tapgo_password@localhost:5433/tapgo_main_test?schema=public" npx vitest run`
      -> 825/825 pass (DB postgres:5433 via docker)

## 3. Build APK debug di Mac (uji di HP Owner, sebelum AAB)

- [ ] `cd apps/user_app && flutter build apk --debug`
- [ ] `cd apps/driver_app && flutter build apk --debug`
- [ ] APK customer + driver terbentuk dan ukurannya wajar
- [ ] Penamaan jelas di Desktop, mis. `tapgo-customer-2.0.0.apk` /
      `tapgo-driver-1.0.0.apk`
- [ ] Tersalurkan ke HP (USB adb install atau kirim file)

## 4. Gate signing (sebelum AAB release)

- [ ] `android/key.properties` DISETIAP app merujuk keystore release
      yang valid (customer & driver)
- [ ] Build release customer & driver gagal dengan pesan jelas
      bila `key.properties` tidak ada (penjaga task-graph bekerja)
- [ ] Secret (keystore/password) tidak pernah masuk ke git

## 5. Build AAB + upload Play Console (oleh Owner di Mac)

- [ ] `cd apps/user_app && flutter build appbundle --release`
      -> versionCode 14, versionName 2.0.0
- [ ] `cd apps/driver_app && flutter build appbundle --release`
      -> aplikasi TERPISAH `com.xavindo.tapgo.driver`, versionCode 1,
      versionName 1.0.0 (publikasi PERDANA)
- [ ] Pre-launch Play Console bersih (0 crash/ANR bila data tersedia)
