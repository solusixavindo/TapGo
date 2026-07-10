# TapGo Business Engine Audit

Tanggal audit: 2026-06-09

Scope audit: backend/source code lokal TapGo. Audit ini tidak mengubah business engine, database, API production, atau UI. File ini hanya laporan gap terhadap aturan bisnis final TapGo yang diberikan.

## 1. Ringkasan Status Business Engine

Status keseluruhan: **PERLU PERBAIKAN SEBELUM FINAL PRODUCTION**.

TapGo sudah memiliki fondasi engine yang cukup lengkap untuk:

- register user dan assign Basic
- referral relation dan referral level
- wallet dan wallet transaction ledger
- membership order, invoice, payment status
- aktivasi membership setelah payment success
- PPOB benefit untuk Silver/Gold/Platinum
- sponsor bonus 8% untuk order membership berbayar
- level bonus 1-10
- reward bonus tunggal
- profit sharing period/distribution
- withdrawal reserve/approve/reject/paid
- admin report dari commission/wallet/invoice

Namun beberapa aturan final terbaru **berbeda signifikan** dari engine yang saat ini ada. Gap terbesar:

- Basic registration bonus saat ini masuk ke **wallet TapGoPay**, sedangkan aturan final menyebut **PPOB Rp5.000 untuk 1.000 user pertama**.
- Basic sponsor bonus Rp2.000 saat ini diberikan saat **register dengan referral** dan juga ada jalur saat order Basic dibayar; aturan final menyebut sponsor Basic mendapat Rp2.000 saat downline berhasil **upgrade Silver/Gold/Platinum**.
- Level bonus saat ini eligibility berdasarkan jumlah direct sponsor 3/5/10, bukan berdasarkan paket upline Silver/Gold/Platinum.
- Reward saat ini hanya untuk **Platinum dengan 10 direct sponsor**, bukan untuk **Silver dengan threshold direct Silver 10/100/1.000/10.000/100.000**.
- Auto upgrade Silver ke Gold/Platinum berdasarkan direct Silver belum ditemukan.
- Profit sharing sudah ada secara struktur, tetapi masih **equal split semua active member**, belum sesuai formula 60% net profit dengan alokasi Silver 30%, Gold 20%, Platinum 10%.
- Benefit merchandise seed belum sepenuhnya sama dengan aturan final: Gold seed memakai Topi TAPGO, Platinum seed memakai Rompi TAPGO.

## 2. Tabel Aturan Final vs Implementasi Saat Ini

| Area | Aturan Final | Implementasi Saat Ini | Status | Bukti Kode |
|---|---|---|---|---|
| Basic otomatis saat register | Semua user baru otomatis Basic | User baru diset `membershipId` ke Basic jika package Basic ada | Sudah sesuai | `apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts:28`, `:47-56` |
| Basic bonus Rp5.000 | PPOB Rp5.000 untuk 1.000 user pertama | Masuk ke wallet balance dan `REGISTRATION_BONUS`, bukan PPOB | Belum sesuai | `PrismaAuthRepository.ts:29-33`, `:59-80` |
| Limit Basic 1.000 user | User ke-1001 tidak mendapat bonus | Ada check `registeredUsers < 1000` | Sebagian sesuai | `PrismaAuthRepository.ts:29-33` |
| Referral relation saat register | Sponsor/upline tersimpan | `referral` dan `referral_levels` dibuat saat referralCode valid | Sudah sesuai | `PrismaAuthRepository.ts:83-114` |
| Invalid referral | Harus jelas | Register ditolak `SPONSOR_NOT_FOUND` | Sesuai secara teknis | `PrismaAuthRepository.ts:39-44` |
| Sponsor Basic bonus | Sponsor Basic mendapat Rp2.000 saat downline upgrade paid/approved | Saat register dengan referral, sponsor mendapat Rp2.000 jika masih first 1.000; payment order Basic juga bisa memicu Rp2.000 | Belum sesuai | `PrismaAuthRepository.ts:116-161`, `MembershipOrderService.ts:491-495` |
| Sponsor Silver/Gold/Platinum | 8% dari upgrade Silver/Gold/Platinum paid/approved | Payment success memberi 8% untuk non-Basic package | Sudah sesuai sebagian | `MembershipOrderService.ts:491-495`, `:529-580` |
| Bonus hanya paid/approved | Pending/failed/cancelled tidak memicu bonus | Bonus membership dipanggil setelah invoice `PENDING -> PAID`; Midtrans terminal failed hanya set status failed | Sudah sesuai untuk membership order | `MembershipOrderService.ts:153-174`, `:276-301`; `MidtransPaymentService.ts:220-245` |
| Level bonus Basic | Basic tidak dapat level bonus | Saat pembeli Basic, level bonus return; tetapi eligibility upline tidak memblokir Basic upline secara eksplisit, hanya unlockedLevel direct sponsor | Rawan salah hitung | `MembershipOrderService.ts:615-617`, `:637-647` |
| Level bonus Silver | Silver dapat level 1-3 | Saat ini level unlock berdasarkan direct sponsor count, bukan tier Silver | Belum sesuai | `MembershipOrderService.ts:637-649`, `:739-750` |
| Level bonus Gold | Gold dapat level 1-5 | Saat ini level unlock berdasarkan direct sponsor count, bukan tier Gold | Belum sesuai | `MembershipOrderService.ts:637-649`, `:739-750` |
| Level bonus Platinum | Platinum dapat level 1-10 | Saat ini level unlock direct sponsor count, bukan tier Platinum | Belum sesuai | `MembershipOrderService.ts:637-649`, `:739-750` |
| Level rates | 8%,4%,2%,2%,2%,1%,1%,1%,1%,1% | Rates ada sesuai | Sudah sesuai | `MembershipOrderService.ts:8-19` |
| Double count sponsor/level | Tidak boleh double payout | Unique commission key dan check existing commission per trigger/type/level | Sudah sesuai secara struktur | `schema.prisma:436`, `MembershipOrderService.ts:501-516`, `:654-669` |
| Auto Gold | Silver menjadi Gold jika referral dipakai 5 member Silver | Belum ditemukan | Belum ada | Tidak ada logic auto upgrade di `MembershipOrderService`/`ReferralService` |
| Auto Platinum | Silver menjadi Platinum jika referral dipakai 10 member Silver | Belum ditemukan | Belum ada | Tidak ada logic auto upgrade di `MembershipOrderService`/`ReferralService` |
| PPOB Silver | Rp100.000 | Seed Silver `ppobBalance=100000`; payment success credit `PPOB_BENEFIT` | Sudah sesuai | `prisma/seed.ts:43-51`, `MembershipOrderService.ts:267-274`, `:414-465` |
| PPOB Gold | Rp600.000 | Seed Gold `ppobBalance=600000` | Sudah sesuai | `prisma/seed.ts:52-60` |
| PPOB Platinum | Rp1.000.000 | Seed Platinum `ppobBalance=1000000` | Sudah sesuai | `prisma/seed.ts:61-69` |
| Benefit Silver | Kaos, PPOB 100k, BPJS JKK/JKM | Seed: Kaos TAPGO, PPOB 100k, BPJS TK JKK JKM | Sesuai minor copy | `prisma/seed.ts:43-51` |
| Benefit Gold | Kaos, Jaket, Banner, PPOB 600k, BPJS JKK/JKM | Seed: Kaos TAPGO, Topi TAPGO; tidak ada Jaket/Banner | Belum sesuai | `prisma/seed.ts:52-60` |
| Benefit Platinum | Kaos, Jaket, PPOB 1jt, BPJS JKK/JKM/JHT | Seed: Kaos, Jaket, Rompi; ada tambahan Rompi | Perlu disesuaikan | `prisma/seed.ts:61-69` |
| Reward | Silver direct Silver thresholds 10/100/1k/10k/100k | Saat ini Platinum 10 direct sponsor reward Rp500.000 saja | Belum sesuai | `MembershipOrderService.ts:20-21`, `:752-835` |
| Reward status | pending/approved/paid/rejected | Menggunakan `CommissionStatus` PENDING/POSTED/REVERSED; tidak ada dedicated reward status model | Belum sesuai | `schema.prisma:127-144`, `MembershipOrderService.ts:816-833` |
| Profit sharing formula | 60% net profit; Silver qualified 30%, Gold 20%, Platinum 10% | Struktur ada, tetapi distribute equal split semua active members | Belum sesuai | `ProfitSharingService.ts:74-112` |
| Profit sharing duplicate | Tidak boleh double per period/user | Unique `periodId_userId`, check existing distribution | Sudah sesuai struktur | `schema.prisma:476`, `ProfitSharingService.ts:147-159` |
| Invoice generation | Order membuat invoice | Invoice dibuat saat order dibuat, status PENDING | Sudah sesuai | `MembershipOrderService.ts:60-80` |
| Payment success idempotency | Tidak double activate/bonus | Invoice update hanya `status=PENDING`; duplicate throws conflict | Sudah sesuai | `MembershipOrderService.ts:153-166` |
| Wallet ledger | Semua saldo tercatat ledger | Bonus/PPOB/withdraw/profit sharing membuat wallet transaction | Sebagian sesuai | `MembershipOrderService.ts:452-465`, `:529-548`, `:682-702`; `ProfitSharingService.ts:172-185`; `PrismaWalletRepository.ts:127-145` |
| Nilai uang integer rupiah | Tidak floating point | Prisma Decimal(14,2), bukan float; masih memungkinkan pecahan .xx | Rawan compliance/perhitungan | `schema.prisma:229`, `:301`, `:422`, `:626`, `:642` |

## 3. Daftar Gap/Bug

### P1 - Kritikal

1. **Basic bonus Rp5.000 masuk wallet, bukan PPOB.**
   - Aturan final: Basic mendapat PPOB Rp5.000 untuk 1.000 user pertama.
   - Kode: `PrismaAuthRepository.ts:59-80` membuat wallet balance dan `REGISTRATION_BONUS`.
   - Risiko: dashboard TapGoPay, wallet ledger, dan laporan bonus tidak sama dengan skema final benefit Basic.

2. **Basic sponsor bonus Rp2.000 saat register, bukan saat upgrade paid.**
   - Aturan final: sponsor Basic mendapat Rp2.000 saat downline berhasil upgrade Silver/Gold/Platinum.
   - Kode: `PrismaAuthRepository.ts:116-161` memberi sponsor bonus pada registrasi referral.
   - Risiko: payout terlalu cepat sebelum transaksi paid/approved; bisa membayar bonus untuk user yang tidak pernah upgrade.

3. **Level bonus eligibility masih berdasarkan jumlah direct sponsor 3/5/10, bukan paket upline.**
   - Aturan final: Basic tidak dapat; Silver level 1-3; Gold level 1-5; Platinum level 1-10.
   - Kode: `MembershipOrderService.ts:637-647`, `:739-750`.
   - Risiko: Basic dengan cukup direct sponsor bisa menerima level bonus; Silver/Gold/Platinum bisa salah batas level.

4. **Reward engine tidak sesuai aturan final.**
   - Aturan final: reward untuk member Silver dengan direct Silver thresholds 10, 100, 1.000, 10.000, 100.000.
   - Kode: reward hanya untuk Platinum dengan 10 direct sponsor Rp500.000.
   - Risiko: reward dibayar ke segmen yang salah dan threshold besar belum ada.

5. **Auto upgrade Silver -> Gold/Platinum belum ada.**
   - Aturan final: Silver menjadi Gold jika kode referral dipakai 5 member Silver; menjadi Platinum jika 10 member Silver.
   - Tidak ditemukan logic menghitung direct active Silver dan upgrade membership otomatis.
   - Risiko: member eligible tidak naik status; downstream bonus/profit sharing salah.

6. **Profit sharing belum sesuai formula final.**
   - Aturan final: 60% net profit, dialokasikan Silver qualified 30%, Gold 20%, Platinum 10%.
   - Kode: `ProfitSharingService.ts:89-112` equal split ke semua active members.
   - Risiko: distribusi profit sharing salah secara bisnis dan compliance.

### P2 - Penting

1. **Benefit merchandise seed tidak sesuai aturan final.**
   - Gold harus Kaos + Jaket + Banner, tetapi seed Kaos + Topi.
   - Platinum harus Kaos + Jaket, tetapi seed menambah Rompi.

2. **Reward belum punya dedicated transaction/status lifecycle.**
   - Ada `REWARD_BONUS` di wallet/commission, tetapi tidak ada model `reward_transactions` dengan status pending/approved/paid/rejected.

3. **Basic PPOB perlu pemisahan saldo.**
   - Saat ini `Wallet.balance` dipakai untuk TapGoPay dan `PPOB_BENEFIT` juga increment wallet balance.
   - Jika PPOB harus terpisah dari TapGoPay, perlu model/ledger saldo PPOB atau metadata/type yang dibaca UI/admin secara berbeda.

4. **Sponsor bonus dan level bonus bisa overlap di level 1.**
   - Saat ini direct sponsor mendapat `SPONSOR_BONUS` 8% dan juga berpotensi `LEVEL_BONUS` level 1 bila eligible.
   - Aturan final meminta memastikan tidak double count jika engine memisahkan sponsor bonus dan level bonus. Perlu keputusan bisnis: apakah Level 1 bonus adalah selain sponsor bonus atau digantikan oleh sponsor bonus.

5. **Money type memakai Decimal(14,2), bukan integer rupiah.**
   - Aman dari floating point, tetapi masih bisa menyimpan pecahan rupiah. Jika final wajib integer, perlu validasi amount tidak mengandung desimal.

### P3 - Enhancement

1. **Terminologi profit sharing perlu compliance review.**
   - UI/admin sebaiknya tidak terlalu menjanjikan profit tanpa disclaimer/approval.

2. **Test final business rules belum lengkap.**
   - Existing tests masih menguji aturan lama: unlock level direct sponsor 3/5/10 dan reward Platinum.

3. **Registration bonus limit memakai count user role USER.**
   - Secara race, transaction serializable membantu, tetapi pada traffic besar perlu audit ulang dengan unique/event ledger untuk rank Basic.

## 4. Risiko Jika Langsung Production

| Risiko | Dampak | Prioritas |
|---|---|---|
| Basic sponsor bonus dibayar saat register | Payout keluar sebelum transaksi membership paid | P1 |
| Basic bonus masuk wallet, bukan PPOB | Laporan wallet/PPOB dan benefit user salah | P1 |
| Level bonus eligibility salah | Komisi bisa dibayar ke user tidak eligible atau tidak dibayar ke user eligible | P1 |
| Reward salah sasaran Platinum bukan Silver | Reward business plan tidak valid | P1 |
| Auto upgrade tidak ada | Member Silver eligible tidak naik Gold/Platinum | P1 |
| Profit sharing equal split | Distribusi bulanan melenceng dari final plan | P1 |
| Sponsor + Level 1 double count belum diputuskan | Potensi payout berlebih 8% + 8% ke sponsor langsung | P2 |
| Reward status belum ada | Sulit admin approval/audit reward | P2 |
| Decimal money tidak divalidasi integer | Potensi pecahan rupiah dalam ledger | P2 |

## 5. Rekomendasi Perbaikan Prioritas

### P1 Kritikal

1. Ubah Basic registration benefit menjadi PPOB benefit Rp5.000 untuk 1.000 user pertama.
2. Pindahkan Basic sponsor bonus Rp2.000 dari register ke payment success/approval flow untuk transaksi Silver/Gold/Platinum jika sponsor masih Basic.
3. Revisi level bonus eligibility berdasarkan membership tier upline:
   - Basic: 0 level
   - Silver: max level 3
   - Gold: max level 5
   - Platinum: max level 10
4. Implement auto upgrade:
   - Silver + 5 direct active Silver -> Gold
   - Silver + 10 direct active Silver -> Platinum
5. Rebuild reward engine:
   - Silver direct active Silver thresholds 10/100/1.000/10.000/100.000
   - one-time per threshold
   - reward transaction/status lifecycle
6. Rebuild profit sharing formula sesuai 60% net profit dan alokasi 30/20/10.

### P2 Penting

1. Sesuaikan seed/package benefits merchandise.
2. Tambahkan integer-rupiah validation untuk amount.
3. Definisikan apakah sponsor bonus 8% dan level 1 8% boleh sama-sama dibayar ke sponsor langsung. Jika tidak, level bonus harus mulai dari upline level 2 atau sponsor bonus menggantikan level 1.
4. Tambahkan admin reports untuk reward lifecycle dan PPOB separated ledger.

### P3 Enhancement

1. Compliance copy untuk profit sharing/reward.
2. Stress test collision/race untuk first 1.000 Basic.
3. Export reconciliation wallet balance vs ledger.

## 6. Rencana Implementasi Bertahap

### Tahap 1 - Lock Rules dan Test Dulu

- Tambahkan test untuk aturan final tanpa mengubah logic dahulu.
- Tandai test yang expected fail sebagai bukti gap.
- Buat fixture A/B/C/D untuk referral + membership.

### Tahap 2 - Basic Benefit dan Sponsor Bonus

- Pisahkan Basic PPOB Rp5.000 dari wallet TapGoPay.
- Hapus/pindahkan register-time sponsor bonus.
- Implement sponsor Basic Rp2.000 hanya saat paid/approved membership upgrade.

### Tahap 3 - Level Bonus Final

- Revisi `creditLevelBonuses` agar mengambil membership aktif upline.
- Terapkan max level berdasarkan tier, bukan direct sponsor count.
- Putuskan dan implement anti double count sponsor vs level 1.

### Tahap 4 - Auto Upgrade Silver

- Setelah direct downline Silver menjadi ACTIVE, hitung direct active Silver sponsor.
- Jika sponsor Silver mencapai 5, aktifkan Gold otomatis dengan audit metadata.
- Jika mencapai 10, aktifkan Platinum otomatis.

### Tahap 5 - Reward Final

- Tambahkan model/table reward milestone jika perlu.
- Implement thresholds 10/100/1.000/10.000/100.000 direct active Silver.
- Status reward pending/approved/paid/rejected.

### Tahap 6 - Profit Sharing Final

- Tambahkan input net profit bulanan.
- Pool = 60% net profit.
- Silver pool = 30% total allocation untuk Silver qualified dengan >=3 direct Silver.
- Gold pool = 20% total allocation untuk active Gold.
- Platinum pool = 10% total allocation untuk active Platinum.
- Distribusi atomic dan idempotent.

### Tahap 7 - Reconciliation dan Admin Reports

- Tambahkan tests/admin reports untuk PPOB, reward, bonus, profit sharing.
- Tambahkan reconciliation wallet ledger.

## 7. File yang Perlu Diubah Jika Perbaikan Dilakukan

Backend utama:

- `apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts`
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts`
- `apps/backend/src/modules/referrals/application/CommissionEngine.ts`
- `apps/backend/src/modules/referrals/application/ReferralService.ts`
- `apps/backend/src/modules/referrals/infrastructure/PrismaReferralRepository.ts`
- `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts`
- `apps/backend/src/modules/admin-console/application/AdminConsoleService.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/seed.ts`
- migrations baru untuk reward/PPOB/profit sharing jika diperlukan

Tests:

- `apps/backend/tests/memberships/membershipOrders.integration.test.ts`
- `apps/backend/tests/referrals/commissionEngine.test.ts`
- `apps/backend/tests/e2e/tapgoBusinessEngine.e2e.test.ts`
- `apps/backend/tests/profit-sharing/profitSharing.integration.test.ts`
- test baru untuk auto upgrade Silver direct 5/10

Flutter/UI kemungkinan perlu penyesuaian setelah backend final:

- screen wallet/dashboard untuk memisahkan TapGoPay vs PPOB jika diputuskan dipisah
- admin reports reward/profit sharing status

## 8. Test Scenario yang Harus Dibuat

1. **A Basic sponsor B Silver**
   - A register Basic.
   - B register pakai referral A.
   - B upgrade Silver dan payment PAID.
   - Expected final: A mendapat sponsor bonus sesuai status A Basic = Rp2.000, bukan saat B register.

2. **B Silver sponsor C Silver**
   - B aktif Silver.
   - C register pakai referral B.
   - C upgrade Silver PAID.
   - Expected: B mendapat sponsor bonus 8% x Rp500.000 = Rp40.000.

3. **C Silver sponsor D Silver**
   - C aktif Silver.
   - D register pakai referral C.
   - D upgrade Silver PAID.
   - Expected: C mendapat sponsor 8%; B sebagai upline level 2 mendapat 4% jika masih dalam max level Silver.

4. **Silver direct 5 memicu Gold**
   - User X aktif Silver.
   - 5 direct referral X aktif Silver paid.
   - Expected: X otomatis menjadi Gold.

5. **Silver direct 10 memicu Platinum**
   - User Y aktif Silver.
   - 10 direct referral Y aktif Silver paid.
   - Expected: Y otomatis menjadi Platinum.

6. **Reward 10 Silver langsung**
   - User Z Silver.
   - 10 direct active Silver.
   - Expected: reward milestone 10 = Rp500.000 created once with status lifecycle.

7. **PPOB benefit tiap paket**
   - Basic first 1.000: PPOB Rp5.000.
   - Silver: PPOB Rp100.000.
   - Gold: PPOB Rp600.000.
   - Platinum: PPOB Rp1.000.000.

8. **Pending payment tidak memicu bonus**
   - Create order Silver PENDING.
   - Expected: no membership active, no PPOB, no sponsor/level/reward.

9. **Failed payment tidak memicu bonus**
   - Create order Silver, mark FAILED/EXPIRED.
   - Expected: no membership active, no PPOB, no sponsor/level/reward.

10. **Profit sharing monthly simulation**
    - Input net profit.
    - Pool = 60%.
    - Distribusi Silver/Gold/Platinum sesuai kriteria final.
    - Expected: wallet transaction and commission history idempotent.

## 9. Kesimpulan

Engine TapGo saat ini **sudah kuat sebagai foundation**, tetapi masih membawa aturan lama dari fase sebelumnya. Untuk aturan bisnis final terbaru, statusnya belum production-ready terutama di area Basic bonus, sponsor bonus timing, level bonus eligibility, reward, auto upgrade, dan profit sharing.

Rekomendasi: jangan lanjut production final untuk business engine sebelum P1 diselesaikan dan test scenario final dibuat.
