# TapGo Business Engine Test Report

Tanggal: 2026-06-09

Scope: laporan test planning dan expected-vs-current hasil audit source untuk aturan final TapGo.

Catatan:

- Test di file ini belum menggantikan automated test.
- Tidak ada kode engine yang diubah pada tahap ini.
- Kolom "Actual Saat Ini" adalah hasil audit source code, bukan hasil run database production.

## Summary

| Case | Expected Final | Actual Saat Ini | Status |
|---|---|---|---|
| CASE 1 Basic sponsor Silver | Sponsor Basic mendapat Rp2.000 saat B upgrade Silver PAID+APPROVED | Sponsor Basic saat ini bisa mendapat Rp2.000 saat B register referral; saat B upgrade Silver engine non-Basic order memberi 8% tanpa cek tier sponsor Basic | NOT MATCH |
| CASE 2 Silver sponsor Silver | Sponsor Silver mendapat 8% x Rp500.000 = Rp40.000 | Payment success non-Basic memberi 8% dari package price | MATCH |
| CASE 3 Level Bonus Silver L1 | Silver upline mendapat L1 8%, max level 3 | Rate L1 8% ada, tetapi eligibility berdasarkan directSponsorCount, bukan tier Silver | PARTIAL MATCH |
| CASE 4 Auto Upgrade Gold | Silver dengan 5 direct Silver aktif auto Gold | Logic auto upgrade tidak ditemukan | NOT MATCH |
| CASE 5 Auto Upgrade Platinum | Silver dengan 10 direct Silver aktif auto Platinum | Logic auto upgrade tidak ditemukan | NOT MATCH |
| CASE 6 Reward 10 Silver | Silver dengan 10 direct Silver aktif mendapat Rp500.000 | Saat ini reward Rp500.000 untuk Platinum dengan 10 direct sponsor | NOT MATCH |
| CASE 7 Profit Sharing | 60% net profit, pool 30/20/10 untuk Silver qualified/Gold/Platinum | Struktur period/distribution ada, tetapi distribute equal split semua active members | NOT MATCH |

## Detail Test Wajib

### CASE 1 - Basic Sponsor Silver

Expected:

- A register sebagai Basic.
- B register memakai referral A.
- B upgrade Silver.
- B order status PAID + APPROVED.
- A masih Basic.
- A mendapat `SPONSOR_BONUS` atau equivalent wallet ledger Rp2.000.
- Bonus tidak diberikan saat B register.
- Bonus tidak diberikan saat order pending/failed/expired/cancelled.

Actual saat ini:

- Register referral membuat referral relation.
- Register referral juga memberi `BASIC_SPONSOR_BONUS` Rp2.000 untuk sponsor jika masih first 1.000 user.
- Saat B upgrade Silver, `creditSponsorBonus` menghitung non-Basic package dengan 8% dari price tanpa membaca tier sponsor.

Status: **NOT MATCH**.

File terkait:

- `apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts`
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts`

Automated test yang harus dibuat:

- Assert tidak ada sponsor bonus setelah register referral.
- Assert A mendapat Rp2.000 setelah B Silver PAID+APPROVED jika A Basic.

### CASE 2 - Silver Sponsor Silver

Expected:

- A Silver sponsor B.
- B upgrade Silver Rp500.000 PAID+APPROVED.
- A mendapat 8% = Rp40.000.
- Wallet transaction dan commission history tercatat.

Actual saat ini:

- Untuk order Silver/Gold/Platinum, `creditSponsorBonus` menghitung `packagePrice.mul(8).div(100)`.
- Existing tests juga mengharapkan Rp40.000 untuk Silver.

Status: **MATCH**.

Catatan:

- Perlu tambahan assertion bahwa sponsor harus benar-benar Silver/Gold/Platinum untuk 8%, dan Basic hanya Rp2.000.

### CASE 3 - Level Bonus Silver L1

Expected:

- A Silver sebagai upline level 1.
- Downline melakukan upgrade Silver/Gold/Platinum PAID+APPROVED.
- A mendapat 8%.
- Silver hanya dapat level 1-3.

Actual saat ini:

- Rate L1 8% tersedia.
- Tetapi `creditLevelBonuses` tidak membatasi berdasarkan tier upline Silver.
- Eligibility memakai `resolveUnlockedLevel(directSponsorCount)` dengan threshold 3/5/10 direct sponsor.

Status: **PARTIAL MATCH**.

Automated test yang harus dibuat:

- Silver dengan 0 direct sponsor tetap dapat level 1 jika upline langsung.
- Silver tidak mendapat level 4.
- Basic tidak mendapat level bonus.

### CASE 4 - Auto Upgrade Gold

Expected:

- A Silver.
- A memiliki 5 direct sponsor yang sudah Silver aktif.
- A otomatis menjadi Gold.
- Perubahan tier tercatat dengan metadata/audit.

Actual saat ini:

- Tidak ditemukan logic auto upgrade Gold berdasarkan direct active Silver.

Status: **NOT MATCH**.

Automated test yang harus dibuat:

- Buat A Silver.
- Buat 5 direct downline A.
- Aktifkan semua downline menjadi Silver PAID+APPROVED.
- Assert active membership A berubah Gold.

### CASE 5 - Auto Upgrade Platinum

Expected:

- A Silver.
- A memiliki 10 direct sponsor yang sudah Silver aktif.
- A otomatis menjadi Platinum.
- Perubahan tier tercatat dengan metadata/audit.

Actual saat ini:

- Tidak ditemukan logic auto upgrade Platinum berdasarkan direct active Silver.

Status: **NOT MATCH**.

Automated test yang harus dibuat:

- Buat A Silver.
- Buat 10 direct downline A.
- Aktifkan semua downline menjadi Silver PAID+APPROVED.
- Assert active membership A berubah Platinum.

### CASE 6 - Reward 10 Silver

Expected:

- A Silver.
- A punya 10 direct Silver aktif.
- Reward Rp500.000 dibuat sekali.
- Reward punya ledger/status sesuai arsitektur.

Actual saat ini:

- Reward Rp500.000 hanya diberikan jika user Platinum punya 10 direct sponsor.
- Tidak ada thresholds 100/1.000/10.000/100.000.
- Tidak ada dedicated reward lifecycle pending/approved/paid/rejected.

Status: **NOT MATCH**.

Automated test yang harus dibuat:

- Silver 9 direct Silver: no reward.
- Silver 10 direct Silver: reward Rp500.000 once.
- Silver 100 direct Silver: reward Rp5.000.000 once.
- Reward duplicate prevention per threshold.

### CASE 7 - Profit Sharing

Expected:

- Super Admin input net profit bulanan.
- Pool = 60% net profit.
- Silver pool = 30% pool dibagi rata untuk Silver qualified >=3 direct Silver.
- Gold pool = 20% pool dibagi rata untuk all Gold active.
- Platinum pool = 10% pool dibagi rata untuk all Platinum active.

Actual saat ini:

- `ProfitSharingPeriod.totalPoolAmount` ada.
- `distribute` mengambil semua `userMembership` ACTIVE distinct user.
- Amount dibagi rata ke semua active members tanpa tier qualification.

Status: **NOT MATCH**.

Automated test yang harus dibuat:

- Net profit Rp100.000.000.
- Pool Rp60.000.000.
- Silver allocation Rp18.000.000 untuk qualified Silver only.
- Gold allocation Rp12.000.000 untuk Gold active.
- Platinum allocation Rp6.000.000 untuk Platinum active.
- Non-qualified Silver tidak menerima.
- Duplicate distribution blocked.

## Test Tambahan yang Wajib Ada Sebelum Production

| Test | Tujuan |
|---|---|
| Pending payment no bonus | Pastikan order PENDING tidak memicu sponsor/level/reward/PPOB |
| Failed payment no bonus | Pastikan FAILED/EXPIRED/CANCELLED tidak memicu payout |
| Basic PPOB first 1.000 | User 1-1.000 mendapat PPOB Rp5.000 |
| Basic PPOB after 1.000 | User ke-1001 tidak mendapat PPOB |
| Wallet ledger reconciliation | Sum ledger sama dengan balance per user |
| Sponsor vs Level 1 decision | Pastikan tidak double payout jika bisnis memutuskan sponsor bonus menggantikan level 1 |
| Reward threshold duplicate | Threshold reward tidak dibayar dua kali |
| Profit sharing duplicate | Period tidak bisa didistribusikan dua kali |

## Command Test yang Disarankan Setelah Implementasi

```bash
npm --workspace apps/backend run build
npm --workspace apps/backend run test
npx prisma validate
npx prisma generate
flutter analyze
flutter test
flutter build apk --release --dart-define=TAPGO_APP_MODE=production --dart-define=TAPGO_API_BASE_URL=https://api.tapgolion.id
```

## Status Tahap Ini

Tahap ini belum menjalankan alignment implementation. Karena itu APK baru belum dibuat dari laporan audit ini.

APK `TapGo-UAT-business-engine-alignment.apk` sebaiknya dibuat setelah:

1. P1 engine alignment selesai.
2. Automated test final rules lulus.
3. Migration/data migration strategy disetujui.
4. UAT wallet/PPOB/referral/reward/profit sharing diverifikasi.
