# Business Sustainability Simulation TapGo

Tanggal: 2026-06-17

## Disclaimer

Simulasi ini adalah analisis internal konservatif untuk menguji kesehatan model bisnis. Angka bukan janji profit, bukan proyeksi resmi, dan bukan jaminan hasil bisnis. Realisasi bergantung pada komposisi paket, biaya operasional, fraud rate, payment success rate, margin PPOB, dan kebijakan owner.

## Business Rules yang Digunakan

Paket:

- Basic: Rp0
- Silver: Rp500.000
- Gold: Rp3.000.000
- Platinum: Rp5.500.000

PPOB benefit:

- Silver: Rp100.000
- Gold: Rp600.000
- Platinum: Rp1.000.000

Bonus:

- Sponsor bonus: 8%
- Level 1: 8%
- Level 2: 4%
- Level 3: 2%
- Level 4: 2%
- Level 5: 2%
- Level 6-10: 1% per level

Eligibility:

- 3 direct sponsor unlock sampai level 3
- 5 direct sponsor unlock sampai level 5
- 10 direct sponsor unlock sampai level 10

## Asumsi Konservatif

| Skenario | Total Member | Basic | Silver | Gold | Platinum |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 100 | 70 | 25 | 4 | 1 |
| B | 1.000 | 750 | 220 | 25 | 5 |
| C | 10.000 | 8.000 | 1.750 | 220 | 30 |

Asumsi payout exposure:

- Sponsor bonus exposure: 8% dari gross paid membership revenue.
- Level bonus weighted exposure konservatif: 8% dari gross paid membership revenue.
- Reward exposure konservatif:
  - 100 member: Rp0
  - 1.000 member: Rp5.000.000
  - 10.000 member: Rp50.000.000
- Profit sharing tidak dihitung sebagai kewajiban otomatis karena bergantung pada net profit bulanan dan approval.
- Operational cost belum dihitung.
- PPOB benefit dihitung sebagai liability/benefit cost, bukan cash wallet.

## Simulasi Revenue dan Exposure

### Skenario A - 100 Member

| Komponen | Nilai |
| --- | ---: |
| Gross membership revenue | Rp30.500.000 |
| PPOB liability | Rp5.100.000 |
| Sponsor bonus exposure 8% | Rp2.440.000 |
| Level bonus exposure weighted | Rp2.440.000 |
| Reward exposure | Rp0 |
| Total exposure sebelum operasional | Rp9.980.000 |
| Estimated gross margin before operational cost | Rp20.520.000 |
| Exposure ratio | 32,72% |

### Skenario B - 1.000 Member

| Komponen | Nilai |
| --- | ---: |
| Gross membership revenue | Rp252.500.000 |
| PPOB liability | Rp52.000.000 |
| Sponsor bonus exposure 8% | Rp20.200.000 |
| Level bonus exposure weighted | Rp20.200.000 |
| Reward exposure | Rp5.000.000 |
| Total exposure sebelum operasional | Rp97.400.000 |
| Estimated gross margin before operational cost | Rp155.100.000 |
| Exposure ratio | 38,57% |

### Skenario C - 10.000 Member

| Komponen | Nilai |
| --- | ---: |
| Gross membership revenue | Rp2.220.000.000 |
| PPOB liability | Rp515.000.000 |
| Sponsor bonus exposure 8% | Rp177.600.000 |
| Level bonus exposure weighted | Rp177.600.000 |
| Reward exposure | Rp50.000.000 |
| Total exposure sebelum operasional | Rp920.200.000 |
| Estimated gross margin before operational cost | Rp1.299.800.000 |
| Exposure ratio | 41,45% |

## Stress Case: Full Level Unlock Maximum

Jika sponsor bonus 8% dan semua level 1-10 terbayar penuh, total percentage exposure teoritis:

```text
Sponsor 8%
Level total 8% + 4% + 2% + 2% + 2% + 1% + 1% + 1% + 1% + 1% = 23%
Total maksimum = 31% dari transaksi berbayar
```

Jika ditambah PPOB benefit yang rata-rata 20% untuk Silver/Gold dan 18,18% untuk Platinum, exposure total bisa mendekati atau melewati 50% sebelum biaya operasional, fee payment gateway, support, server, marketing, pajak, dan fraud reserve.

## Break-even Concern

TapGo perlu menjaga margin aman untuk:

- biaya operasional admin/support
- fee payment gateway
- server/cloud
- marketing
- merchant acquisition
- fraud/chargeback reserve
- pajak dan compliance
- refund/reversal

Jika payout + PPOB liability melebihi 45%-50% dari gross membership revenue secara konsisten, ruang operasional menjadi ketat.

## Sustainability Risk

| Area | Risiko | Prioritas |
| --- | --- | --- |
| Sponsor + level payout | Jika terlalu banyak user unlock level 10, exposure bisa tinggi. | P1 |
| PPOB liability | Benefit besar harus dipastikan sebagai saldo terbatas PPOB, bukan withdrawable cash. | P1 |
| Reward threshold | Reward 10/100/1000 direct Silver dapat spike. | P1 |
| Basic farming | Basic PPOB 1000 user pertama berisiko farming device/IP. | P1 |
| Profit sharing | Harus berdasarkan net profit real, bukan revenue. | P1 |
| Fraud/chargeback | Payment reversal perlu guard sebelum bonus final. | P1 |

## Rekomendasi

1. Tetapkan payout cap internal maksimum sebelum biaya operasional, misalnya alert jika total bonus + PPOB liability > 45% gross membership revenue.
2. Reward besar wajib manual review Super Admin sebelum dibayar.
3. Profit sharing hanya dari net profit bulan yang sudah direkonsiliasi.
4. Gunakan anti-abuse device/IP/referral monitoring untuk Basic farming.
5. Bonus level harus idempotent dan hanya dari payment valid.
6. Tambahkan dashboard operational monitoring untuk bonus spike abnormal.
7. Pertimbangkan fraud reserve sebelum distribusi reward/profit sharing.

## Kesimpulan

Model bisnis masih dapat dijalankan pada skenario konservatif jika:

- PPOB tetap terpisah dari cash wallet.
- Reward dan profit sharing tidak otomatis dibayar tanpa review.
- Anti-abuse aktif sebelum public launch.
- Payout exposure dipantau harian/mingguan.

Status sustainability: **WARNING - perlu monitoring dan cap internal sebelum public launch skala besar**.
