# TapGo Business Engine Gap Analysis - Tahap 2

Tanggal audit: 2026-06-09  
Scope: backend business engine validation only.  
Status: audit-only, tidak ada perubahan kode engine, UI, schema, migration, seed, atau data production.

## Ringkasan Eksekutif

Business engine TapGo saat ini sudah memiliki fondasi penting: register Basic, referral genealogy sampai 10 level, membership order, invoice/payment success transaction, wallet ledger, commission record, withdrawal reservation/refund, reward placeholder, dan profit sharing period.

Namun terhadap aturan resmi terbaru PT. TapGo Lion Indonesia, hasil audit menunjukkan status **PARTIAL MATCH** dengan beberapa gap kritikal. Risiko terbesar bukan pada stabilitas teknis dasar, melainkan pada **ketidaksesuaian formula bisnis**:

- Basic registration bonus saat ini masuk ke wallet, bukan PPOB.
- Basic sponsor bonus Rp2.000 saat ini dipicu saat register referral, bukan saat membership downline PAID + APPROVED.
- Sponsor Basic pada paid upgrade berpotensi menerima 8%, padahal aturan final menyatakan Basic hanya Rp2.000.
- Bonus level dihitung berdasarkan jumlah direct sponsor, bukan berdasarkan tier membership Silver/Gold/Platinum.
- Auto upgrade Silver ke Gold/Platinum belum ada.
- Direct downgrade masih mungkin jika member aktif membeli paket lebih rendah.
- Reward engine masih model Platinum 10 direct, bukan threshold Silver aktif 10/100/1.000/10.000/100.000.
- Profit sharing saat ini equal split semua active member, bukan 60% net profit dengan alokasi Silver/Gold/Platinum.

Estimasi risiko jika aplikasi diluncurkan hari ini dengan business rule final resmi: **High**. Untuk UAT teknis terbatas masih bisa berjalan, tetapi untuk produksi finansial penuh belum aman.

## Evidence Source

File utama yang diaudit:

- `apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts`
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts`
- `apps/backend/src/modules/referrals/application/CommissionEngine.ts`
- `apps/backend/src/modules/referrals/infrastructure/PrismaReferralRepository.ts`
- `apps/backend/src/modules/wallets/infrastructure/PrismaWalletRepository.ts`
- `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/seed.ts`

## Ranking Risiko

| Rank | Area | Status | Risiko Produksi | Prioritas |
|---|---|---|---|---|
| P0 | Basic sponsor bonus trigger | NOT MATCH | Bonus keluar saat register, bukan saat upgrade approved | Critical |
| P0 | Sponsor bonus Basic vs paid package | NOT MATCH | Sponsor Basic bisa menerima 8% dari paket paid | Critical |
| P0 | Level bonus eligibility | NOT MATCH | Upline Basic bisa eligible berdasarkan direct count; Silver/Gold/Platinum limit tidak sesuai | Critical |
| P0 | Direct downgrade | NOT MATCH | Member Platinum/Gold bisa tertimpa paket lebih rendah jika order lower tier dibayar | Critical |
| P1 | Basic PPOB benefit | NOT MATCH | Rp5.000 masuk wallet TapGoPay, bukan PPOB | High |
| P1 | Auto upgrade Gold/Platinum | NOT MATCH | Silver direct 5/10 tidak otomatis naik tier | High |
| P1 | Reward engine | NOT MATCH | Reward Platinum 10 direct, bukan Silver direct threshold berjenjang | High |
| P1 | Profit sharing formula | NOT MATCH | Equal split semua active member, bukan formula resmi | High |
| P1 | PPOB balance model | PARTIAL | PPOB benefit dicampur ke wallet balance | High |
| P2 | Wallet integrity invariant | PARTIAL | Ledger update ada, tetapi belum ada reconciliation guard otomatis | Medium |
| P2 | Benefit merchandise | PARTIAL | Seed benefit belum 100% sama dengan benefit final | Medium |
| P2 | Money type | PARTIAL | Decimal aman untuk uang, tetapi final audit meminta integer rupiah | Medium |
| P3 | Compliance wording | PARTIAL | Perlu wording profit sharing lebih hati-hati untuk production/legal | Low |

## 1. Commission Simulation Engine

### Simulasi Jaringan 10 Level

Skenario genealogy:

```text
A > B > C > D > E > F > G > H > I > J
```

Jika J melakukan upgrade Silver Rp500.000 dan semua upline adalah Silver aktif, maka berdasarkan aturan final:

| Upline | Level dari J | Expected Bonus Final |
|---|---:|---:|
| I | 1 | Level 1 = 8% = Rp40.000 |
| H | 2 | Level 2 = 4% = Rp20.000 |
| G | 3 | Level 3 = 2% = Rp10.000 |
| F | 4 | Rp0 untuk Silver |
| E | 5 | Rp0 untuk Silver |
| D | 6 | Rp0 untuk Silver |
| C | 7 | Rp0 untuk Silver |
| B | 8 | Rp0 untuk Silver |
| A | 9 | Rp0 untuk Silver |

Catatan penting: engine saat ini juga membayar direct sponsor bonus terpisah. Jika direct sponsor bonus dan level 1 bonus sama-sama diberikan ke I, maka I bisa menerima dua kali 8% dari transaksi yang sama. Aturan final perlu dipertegas apakah Level 1 adalah layer bonus terpisah atau sudah termasuk sponsor bonus. Jika harus dipisah, current double layer bisa disengaja. Jika tidak, ini risiko double count.

### Expected vs Actual Saat Ini

| Area | Expected Final | Actual Current | Gap |
|---|---|---|---|
| Sponsor bonus Basic | Rp2.000 hanya saat downline upgrade PAID + APPROVED | Basic sponsor bonus juga dibuat saat register referral di `PrismaAuthRepository.ts:116-161` | NOT MATCH |
| Sponsor bonus paid package | Basic Rp2.000; Silver/Gold/Platinum 8% | `MembershipOrderService.creditSponsorBonus()` memberi 8% untuk semua sponsor non-Basic package tanpa cek tier sponsor | NOT MATCH |
| Level bonus Silver | Silver max level 3 | `resolveUnlockedLevel()` memakai directSponsorCount 3/5/10, bukan tier Silver/Gold/Platinum | NOT MATCH |
| Level bonus Gold | Gold max level 5 | Tidak ada cek tier Gold pada upline | NOT MATCH |
| Level bonus Platinum | Platinum max level 10 | Tidak ada cek tier Platinum pada upline | NOT MATCH |
| Level bonus Basic | Basic tidak dapat level bonus | Basic dengan directSponsorCount cukup bisa lolos karena tier tidak dicek | NOT MATCH |
| Duplicate commission | Tidak boleh dobel | Unique commission `[beneficiaryId, triggerType, triggerId, type, level]` di schema | MATCH |

### Kesimpulan Commission Simulation

Commission engine saat ini lebih dekat ke aturan lama: unlock level berdasarkan direct sponsor count, bukan membership tier. Ini harus diselaraskan sebelum produksi finansial.

## 2. Wallet Integrity Audit

### Observasi Engine

Wallet mutation umumnya selalu disertai wallet transaction:

- Register bonus: wallet created dengan balance Rp5.000 dan `REGISTRATION_BONUS`.
- Sponsor/level/reward/profit sharing: wallet increment + wallet transaction + commission.
- Withdrawal request: wallet decrement + `WITHDRAWAL_REQUEST` negative.
- Withdrawal reject: wallet increment + `WITHDRAWAL_REFUND`.
- Withdrawal paid: status update + zero `ADJUSTMENT`.

### Formula Integrity

Expected invariant:

```text
wallet.balance = SUM(wallet_transactions.amount)
```

Untuk wallet murni TapGoPay, invariant ini secara teknis bisa benar. Namun ada gap domain:

- `PPOB_BENEFIT` saat membership aktif menambah `wallet.balance`, sehingga saldo PPOB dan saldo TapGoPay tercampur.
- Aturan final menyebut Basic PPOB Rp5.000 dan PPOB Silver/Gold/Platinum sebagai benefit PPOB, bukan wallet cash biasa.
- Jika user withdraw dari balance yang sama, ada risiko user bisa withdraw benefit PPOB jika tidak dibedakan di endpoint withdrawal.

### Status

| Check | Status | Catatan |
|---|---|---|
| Ledger dibuat untuk credit/debit utama | MATCH | Ada wallet transaction pada flow utama |
| Balance tidak negatif saat withdrawal | MATCH | `updateMany balance gte amount` |
| PPOB terpisah dari wallet cash | NOT MATCH | PPOB benefit masuk ke wallet balance |
| Reconciliation otomatis | PARTIAL | Belum ditemukan guard/test berkala balance vs ledger |

## 3. Idempotency Audit

### Membership Dibayar Dua Kali

Flow `markPaymentSuccess()` memakai:

- Transaction `Serializable`.
- Invoice update hanya dari `PENDING` ke `PAID`.
- Jika invoice sudah final, throw `MEMBERSHIP_INVOICE_ALREADY_FINALIZED`.
- Commission duplicate dicegah oleh unique constraint `[beneficiaryId, triggerType, triggerId, type, level]`.
- PPOB duplicate dicek dari existing wallet transaction `PPOB_BENEFIT` dengan reference order.
- Reward duplicate dicek dari reward milestone commission.

### Expected vs Actual

| Scenario | Expected | Actual |
|---|---|---|
| Payment success dipanggil 2 kali | Call kedua tidak membayar bonus | MATCH |
| Sponsor bonus dobel | Tidak dobel | MATCH, dilindungi commission unique |
| Level bonus dobel | Tidak dobel | MATCH, dilindungi commission unique |
| Reward 10 direct dobel | Tidak dobel untuk milestone yang ada | MATCH secara idempotency, tetapi formula reward salah |
| PPOB benefit dobel | Tidak dobel | MATCH per order |

### Residual Risk

Idempotency teknis relatif baik, tetapi formula yang salah akan tetap diposting dengan aman satu kali. Artinya masalah utama bukan double posting, melainkan salah nominal/salah penerima/salah trigger.

## 4. Withdrawal Audit

### Flow Current

| Step | Current Behavior | Status |
|---|---|---|
| Request withdraw | Cek saldo cukup, decrement wallet, create withdrawal PENDING, create `WITHDRAWAL_REQUEST` negative | MATCH |
| Approve | Hanya ubah status PENDING -> APPROVED, tidak debit lagi | MATCH |
| Reject | Hanya PENDING -> REJECTED, cek existing refund, increment wallet, create `WITHDRAWAL_REFUND` | MATCH |
| Paid | Hanya APPROVED -> PAID, create zero adjustment | MATCH |
| Double approve | Ditolak karena status bukan PENDING | MATCH |
| Double reject | Ditolak karena status bukan PENDING/refund guard | MATCH |

### Gap

Withdrawal engine terlihat cukup aman secara state machine. Gap besar tetap pada pencampuran PPOB benefit ke wallet balance. Jika balance yang bisa di-withdraw termasuk PPOB benefit, risiko finansialnya tinggi.

## 5. Referral Tree Audit

### Simulasi A > B > C > D > E > F > G > H > I > J

Saat user register dengan referral code:

- `referral` dibuat untuk direct sponsor.
- `referral_levels` dibuat untuk sponsor level 1 dan ancestor sponsor sampai level 10.
- Unique `[ancestorId, descendantId]` mencegah duplicate genealogy.

Expected rows untuk J:

| Ancestor | Level terhadap J |
|---|---:|
| I | 1 |
| H | 2 |
| G | 3 |
| F | 4 |
| E | 5 |
| D | 6 |
| C | 7 |
| B | 8 |
| A | 9 |

Current structure mendukung genealogy ini. Endpoint downlines membaca `referralLevel` berdasarkan `ancestorId` dan level. Jadi tree persistence secara struktur: **MATCH**.

### Gap

Genealogy sudah benar, tetapi bonus level yang mengikuti genealogy belum sesuai final rule karena eligibility memakai directSponsorCount, bukan membership tier.

## 6. Profit Sharing Simulation

Aturan final:

- Profit Sharing Pool = 60% net profit bulanan.
- Silver qualified: minimal 3 Direct Silver Aktif.
- Silver mendapat bagian dari 30% pool.
- Gold mendapat bagian dari 20% pool.
- Platinum mendapat bagian dari 10% pool.

Catatan formula: dokumen menyebut 30/20/10 dari pool. Itu berarti hanya 60% dari pool yang dibagikan. Jika maksud bisnis adalah 30%/20%/10% dari net profit, hasilnya berbeda. Perlu konfirmasi legal/finance sebelum implementasi.

### Simulasi Berdasarkan Teks Saat Ini: 30/20/10 dari Pool

| Net Profit | Pool 60% | Silver 30% Pool | Gold 20% Pool | Platinum 10% Pool | Total Allocated |
|---:|---:|---:|---:|---:|---:|
| Rp10.000.000 | Rp6.000.000 | Rp1.800.000 | Rp1.200.000 | Rp600.000 | Rp3.600.000 |
| Rp100.000.000 | Rp60.000.000 | Rp18.000.000 | Rp12.000.000 | Rp6.000.000 | Rp36.000.000 |
| Rp1.000.000.000 | Rp600.000.000 | Rp180.000.000 | Rp120.000.000 | Rp60.000.000 | Rp360.000.000 |

### Simulasi Jika Maksudnya 30/20/10 dari Net Profit

| Net Profit | Silver 30% Net | Gold 20% Net | Platinum 10% Net | Total Allocated |
|---:|---:|---:|---:|---:|
| Rp10.000.000 | Rp3.000.000 | Rp2.000.000 | Rp1.000.000 | Rp6.000.000 |
| Rp100.000.000 | Rp30.000.000 | Rp20.000.000 | Rp10.000.000 | Rp60.000.000 |
| Rp1.000.000.000 | Rp300.000.000 | Rp200.000.000 | Rp100.000.000 | Rp600.000.000 |

### Actual Current

Current `ProfitSharingService.distribute()`:

- Mengambil semua `userMembership` ACTIVE.
- Tidak memfilter Silver qualified 3 direct Silver.
- Tidak memisahkan Gold/Platinum allocation.
- Membagi `totalPoolAmount / eligibleMembers.length`.
- Membuat wallet transaction dan commission `PROFIT_SHARING`.

Status: **NOT MATCH**.

## 7. Auto Upgrade Simulation

### Final Expected

| Scenario | Expected |
|---|---|
| Silver memiliki 5 Direct Silver Aktif | Auto upgrade ke Gold |
| Silver memiliki 10 Direct Silver Aktif | Auto upgrade ke Platinum |
| Gold/Platinum existing | Tidak boleh downgrade otomatis |
| User membeli paket lebih rendah dari active tier | Seharusnya dicegah atau diperlakukan sebagai non-downgrade |

### Actual Current

Belum ditemukan engine auto-upgrade berdasarkan direct Silver aktif. `markPaymentSuccess()` selalu menutup membership aktif sebelumnya dan mengaktifkan paket order baru. Karena tidak ada tier rank guard, direct downgrade tampak mungkin:

```text
Platinum aktif -> user membuat order Silver -> invoice PAID -> Platinum expired -> Silver ACTIVE
```

Status:

- Auto Gold: **NOT MATCH**
- Auto Platinum: **NOT MATCH**
- No downgrade: **NOT MATCH / P0**

## Production Risk If Launched Today

| Dimension | Estimate | Reason |
|---|---:|---|
| UAT technical readiness | 75% | Core register/login/wallet/referral/membership flows ada |
| Business rule correctness | 45% | Banyak formula resmi belum sesuai |
| Financial safety | 55% | Idempotency baik, tetapi wrong trigger/recipient/withdrawable PPOB risk |
| Google Play presentation readiness | 80% | UI/legal banyak sudah dipoles, tetapi engine gap bukan UI |
| Production readiness overall | 58% | Belum aman untuk scale finansial resmi |

## P0 Critical Findings

1. **Basic sponsor bonus timing salah**
   - Current: Rp2.000 saat register referral.
   - Final: Rp2.000 saat downline upgrade membership PAID + APPROVED.
   - Risiko: bonus keluar sebelum revenue.

2. **Sponsor Basic bisa menerima 8% dari paid package**
   - Current paid order sponsor bonus tidak mengecek tier sponsor.
   - Final: sponsor Basic hanya Rp2.000.
   - Risiko: overpay Rp40.000/Rp240.000/Rp440.000 untuk sponsor Basic.

3. **Level bonus eligibility salah**
   - Current: directSponsorCount 3/5/10 unlock level.
   - Final: tier Silver/Gold/Platinum menentukan max level.
   - Risiko: Basic bisa dapat level bonus; Silver/Gold/Platinum bisa salah limit.

4. **Downgrade membership mungkin terjadi**
   - Current: order paid menutup membership lama dan aktifkan paket order baru.
   - Risiko: Platinum/Gold bisa turun ke Silver jika membeli paket lebih rendah.

## P1 High Findings

1. **Basic benefit Rp5.000 masuk wallet, bukan PPOB.**
2. **PPOB benefit paid package masuk ke wallet balance yang sama.**
3. **Auto upgrade Gold/Platinum belum ada.**
4. **Reward engine masih Platinum 10 direct, bukan Silver direct active thresholds.**
5. **Profit sharing formula belum sesuai.**
6. **Ambiguitas sponsor bonus vs level 1 bonus bisa menyebabkan persepsi double count.**

## Recommended Phased Fix Plan

### Phase 1 - Financial Stop-Gap P0

- Matikan Basic sponsor bonus saat register referral.
- Ubah paid sponsor bonus:
  - Sponsor Basic: fixed Rp2.000.
  - Sponsor Silver/Gold/Platinum: 8%.
- Tambahkan tier rank guard agar tidak bisa downgrade.
- Ubah level bonus eligibility berdasarkan active membership tier.

### Phase 2 - PPOB Separation

- Pisahkan PPOB balance dari withdrawable wallet.
- Ubah Basic first 1000 Rp5.000 menjadi PPOB benefit, bukan TapGoPay cash.
- Pastikan withdrawal hanya menggunakan withdrawable cash balance.

### Phase 3 - Auto Upgrade & Reward

- Tambahkan auto upgrade Silver -> Gold untuk 5 Direct Silver Aktif.
- Tambahkan auto upgrade Silver -> Platinum untuk 10 Direct Silver Aktif.
- Tambahkan reward thresholds 10/100/1.000/10.000/100.000 Direct Silver Aktif.
- Pastikan reward ledger/status pending/approved/paid/rejected.

### Phase 4 - Profit Sharing

- Konfirmasi formula legal: 30/20/10 dari pool atau dari net profit.
- Tambahkan Super Admin input net profit.
- Hitung pool 60%.
- Distribusi berdasarkan tier criteria.
- Tambahkan report/admin reconciliation.

### Phase 5 - Automated Deep Tests

- Buat integration test dengan `TAPGO_TEST_DATABASE_URL`.
- Tambahkan wallet reconciliation test.
- Tambahkan idempotency test untuk payment callback.
- Tambahkan scenario genealogy 10 level.

## Test Scenarios Required

| Test | Expected |
|---|---|
| A Basic sponsor B Silver | A mendapat Rp2.000 saat B PAID + APPROVED |
| B Silver sponsor C Silver | B mendapat 8% = Rp40.000 |
| C Silver sponsor D Silver | Upline level sesuai tier |
| Silver direct 5 | Auto upgrade Gold |
| Silver direct 10 | Auto upgrade Platinum, tanpa downgrade |
| Reward 10 Silver direct | Reward Rp500.000 sekali |
| Reward 100/1.000/10.000/100.000 | Reward sesuai threshold sekali per milestone |
| Pending payment | Tidak ada sponsor/level/reward/PPOB paid benefit |
| Failed/Expired payment | Tidak ada bonus |
| Duplicate payment callback | Tidak double sponsor/level/reward/PPOB |
| Wallet reconciliation | balance = sum ledger for withdrawable wallet |
| Withdrawal request/approve/reject/paid | Balance benar, refund tidak dobel |
| Profit sharing Rp10 juta | Sesuai formula confirmed |
| Profit sharing Rp100 juta | Sesuai formula confirmed |
| Profit sharing Rp1 miliar | Sesuai formula confirmed |

## Kesimpulan

TapGo sudah memiliki fondasi teknis engine yang serius, terutama transaction handling, ledger, referral genealogy, dan idempotency dasar. Tetapi aturan bisnis final terbaru berbeda cukup besar dari implementasi saat ini. Jika diluncurkan hari ini untuk production finansial, risiko salah bayar dan salah benefit masih tinggi.

Rekomendasi: jangan launch produksi finansial penuh sebelum minimal P0 dan P1 selesai serta diuji di test database terpisah. Untuk demo/UAT terbatas, boleh lanjut dengan catatan bahwa hasil bonus/reward/profit sharing belum mewakili aturan resmi final.
