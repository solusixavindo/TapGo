# Membership Package Business Audit

Tanggal audit: 16 Juni 2026

Scope: audit read-only paket membership TapGo sebelum launch. Tidak ada deploy, migration, cleanup execute, atau perubahan database.

## Ringkasan

Status: **PASS dengan WARNING**

Paket Basic, Silver, Gold, dan Platinum sudah dimodelkan di schema dan seed UAT dengan harga/benefit utama yang sesuai aturan bisnis terbaru. Flow order membership juga sudah memakai invoice, payment, dan aktivasi membership berbasis status paid.

WARNING utama: beberapa seed/demo lama masih menyimpan copy benefit lama yang berbeda wording/merchandise. Ini tidak otomatis berbahaya jika tidak dijalankan di production, tetapi perlu disiplin operasional agar seed demo tidak pernah dipakai di production.

## Evidence Source

- `apps/backend/prisma/schema.prisma:233` sampai `254`: model `Membership` memiliki `tier`, `price`, `ppobBalance`, `bpjsBenefit`, `merchandise`, `businessRight`, dan `isActive`.
- `apps/backend/prisma/seed-uat-credentials.ts:16` sampai `49`: paket UAT production credential seed berisi Silver Rp500.000, Gold Rp3.000.000, Platinum Rp5.500.000, PPOB Silver Rp100.000, Gold Rp600.000, Platinum Rp1.000.000.
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:44` sampai `49`: list paket mengambil membership aktif dari database, bukan hardcoded runtime.
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:52` sampai `125`: create order membuat `MembershipOrder`, `Invoice`, dan `MembershipPayment` pending.
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:173` sampai `226`: pembayaran sukses mengubah invoice/order/payment menjadi paid secara transaksional.

## Matrix Paket

| Paket | Rule Final | Implementasi Saat Ini | Status |
| --- | --- | --- | --- |
| Basic | User baru otomatis Basic | Register mengambil membership `BASIC` dan set `membershipId` jika ada | PASS |
| Basic PPOB | 1.000 user pertama mendapat PPOB Rp5.000, cash Rp0 | Register menghitung user role USER, lalu membuat wallet `cashBalance=0`, `ppobBalance=5000` untuk 1.000 pertama | PASS |
| Silver | Harga Rp500.000, PPOB Rp100.000, Kaos, BPJS JKK/JKM | Seed UAT berisi harga dan benefit sesuai | PASS |
| Gold | Harga Rp3.000.000, PPOB Rp600.000, Kaos, Jaket, Banner, BPJS JKK/JKM | Seed UAT berisi harga dan benefit sesuai | PASS |
| Platinum | Harga Rp5.500.000, PPOB Rp1.000.000, Kaos, Jaket, BPJS JKK/JKM/JHT | Seed UAT berisi harga dan benefit sesuai | PASS |
| Downgrade | Tidak boleh downgrade | `assertNoDowngrade` menolak target tier lebih rendah | PASS |
| Pending order | Tidak boleh order aktif bertumpuk | `createOrder` memblokir pending order aktif user yang sama | PASS |

## Risiko

| Risiko | Level | Catatan |
| --- | --- | --- |
| Seed demo lama berbeda benefit/merchandise | P2 | `apps/backend/prisma/demo-seed-utils.ts` dan `apps/backend/prisma/seed.ts` masih berisi wording lama seperti Topi/Rompi. Aman jika hanya dipakai demo/test, tetapi berisiko jika operator salah menjalankan seed di production. |
| Payment method awal bernama `DEVELOPMENT_PLACEHOLDER` | P2 | Dipakai saat order pending sebelum Snap dibuat. Tidak memicu benefit/bonus. Namun naming ini bisa membingungkan audit admin jika tampil di report. |
| Auto-upgrade tidak terlihat memberi PPOB benefit paket baru | P2 | Auto-upgrade menaikkan tier, tetapi tidak memanggil `creditPpobBenefit`. Perlu keputusan bisnis apakah benefit fisik/PPOB auto-upgrade diberikan atau hanya status membership naik. |

## Kesimpulan

Paket membership siap untuk Closed Testing dan UAT lanjutan. Sebelum public launch, pastikan operator hanya memakai seed production/UAT yang aman dan tidak menjalankan seed demo.

