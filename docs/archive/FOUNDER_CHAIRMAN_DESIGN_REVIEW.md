# Founder Chairman Design Review TapGo

Tanggal: 2026-06-17

## Tujuan

Mendesain level khusus **Founder Chairman** untuk 1 akun pendiri utama/pemilik perusahaan, berada di atas **Founder Platinum** yang maksimal 10 akun.

Audit ini hanya desain dan rencana implementasi. Tidak ada deploy, build APK/AAB, migration, cleanup, atau perubahan production database.

## Ringkasan Keputusan

Keputusan: **GO dengan migration nanti**

Founder Chairman sebaiknya menjadi bagian dari **Founder Program** yang sama dengan Founder Platinum, memakai field/enum `founderRole`:

- `FOUNDER_CHAIRMAN` maksimum 1 akun aktif
- `FOUNDER_PLATINUM` maksimum 10 akun aktif

Tidak disarankan membuat Founder Chairman hanya lewat metadata JSON atau manual update membership karena akan lemah untuk limit 1 akun, audit, report, profit sharing, dan compliance.

## Review Desain Founder Platinum Saat Ini

Dokumen sebelumnya merekomendasikan tabel khusus `FounderPlatinumGrant` untuk Founder Platinum. Setelah ada Founder Chairman, desain tersebut sebaiknya dinaikkan menjadi tabel generik:

```text
founder_program_grants
```

Alasannya:

- Chairman dan Platinum sama-sama founder grant non-revenue.
- Keduanya sama-sama berstatus Platinum efektif.
- Keduanya perlu audit trail, reason, grant/revoke, dan profit sharing flag.
- Keduanya harus dikecualikan dari invoice/payment/PPOB benefit.
- Report bisa menampilkan founder program secara satu pintu.

## Apakah Founder Chairman Bisa Menjadi Bagian dari Founder Program?

Ya. Founder Chairman paling tepat menjadi bagian dari Founder Program, bukan membership tier baru.

Alasan:

- Secara business engine, Founder Chairman tetap memakai hak membership Platinum.
- Referral/commission engine saat ini membaca tier `PLATINUM`.
- Menambah tier baru `FOUNDER_CHAIRMAN` akan memaksa banyak perubahan engine level bonus, profit sharing, report, UI, dan membership package.
- Founder Chairman adalah **status penghormatan/source**, bukan paket berbayar.

## Perlu Tabel Terpisah atau Founder Tier?

### Opsi A - Tabel Terpisah FounderChairmanGrant dan FounderPlatinumGrant

Pro:

- Mudah membedakan secara fisik.
- Constraint per tabel sederhana.

Kontra:

- Duplikasi logic grant/revoke.
- Report founder harus join dua tabel.
- Audit dan API menjadi bercabang.
- Sulit menjaga konsistensi profit sharing/report.

### Opsi B - Satu Tabel FounderProgramGrant dengan `founderRole`

Pro:

- Satu model untuk semua founder.
- Limit 1 Chairman dan 10 Platinum bisa divalidasi di service.
- Report lebih rapi.
- Audit flow sama.
- Mudah menambah badge/role khusus nanti.

Kontra:

- Perlu enum baru `FounderRole`.
- Constraint “maks 1 Chairman aktif” lebih mudah dijaga application-level atau partial unique index.

### Opsi C - Cukup UserMembership Metadata

Pro:

- Tidak perlu schema besar.

Kontra:

- Tidak aman untuk production.
- Sulit enforce limit 1 Chairman dan 10 Platinum.
- Sulit filter profit sharing.
- Sulit audit/revoke/report.

Rekomendasi: **Opsi B - satu tabel FounderProgramGrant dengan `founderRole`.**

## Dampak terhadap Membership

Founder Chairman tetap:

- `User.membershipId = PLATINUM`
- `UserMembership.status = ACTIVE`
- `UserMembership.orderId = null`
- metadata/source = Founder Program

Tidak dibuat tier baru.

Alasan:

- Membership engine dan UI existing sudah mengenal Platinum.
- Founder Chairman berhak benefit hak mitra/referral seperti Platinum.
- Menghindari perubahan besar business flow.

## Dampak terhadap Referral

Founder Chairman dapat:

- memiliki referralCode
- menjadi sponsor
- punya downline
- muncul sebagai upline dalam `referral_levels`
- menerima level bonus sesuai tier Platinum

Tidak boleh:

- dibuat dari user biasa
- mengklaim referral sendiri
- membuat cycle referral

## Dampak terhadap Reward

Reward final TapGo berbasis direct Silver aktif.

Founder Chairman dapat dihitung sebagai user dengan membership Platinum untuk keperluan:

- jaringan referral
- reward yang memenuhi syarat jika owner mengizinkan rule reward berlaku untuk founder

Catatan risiko:

- Jika reward threshold hanya untuk member Silver sesuai rule lama tertentu, Founder Chairman tidak otomatis perlu reward milestone.
- Jika reward engine saat ini membuat reward untuk sponsor dengan direct Silver aktif tanpa membedakan founder, perlu owner decision apakah Founder Chairman boleh menerima reward.

Rekomendasi default:

- sponsor/level bonus: **boleh**
- reward milestone: **boleh hanya jika sama dengan Platinum biasa dan tidak melanggar policy**
- profit sharing: **false default sampai approval owner**

## Dampak terhadap Commission

Founder Chairman berstatus Platinum efektif, sehingga:

- menerima sponsor bonus 8% saat direct downline upgrade berbayar dan valid
- menerima level bonus sampai level 10 sesuai rule Platinum
- bonus masuk cash wallet

Tidak ada bonus yang diberikan saat Founder Chairman dibuat.

## Dampak terhadap Profit Sharing

Pertanyaan: profit sharing default false atau true?

Rekomendasi: **default false**

Alasan:

- Founder Chairman adalah akun penghormatan non-revenue.
- Profit sharing adalah distribusi dari net profit dan harus direkonsiliasi.
- Jika otomatis masuk Platinum pool, dapat mengubah distribusi anggota berbayar.
- Owner perlu approval eksplisit jika Founder Chairman dimasukkan.

Desain:

- `profitSharingEligible = false` default
- hanya Super Admin/owner approval bisa mengubah menjadi true
- perubahan wajib audit log

## Dampak terhadap Laporan

Founder Chairman harus:

- tidak masuk revenue
- tidak masuk invoice report
- tidak masuk Midtrans/payment report
- tidak membuat PPOB liability
- muncul di membership summary sebagai Founder Chairman
- muncul di referral tree sebagai user Platinum efektif
- muncul di commission report jika menerima bonus valid

Report rekomendasi:

```text
Platinum Paid
Platinum Auto Upgrade
Founder Chairman
Founder Platinum
Total Platinum Effective
```

## Business Rule Founder Chairman

Hak:

- Membership Platinum efektif
- Hak Mitra
- Referral bonus
- Level bonus sampai Platinum limits
- Jaringan referral
- Badge Founder Chairman

Tidak berhak otomatis:

- PPOB balance Rp1.000.000
- Invoice Platinum palsu
- Payment Platinum palsu
- Revenue recognition
- Profit sharing otomatis

## Admin Control

Rule:

- Hanya `SUPER_ADMIN` boleh grant/revoke.
- Tidak bisa dibuat dari register publik.
- Tidak bisa dibuat oleh Admin biasa.
- Tidak bisa dibuat dari user biasa.
- Maksimal 1 active Founder Chairman.
- Maksimal 10 active Founder Platinum.
- Phone harus unique.
- Founder slot/role harus unique sesuai rule.
- Semua grant/revoke wajib reason.

## Enforcement yang Direkomendasikan

Application-level:

- hitung active `FOUNDER_CHAIRMAN`; jika >=1, reject
- hitung active `FOUNDER_PLATINUM`; jika >=10, reject
- validasi role actor `SUPER_ADMIN`
- validasi no invoice/order/payment
- validasi wallet ppobBalance 0

Database-level:

- unique userId pada founder grant
- unique slot untuk Founder Platinum
- partial unique index untuk active Founder Chairman jika memungkinkan
- check slot 1-10 untuk Founder Platinum

## Audit Trail

Event wajib:

- `FOUNDER_CHAIRMAN_GRANTED`
- `FOUNDER_CHAIRMAN_REVOKED`
- `FOUNDER_PLATINUM_GRANTED`
- `FOUNDER_PLATINUM_REVOKED`
- `FOUNDER_PROFIT_SHARING_ELIGIBILITY_UPDATED`

Data wajib:

- actorId
- targetUserId
- founderRole
- slotNumber jika Founder Platinum
- reason
- timestamp
- ipAddress jika tersedia
- userAgent jika tersedia

## Risiko

| Risiko | Level | Mitigasi |
| --- | --- | --- |
| Chairman ikut profit sharing tanpa sengaja | P1 | `profitSharingEligible=false` default dan filter service. |
| Chairman masuk revenue report | P1 | Jangan buat order/invoice/payment; report split founder. |
| PPOB liability bertambah | P1 | Wallet ppobBalance 0 dan no PPOB_BENEFIT transaction. |
| Lebih dari 1 Chairman | P1 | Service validation dan DB partial unique jika memungkinkan. |
| Admin biasa membuat Chairman | P1 | Endpoint SUPER_ADMIN only. |
| Audit lemah | P1 | AuditLog wajib grant/revoke/eligibility. |

## Kesimpulan

Founder Chairman layak ditambahkan sebagai bagian dari Founder Program, bukan tier membership baru.

Keputusan desain:

```text
GO dengan migration nanti
```

Satu tabel Founder Program dengan `founderRole` adalah desain paling rapi, aman, dan mudah diaudit.
