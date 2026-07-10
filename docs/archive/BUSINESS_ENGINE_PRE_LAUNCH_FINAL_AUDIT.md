# Business Engine Pre-Launch Final Audit

Tanggal audit: 16 Juni 2026

Scope: audit read-only business engine TapGo sebelum launch. Tidak ada deploy, tidak ada migration, tidak ada cleanup execute, tidak ada perubahan production DB, tidak ada build APK/AAB.

## Executive Summary

Status keseluruhan: **LAYAK CLOSED TESTING / WARNING UNTUK PUBLIC LAUNCH**

Business engine utama TapGo sudah berjalan pada jalur yang benar:

- Membership package dan order flow real database.
- Basic registration PPOB Rp5.000 untuk 1.000 user pertama masuk PPOB, bukan cash.
- Sponsor bonus hanya diposting saat membership paid/approved.
- Basic sponsor Rp2.000, non-Basic sponsor 8%.
- Level bonus mengikuti tier Silver/Gold/Platinum.
- Wallet cash dan PPOB sudah terpisah.
- Withdrawal memakai cashBalance.
- Reward final threshold dibuat PENDING dan membutuhkan admin lifecycle.
- Profit sharing memakai formula final 60% net profit dan 30/20/10.
- Admin/Super Admin endpoint utama dilindungi role guard.

Tidak ditemukan P0 dari jalur source utama. Ada beberapa P1 yang perlu dibereskan atau dipastikan lewat SOP sebelum public launch.

## Status Per Modul

| Modul | Status | Risiko | Prioritas |
| --- | --- | --- | --- |
| Membership Package | PASS dengan WARNING | Seed/demo lama bisa membingungkan jika dijalankan di production | P2 |
| Membership Payment Flow | PASS dengan WARNING | Midtrans channel belum aktif; SOP manual approval harus ketat | P1 |
| Referral Genealogy | PASS | Genealogy tersimpan direct + closure level | P2 |
| Sponsor Bonus | PASS | Tidak dibayar saat register; paid membership only | P2 |
| Level Bonus | PASS | Tier cap dan rate sesuai final | P2 |
| Wallet Cash vs PPOB | PASS dengan WARNING | Ledger `REGISTRATION_BONUS` kini PPOB, wording perlu dijaga | P1 |
| Withdrawal | PASS | Hanya cash, reject refund idempotent | P2 |
| Reward Engine | PASS dengan WARNING | Engine legacy masih punya reward lama | P1 |
| Profit Sharing | PASS dengan WARNING | Butuh SOP payout dan reversal manual | P1 |
| Admin/Super Admin Controls | PASS dengan WARNING | Reward paid perlu keputusan apakah ADMIN boleh atau SUPER_ADMIN saja | P1/P2 |
| Production Data Snapshot | WARNING | Belum diambil dari workstation ini | P1 |

## Temuan P0

Tidak ada P0 dari source audit.

## Temuan P1

1. **Engine legacy reward masih ada**
   - File: `apps/backend/src/modules/referrals/application/CommissionEngine.ts:126` sampai `148`
   - Dampak: rule lama Platinum + 10 direct sponsor dapat dipakai ulang secara keliru.
   - Rekomendasi: tandai legacy, selaraskan dengan `MembershipOrderService`, atau hapus setelah memastikan tidak ada import runtime.

2. **Production data snapshot belum dibuktikan di workstation ini**
   - Dampak: sebelum public launch, masih perlu bukti saldo, pending invoice/order, test users, dan ledger production bersih.
   - Rekomendasi: jalankan dry-run cleanup/snapshot read-only di VPS dan simpan hasilnya.

3. **Reward/profit sharing payout butuh SOP ketat**
   - Dampak: fitur finansial bisa menciptakan kewajiban cash.
   - Rekomendasi: reward paid/profit sharing distribute hanya dilakukan setelah approval owner/Super Admin dan bukti pendukung.

4. **Midtrans channel belum aktif**
   - Dampak: checkout real belum bisa selesai walau Snap endpoint sudah berhasil.
   - Rekomendasi: tunggu aktivasi channel dan retest payment page sebelum public user acquisition.

5. **Wording ledger Basic Rp5.000**
   - Dampak: `REGISTRATION_BONUS` secara saldo masuk PPOB, tetapi nama bisa disalahpahami sebagai cash bonus.
   - Rekomendasi: report/UI harus menyebut “PPOB registrasi Basic Rp5.000”.

## Temuan P2

- Seed/demo lama berisi benefit merchandise lama.
- `DEVELOPMENT_PLACEHOLDER` pada payment pending bisa membingungkan report.
- Role/app settings Super Admin masih 501, aman tapi belum operational.
- Auto-upgrade tidak otomatis memberi PPOB benefit paket baru; perlu keputusan bisnis tertulis.

## Closed Testing Recommendation

Rekomendasi: **GO untuk Closed Testing terbatas**

Syarat:

- Gunakan akun UAT dan data terkendali.
- Jangan cleanup execute tanpa allowlist owner.
- Jangan gunakan fitur payout reward/profit sharing sebagai payout real massal.
- Payment Midtrans masih perlu dites ulang setelah channel aktif.

## Public Launch Recommendation

Rekomendasi: **NO-GO untuk public launch penuh sampai P1 operasional selesai**

Wajib sebelum public launch:

1. Snapshot data production read-only PASS.
2. Midtrans channel aktif dan payment success sandbox/production UAT PASS.
3. SOP reward/profit sharing/withdrawal payout disetujui.
4. Engine legacy reward diselaraskan atau diberi guard agar tidak dipakai.
5. Data test lama dibersihkan hanya dengan cleanup confirmed allowlist.

## Rekomendasi Sebelum Dummy Cleanup

1. Backup DB production.
2. Jalankan cleanup dry-run terbaru.
3. Owner konfirmasi user IDs yang boleh diproses.
4. Pastikan user tersebut tidak memiliki paid/posted/approved financial ledger yang harus dipertahankan.
5. Execute cleanup hanya dengan:

```bash
TAPGO_CLEANUP_CONFIRM=YES TAPGO_CLEANUP_USER_IDS="id1,id2" npm --workspace apps/backend run cleanup:prelaunch -- --execute
```

## Rekomendasi Sebelum Public Launch

1. Retest Midtrans setelah payment channel aktif.
2. Jalankan production smoke test role User/Admin/Super Admin.
3. Jalankan wallet reconciliation production read-only.
4. Pastikan privacy policy, terms, delete account, dan contact page public.
5. Pastikan Play Console Data Safety sesuai permission dan data collected.

## Readiness Score

| Area | Score |
| --- | ---: |
| Business Engine Core | 88% |
| Financial Engine | 84% |
| Admin Controls | 82% |
| Payment Readiness | 68% |
| Production Data Hygiene | 70% |
| Closed Testing Readiness | 86% |
| Public Launch Readiness | 76% |

## Local Validation Result

| Command | Result | Catatan |
| --- | --- | --- |
| `npm --workspace apps/backend run build` | PASS | TypeScript backend build sukses. |
| `DATABASE_URL=postgresql://tapgo:tapgo@localhost:5433/tapgo_test npx prisma validate --schema apps/backend/prisma/schema.prisma` | PASS | Prisma schema valid. |
| `npm --workspace apps/backend run test` | PASS dengan WARNING | Vitest exit code 0, tetapi hanya 6 unit tests berjalan dan 88 integration tests skipped karena environment integration DB tidak aktif di workstation ini. |

Validation warning: hasil source audit tetap valid, tetapi bukti runtime integration penuh harus mengacu pada hasil environment test/VPS sebelumnya atau dijalankan ulang dengan test database aktif sebelum public launch.

## Final Decision

**LAYAK CLOSED TESTING LANJUTAN. BELUM DISARANKAN PUBLIC LAUNCH PENUH.**

Alasannya bukan karena engine core gagal, melainkan karena ada P1 operasional: Midtrans channel, snapshot/cleanup data production, SOP payout reward/profit sharing, dan legacy engine cleanup.
