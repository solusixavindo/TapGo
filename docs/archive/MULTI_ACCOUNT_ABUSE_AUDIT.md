# Multi-Account / Device Abuse Audit

Tanggal audit: 16 Juni 2026

Scope: audit security dan anti-abuse produksi TapGo, terutama risiko 1 HP / 1 device membuat banyak akun untuk menyalahgunakan bonus registrasi, referral, wallet, dan komisi.

Tidak dilakukan: deploy, build APK/AAB, migration, cleanup execute, atau perubahan production DB.

## Ringkasan

Status: **WARNING**

Sistem sudah punya beberapa guard kuat:

- `users.phone` unique.
- `users.email` unique jika email diisi.
- `users.referralCode` unique.
- Referral direct hanya 1 per user.
- Self-referral dan circular referral diblokir di endpoint referral claim.
- Sponsor bonus tidak dibayar saat register, hanya saat membership paid/approved.
- Basic registration benefit masuk PPOB, bukan cash withdrawable.

Namun ada gap P1:

- Belum ada device fingerprint/device binding saat register.
- Sebelum patch audit ini, nomor HP dapat tersimpan/dicari sebagai format berbeda (`0812`, `62812`, `+62812`) sehingga berpotensi menjadi akun berbeda jika data historis campur.
- Belum ada abuse flags/registration events untuk deteksi 1 device/IP membuat banyak akun.
- Bonus Basic PPOB masih diberikan per user baru, bukan per device/identity/KYC.

## Audit Checklist

| Risiko | Status | Evidence | Catatan |
| --- | --- | --- | --- |
| 1 nomor HP membuat banyak akun | PASS setelah patch | `apps/backend/prisma/schema.prisma:195` unique phone; `phoneLookupVariants` dipakai di repository | Patch menutup variasi format phone untuk lookup/register. |
| 1 email membuat banyak akun | PASS | `apps/backend/prisma/schema.prisma:194` unique email | Email optional, jadi bukan anti-abuse utama. |
| 1 device membuat banyak akun | WARNING | Tidak ada device id di register user/session | `PushToken.deviceId` ada, tapi bukan registration guard. Butuh schema/flow baru. |
| 1 user membuat akun baru berulang untuk Basic PPOB | WARNING | Tidak ada device/KYC/identity limit | Bisa dengan nomor HP berbeda. |
| User membuat akun referral sendiri | WARNING | Self-referral akun yang sama diblokir; multi-account self-referral belum bisa dibuktikan tanpa device/KYC | Butuh device/KYC/risk scoring. |
| Dummy berantai untuk sponsor/level | PARTIAL | Bonus hanya setelah paid membership, bukan register | Tetap bisa terjadi jika pelaku membayar/menyalahgunakan payment. |
| Referral self-loop | PASS | `ReferralService.ts:22` sampai `24` | Endpoint claim blokir sponsor.id === user.id. |
| Referral cycle | PASS | `ReferralService.ts:31` sampai `34` | Cek existing path user -> sponsor. |
| Phone `0812`/`62812`/`+62812` | PASS setelah patch | `apps/backend/src/core/security/phone.ts` dan validator auth | Lookup tetap backward-compatible. |
| Rate limit register/login | PASS basic | `authRateLimiter` 20/15 menit di auth routes | Belum phone-specific. |
| IP rate limit global | PASS basic | `apiRateLimiter` 120/menit | Belum risk scoring. |
| Register bonus hanya 1x per phone/device | PARTIAL | 1x per user/phone normalized; belum device | Butuh migration/device fingerprint. |
| Sponsor bonus hanya event valid | PASS | `MembershipOrderService` posting dari payment success | Register tidak membayar sponsor. |

## Patch Aman yang Dibuat

1. Menambahkan `apps/backend/src/core/security/phone.ts`
   - `normalizePhoneNumber()`
   - `phoneLookupVariants()`

2. Update `apps/backend/src/modules/auth/presentation/auth.validators.ts`
   - Register/login/OTP sekarang menormalisasi phone.

3. Update `apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts`
   - Lookup user by phone mengecek variasi canonical, `62`, dan `+62`.
   - Tujuan: mencegah duplikat baru tanpa mengunci akun lama yang mungkin tersimpan dengan format lama.

4. Tambah unit test `apps/backend/tests/auth/authValidators.test.ts`
   - Validasi format `0812`, `62812`, `+62812`.
   - Validasi lookup variant backward compatibility.

## Risiko Multi-Account yang Masih Ada

| Risiko | Level | Alasan |
| --- | --- | --- |
| 1 device membuat banyak akun dengan nomor berbeda | P1 | Belum ada device fingerprint hash di register/session risk. |
| Bonus Basic PPOB diklaim banyak akun dari device sama | P1 | Normalisasi phone tidak cukup untuk mencegah multi nomor. |
| Self-referral lintas akun milik orang yang sama | P1 | Tidak bisa dibuktikan tanpa device/KYC/payment identity. |
| Referral farm berbayar | P1/P2 | Bonus paid-only mengurangi risiko, tetapi pola farm tetap perlu monitoring. |

## Rekomendasi

Closed Testing: **aman lanjut dengan monitoring**.

Public Launch: **perlu minimal Level 2 anti-abuse** sebelum traffic besar:

- Simpan `device_fingerprint_hash`.
- Simpan `registration_events`.
- Buat `abuse_flags`.
- Hold withdrawal untuk akun baru/berisiko.
- KYC/OTP lebih kuat untuk withdrawal.

