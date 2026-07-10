# Legacy Commission Engine Audit

Tanggal audit: 16 Juni 2026

Scope: audit read-only dan patch kecil aman untuk legacy `CommissionEngine.ts`. Tidak ada deploy, tidak ada build APK/AAB, tidak ada migration, tidak ada perubahan production DB.

## Ringkasan

Status: **PASS setelah safe alignment**

`CommissionEngine.ts` adalah engine legacy di modul referral. Hasil pencarian menunjukkan file ini **tidak dipanggil oleh production source/API aktif**. Sebelum patch, file ini masih menyimpan rule reward lama `platinum.10_direct_sponsors`. Setelah patch, reward/profit sharing legacy dinonaktifkan, dan class diberi guard opt-in supaya tidak bisa menjadi jalur payout tidak sengaja.

## File/Class/Function yang Ditemukan

| File | Temuan | Status |
| --- | --- | --- |
| `apps/backend/src/modules/referrals/application/CommissionEngine.ts` | Class legacy `CommissionEngine` | Deprecated/guarded |
| `apps/backend/tests/referrals/commissionEngine.test.ts` | Test lama yang memakai legacy engine | Diubah menjadi legacy compatibility/safety test |
| `apps/backend/src/modules/memberships/application/MembershipOrderService.ts` | Engine payout utama membership/payment | Tidak mengimpor legacy engine |
| `apps/backend/src/modules/payments/application/MidtransPaymentService.ts` | Payment callback Midtrans | Tidak mengimpor legacy engine |
| `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts` | Profit sharing final | Tidak mengimpor legacy engine |

## Production Usage Audit

Hasil pencarian:

```text
rg -n "from .*CommissionEngine|new CommissionEngine|CommissionEngine\\(" apps/backend/src apps/backend/tests
```

Temuan:

- `CommissionEngine` hanya diimpor oleh `apps/backend/tests/referrals/commissionEngine.test.ts`.
- Tidak ada import atau instansiasi `CommissionEngine` di `apps/backend/src` selain definisi class itu sendiri.
- Payment flow utama berada di `MembershipOrderService` dan `MidtransPaymentService`.

Kesimpulan: **tidak dipakai production code/API aktif**.

## Rule Lama yang Berbeda

Sebelum patch:

- `calculateRewardBonus()` memberi `REWARD_BONUS` Rp500.000 untuk Platinum dengan 10 direct sponsor.
- Metadata rule lama: `platinum.10_direct_sponsors`.
- `calculateProfitSharingPlaceholder()` masih ada sebagai placeholder kosong.

Rule final saat ini:

- Reward dihitung dari direct active Silver milestone 10/100/1000/10000/100000.
- Reward dibuat sebagai `RewardTransaction` PENDING terlebih dahulu.
- Reward baru masuk wallet cash setelah admin lifecycle approve + mark paid.
- Profit sharing memakai `ProfitSharingService`, bukan placeholder legacy.

## Risiko Jika Tidak Dibereskan

| Risiko | Dampak | Prioritas |
| --- | --- | --- |
| Developer memakai ulang `CommissionEngine` karena masih export publik | Bisa menghasilkan reward lama yang salah | P1 |
| Reward langsung menjadi distribution, bukan lifecycle PENDING/APPROVED/PAID | Bisa bypass admin control | P1 |
| Engine lama tidak punya guard payment status | Bisa menghitung komisi sebelum order PAID jika dipakai keliru | P1 |
| Test lama memberi rasa aman palsu terhadap rule lama | Bisa menghambat audit bisnis final | P2 |

## Safety Alignment yang Dilakukan

1. Menambahkan komentar `@deprecated` di `CommissionEngine.ts`.
2. Menambahkan constructor guard:
   - `new CommissionEngine()` tanpa opt-in akan throw error.
   - Test legacy harus memakai `new CommissionEngine({ allowLegacyUsage: true })`.
3. Menonaktifkan `calculateRewardBonus()` legacy agar selalu return `[]`.
4. Menambahkan komentar bahwa reward final memakai `MembershipOrderService` + `RewardTransaction` lifecycle.
5. Menambahkan komentar bahwa profit sharing final memakai `ProfitSharingService`.
6. Mengubah test lama menjadi safety/compatibility test legacy.
7. Menambahkan test statis bahwa `MembershipOrderService.ts` dan `MidtransPaymentService.ts` tidak mengandung `CommissionEngine`.

## Potensi Double Commission

Setelah patch: **rendah**.

Alasan:

- Engine legacy tidak dipanggil production.
- Constructor guard membuat penggunaan tidak sengaja gagal cepat.
- Reward legacy dinonaktifkan.
- Payment flow utama tetap memakai idempotency commission unique constraint di `MembershipOrderService`.

## Potensi Komisi Sebelum Payment Valid

Setelah patch: **rendah pada flow utama**.

Alasan:

- Register hanya membuat genealogy.
- Bonus sponsor/level/PPOB/reward baru dipanggil dalam `markPaymentSuccess`.
- Midtrans success callback memanggil `markPaymentSuccess` hanya pada status success.
- Legacy engine tidak menjadi jalur payout default.

## Kesimpulan

Legacy `CommissionEngine.ts` sekarang aman sebagai compatibility artifact, bukan payout engine. Business engine utama tidak berubah.

