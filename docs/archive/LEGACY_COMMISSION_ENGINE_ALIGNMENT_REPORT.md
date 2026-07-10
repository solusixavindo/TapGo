# Legacy Commission Engine Alignment Report

Tanggal: 16 Juni 2026

## 1. File Legacy yang Ditemukan

- `apps/backend/src/modules/referrals/application/CommissionEngine.ts`
- `apps/backend/tests/referrals/commissionEngine.test.ts`

File terkait yang diverifikasi tidak memakai legacy engine:

- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts`
- `apps/backend/src/modules/payments/application/MidtransPaymentService.ts`
- `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts`

## 2. Apakah Masih Dipakai Production?

Status: **Tidak dipakai production source/API aktif**.

Hasil `rg` menunjukkan:

- Tidak ada import `CommissionEngine` di `apps/backend/src` selain file definisinya.
- Instansiasi `CommissionEngine` hanya ada di test legacy.
- Payment payout utama tetap lewat `MembershipOrderService`.
- Payment notification tetap lewat `MidtransPaymentService`.
- Profit sharing tetap lewat `ProfitSharingService`.

## 3. Risiko Jika Tidak Dibereskan

Sebelum patch, risiko utamanya adalah P1:

- Reward lama Platinum + 10 direct sponsor bisa dipakai ulang.
- Reward legacy tidak mengikuti lifecycle PENDING/APPROVED/PAID.
- Tidak ada guard payment status di engine legacy.
- Test lama masih memvalidasi rule reward lama.

## 4. Patch yang Dibuat

File diubah:

1. `apps/backend/src/modules/referrals/application/CommissionEngine.ts`
   - Ditandai `@deprecated`.
   - Constructor membutuhkan `{ allowLegacyUsage: true }`.
   - Tanpa opt-in, constructor throw:
     `CommissionEngine is deprecated. Use MembershipOrderService/ProfitSharingService for production payout.`
   - `calculateRewardBonus()` legacy dinonaktifkan dan selalu return `[]`.
   - `calculateProfitSharingPlaceholder()` diberi komentar deprecated.

2. `apps/backend/tests/referrals/commissionEngine.test.ts`
   - Instansiasi test memakai opt-in explicit.
   - Test baru memastikan constructor tanpa opt-in throw.
   - Test baru memastikan payment flow utama tidak mengandung `CommissionEngine`.
   - Test reward lama diubah menjadi ekspektasi reward legacy disabled.

Tidak ada perubahan pada:

- Membership payment flow.
- Referral register flow.
- Wallet ledger flow.
- Profit sharing final service.
- Prisma schema.
- Database production.
- API endpoint production.

## 5. Test yang Ditambahkan/Diubah

Ditambahkan:

- Legacy engine harus opt-in.
- Legacy engine tidak diimpor oleh `MembershipOrderService` dan `MidtransPaymentService`.
- Legacy reward payout disabled.

Diubah:

- Test reward lama tidak lagi mengharapkan Rp500.000 dari Platinum + 10 direct sponsor di legacy engine.

## 6. Validasi Build/Test

| Command | Result | Catatan |
| --- | --- | --- |
| `npm --workspace apps/backend run build` | PASS | TypeScript backend build sukses. |
| `npm --workspace apps/backend run test` | PASS dengan WARNING | 8 unit tests legacy berjalan PASS; 88 integration tests skipped karena integration DB lokal tidak aktif. |
| `DATABASE_URL=postgresql://tapgo:tapgo@localhost:5433/tapgo_test npx prisma validate --schema apps/backend/prisma/schema.prisma` | PASS | Prisma schema valid. |

Catatan: integration test skipped tidak dianggap bukti runtime integration penuh. Patch ini hanya menyentuh legacy unit path dan tidak mengubah schema/production flow.

## 7. Rekomendasi Sebelum Public Launch

1. Pertahankan `CommissionEngine` sebagai deprecated guard sampai semua referensi historis dipastikan aman.
2. Setelah public launch stabil, pertimbangkan menghapus file legacy dan test legacy dalam refactor terpisah.
3. Jika masih butuh engine kalkulasi komisi murni, buat service baru yang sumber kebenarannya sama dengan `MembershipOrderService`, bukan menghidupkan file legacy.
4. Jalankan integration test dengan DB test aktif sebelum public launch penuh.

## 8. Konfirmasi Safety

- Tidak ada deploy.
- Tidak ada migration.
- Tidak ada production DB change.
- Tidak ada build APK/AAB.
- Tidak ada perubahan flow utama payment/membership/referral.
