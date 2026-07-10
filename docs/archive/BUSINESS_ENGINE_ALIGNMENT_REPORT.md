# TapGo Business Engine Alignment Report

Tanggal: 2026-06-09

Scope: audit dan mapping business engine terhadap aturan resmi final PT. TapGo Lion Indonesia.

Catatan penting:

- Tidak ada perubahan UI.
- Tidak ada perubahan backend logic.
- Tidak ada perubahan database/migration.
- Tidak ada perubahan endpoint production/domain/VPS.
- Laporan ini adalah Tahap 1: audit & mapping. Implementasi alignment belum dilakukan.

## Ringkasan Eksekutif

Status engine saat ini: **PARTIAL MATCH**.

TapGo sudah memiliki pondasi production engine untuk membership order, invoice, payment success, referral relation, wallet ledger, PPOB benefit paket berbayar, sponsor bonus, level bonus, reward, profit sharing, withdrawal, dan admin report. Namun beberapa aturan final resmi berbeda dari implementasi yang sekarang hidup di kode.

Gap kritikal:

- Benefit Basic Rp5.000 saat ini masuk **Wallet/TapGoPay**, sedangkan aturan final menyebut **PPOB Benefit**, bukan wallet balance.
- Basic sponsor bonus Rp2.000 saat ini bisa diberikan saat **register referral**, padahal aturan final hanya saat downline upgrade membership dan status **PAID + APPROVED**.
- Level bonus saat ini memakai unlock berdasarkan jumlah direct sponsor 3/5/10, bukan batas berdasarkan tier upline Basic/Silver/Gold/Platinum.
- Auto upgrade Silver ke Gold/Platinum berdasarkan 5/10 direct Silver aktif belum ada.
- Reward engine masih aturan lama: Platinum 10 direct sponsor Rp500.000, bukan Silver direct active thresholds 10/100/1.000/10.000/100.000.
- Profit sharing sudah ada secara struktur, tetapi masih equal split ke seluruh active member, belum formula 60% net profit dengan pembagian Silver 30%, Gold 20%, Platinum 10%.

## Mapping Rule Bisnis Final

| Engine | Rule Final | Implementasi Saat Ini | Status | File/Bukti |
|---|---|---|---|---|
| Member Basic | User register otomatis Basic | User baru diberi `membershipId` Basic jika data package Basic tersedia | MATCH | `apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts` |
| Basic PPOB benefit | PPOB Rp5.000 untuk 1.000 user pertama | Rp5.000 masuk wallet sebagai `REGISTRATION_BONUS` | NOT MATCH | `PrismaAuthRepository.ts` |
| Basic user ke-1001 | Tidak dapat Rp5.000 | Ada check `registeredUsers < 1000` | PARTIAL MATCH | `PrismaAuthRepository.ts` |
| Silver upgrade | Rp500.000 | Package Silver Rp500.000 tersedia | MATCH | `apps/backend/prisma/seed.ts`, `MembershipOrderService.ts` |
| Silver benefit | Kaos, PPOB Rp100.000, BPJS JKK/JKM | Kaos, PPOB Rp100.000, BPJS TK JKK/JKM | MATCH | `apps/backend/prisma/seed.ts` |
| Gold upgrade langsung | Rp3.000.000 | Package Gold Rp3.000.000 tersedia | MATCH | `apps/backend/prisma/seed.ts` |
| Gold auto upgrade | Silver + 5 direct Silver aktif menjadi Gold | Belum ditemukan logic auto upgrade | NOT MATCH | Tidak ada di `MembershipOrderService.ts`/`ReferralService.ts` |
| Gold benefit | Kaos, Jaket, Banner, PPOB Rp600.000, BPJS JKK/JKM | PPOB/BPJS match, merchandise seed tidak match penuh | PARTIAL MATCH | `apps/backend/prisma/seed.ts` |
| Platinum upgrade langsung | Rp5.500.000 | Package Platinum Rp5.500.000 tersedia | MATCH | `apps/backend/prisma/seed.ts` |
| Platinum auto upgrade | Silver + 10 direct Silver aktif menjadi Platinum | Belum ditemukan logic auto upgrade | NOT MATCH | Tidak ada di `MembershipOrderService.ts`/`ReferralService.ts` |
| Platinum benefit | Kaos, Jaket, PPOB Rp1.000.000, BPJS JKK/JKM/JHT | PPOB/BPJS match, merchandise ada tambahan Rompi | PARTIAL MATCH | `apps/backend/prisma/seed.ts` |
| Sponsor Basic | Basic sponsor mendapat Rp2.000 saat downline upgrade PAID+APPROVED | Bonus Rp2.000 diberikan saat register referral untuk first 1.000 dan ada jalur order Basic | NOT MATCH | `PrismaAuthRepository.ts`, `MembershipOrderService.ts` |
| Sponsor Silver | 8% dari paket paid/approved | 8% dari package price saat payment success | MATCH | `MembershipOrderService.ts` |
| Sponsor Gold | 8% dari paket paid/approved | 8% dari package price saat payment success | MATCH | `MembershipOrderService.ts` |
| Sponsor Platinum | 8% dari paket paid/approved | 8% dari package price saat payment success | MATCH | `MembershipOrderService.ts` |
| Sponsor trigger | Hanya PAID + APPROVED | Bonus order dipanggil setelah invoice/order PAID; approval concept masih dipakai via admin mark paid | PARTIAL MATCH | `MembershipOrderService.ts`, `AdminConsoleController` |
| Level Basic | Basic tidak dapat level bonus | Tidak eksplisit cek membership upline Basic; eligibility memakai direct count | NOT MATCH | `MembershipOrderService.ts` |
| Level Silver | L1 8%, L2 4%, L3 2%, level 4+ 0 | Rate tersedia, tetapi eligibility bukan tier Silver | PARTIAL MATCH | `MembershipOrderService.ts` |
| Level Gold | L1-L5 sesuai rate, level 6+ 0 | Rate tersedia, tetapi eligibility bukan tier Gold | PARTIAL MATCH | `MembershipOrderService.ts` |
| Level Platinum | L1-L10 sesuai rate | Rate tersedia, tetapi eligibility bukan tier Platinum | PARTIAL MATCH | `MembershipOrderService.ts` |
| Level trigger | Hanya order PAID+APPROVED | Dipanggil di payment success, tidak saat pending/failed | PARTIAL MATCH | `MembershipOrderService.ts`, `MidtransPaymentService.ts` |
| Reward thresholds | Silver direct active 10/100/1k/10k/100k | Saat ini Platinum 10 direct sponsor Rp500.000 saja | NOT MATCH | `MembershipOrderService.ts` |
| Reward ledger/status | Reward wallet/ledger dengan status lifecycle | Ada wallet transaction + commission `REWARD_BONUS`, belum dedicated reward lifecycle pending/approved/paid/rejected | PARTIAL MATCH | `schema.prisma`, `MembershipOrderService.ts` |
| Profit sharing pool | 60% net profit bulanan input Super Admin | Period totalPoolAmount ada, belum net profit input/60% calculation | NOT MATCH | `ProfitSharingService.ts` |
| Profit sharing Silver | Qualified Silver >=3 direct Silver mendapat 30% pool split rata | Belum ada qualification ini | NOT MATCH | `ProfitSharingService.ts` |
| Profit sharing Gold | Gold mendapat 20% pool split rata | Belum ada tier pool Gold | NOT MATCH | `ProfitSharingService.ts` |
| Profit sharing Platinum | Platinum mendapat 10% pool split rata | Belum ada tier pool Platinum | NOT MATCH | `ProfitSharingService.ts` |
| Wallet ledger | Semua bonus/payment/withdraw ada ledger | Sponsor, level, reward, PPOB, profit sharing, withdrawal ada wallet transaction; membership payment ledger belum jelas sebagai wallet transaction | PARTIAL MATCH | `WalletTransaction`, `MembershipOrderService.ts`, `WalletRepository.ts` |
| Invoice engine | Order membuat invoice | Invoice dibuat saat order membership dibuat | MATCH | `MembershipOrderService.ts` |
| Payment failed/pending | Tidak memicu bonus | Midtrans terminal status update tidak memanggil activation; bonus di payment success | MATCH | `MidtransPaymentService.ts`, `MembershipOrderService.ts` |
| Idempotency | Tidak double payout | Commission unique key dan existing checks tersedia | MATCH | `schema.prisma`, `MembershipOrderService.ts` |
| Admin Membership Summary | Total Basic/Silver/Gold/Platinum | Dashboard summary ada, perlu verifikasi grouping current membership | PARTIAL MATCH | `AdminConsoleService.ts` |
| Admin Commission Summary | Sponsor, Level, Reward, Profit Sharing | Report types ada | PARTIAL MATCH | `AdminConsoleService.ts` |
| Admin Referral Summary | Total direct/network referral | Referral summary endpoint ada untuk user; global admin analytics belum sepenuhnya final | PARTIAL MATCH | `ReferralService.ts`, `AdminConsoleService.ts` |

## Gap Prioritas

### P1 - Kritikal sebelum production final

1. **Basic Rp5.000 harus PPOB, bukan wallet.**
   - Dampak: saldo TapGoPay dan saldo PPOB bisa salah secara bisnis.

2. **Basic sponsor Rp2.000 tidak boleh dibayar saat register.**
   - Dampak: payout keluar sebelum ada transaksi membership paid/approved.

3. **Level bonus harus berdasarkan tier upline, bukan direct sponsor count.**
   - Dampak: Basic bisa menerima level bonus atau Silver/Gold salah batas level.

4. **Auto upgrade Gold/Platinum belum ada.**
   - Dampak: status member tidak naik otomatis meskipun sudah memenuhi syarat.

5. **Reward engine belum sesuai final.**
   - Dampak: reward diberikan ke Platinum, bukan ke Silver direct active thresholds.

6. **Profit sharing formula belum sesuai final.**
   - Dampak: distribusi bulanan salah.

### P2 - Penting

1. Benefit merchandise Gold/Platinum perlu disesuaikan.
2. Reward lifecycle perlu dedicated status pending/approved/paid/rejected.
3. Perlu pemisahan jelas TapGoPay wallet vs PPOB benefit ledger.
4. Perlu definisi final apakah sponsor bonus 8% dan level 1 8% boleh sama-sama dibayarkan ke sponsor langsung.
5. `MEMBERSHIP_PAYMENT` wallet ledger belum terlihat sebagai wallet transaction type.

### P3 - Enhancement

1. Reconciliation wallet balance vs ledger.
2. Admin report global referral analytics lebih lengkap.
3. Compliance wording untuk profit sharing/reward.

## Rencana Alignment Bertahap

### Tahap A - Safety Test Lock

- Tambahkan test final rules sebagai failing tests dahulu.
- Jangan deploy production sebelum test P1 hijau.

### Tahap B - PPOB Basic & Sponsor Basic

- Ubah register Basic Rp5.000 menjadi PPOB benefit ledger.
- Hentikan Basic sponsor payout saat register.
- Pindahkan Basic sponsor Rp2.000 ke event membership upgrade PAID+APPROVED.

### Tahap C - Level Bonus Tier-Based

- Ambil membership aktif setiap upline.
- Basic max level 0.
- Silver max level 3.
- Gold max level 5.
- Platinum max level 10.
- Pastikan level bonus tidak dihitung saat pending/failed/expired/cancelled.

### Tahap D - Auto Upgrade

- Setelah membership order paid/approved, hitung direct active Silver sponsor.
- Jika sponsor Silver punya 5 direct Silver aktif, auto activate Gold.
- Jika sponsor Silver punya 10 direct Silver aktif, auto activate Platinum.
- Simpan audit metadata dan source trigger.

### Tahap E - Reward Final

- Tambahkan reward milestone thresholds.
- Hitung hanya direct Silver aktif.
- Catat reward ledger/status lifecycle.
- Cegah duplicate threshold payout.

### Tahap F - Profit Sharing Final

- Super Admin input net profit.
- Pool = 60% net profit.
- Silver pool = 30% pool untuk qualified Silver >=3 direct Silver.
- Gold pool = 20% pool untuk active Gold.
- Platinum pool = 10% pool untuk active Platinum.
- Atomic distribution dan idempotent per period/user/tier.

### Tahap G - Admin Reports & Reconciliation

- Membership summary final.
- Commission summary final.
- Referral summary global.
- PPOB report.
- Reward report.
- Profit sharing report.

## File yang Kemungkinan Perlu Diubah Pada Tahap Implementasi

- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/seed.ts`
- `apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts`
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts`
- `apps/backend/src/modules/referrals/application/CommissionEngine.ts`
- `apps/backend/src/modules/referrals/application/ReferralService.ts`
- `apps/backend/src/modules/referrals/infrastructure/PrismaReferralRepository.ts`
- `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts`
- `apps/backend/src/modules/admin-console/application/AdminConsoleService.ts`
- `apps/backend/tests/memberships/membershipOrders.integration.test.ts`
- `apps/backend/tests/referrals/commissionEngine.test.ts`
- `apps/backend/tests/profit-sharing/profitSharing.integration.test.ts`
- `apps/backend/tests/e2e/tapgoBusinessEngine.e2e.test.ts`

## Risiko Perubahan

- Migrasi saldo Basic dari wallet ke PPOB perlu strategi data existing agar tidak merugikan user yang sudah menerima bonus.
- Menghentikan register-time sponsor bonus perlu handling transaksi existing yang sudah telanjur dibayar.
- Auto upgrade dapat memicu perubahan tier historis; perlu audit log agar admin tahu upgrade otomatis berasal dari rule.
- Reward threshold besar membutuhkan index/query efisien untuk direct active Silver.
- Profit sharing membutuhkan definisi net profit dan approval flow yang aman secara compliance.

## Status Akhir Tahap 1

Tahap audit dan mapping selesai.

Rekomendasi: lanjut ke tahap implementasi hanya setelah pemilik bisnis menyetujui keputusan berikut:

1. Bagaimana memperlakukan bonus Basic Rp5.000 yang sudah pernah masuk wallet pada user existing.
2. Apakah sponsor bonus 8% dan level 1 8% boleh sama-sama dibayar ke sponsor langsung.
3. Apakah auto upgrade Gold/Platinum memberi benefit PPOB/merchandise otomatis atau hanya status tier.
4. Apakah reward lifecycle membutuhkan approval manual admin sebelum masuk wallet.
5. Formula `30/20/10` profit sharing dihitung dari pool 60% atau dari net profit langsung. Dalam laporan ini diasumsikan dari pool 60%.
