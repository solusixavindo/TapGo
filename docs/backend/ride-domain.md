# Ride Domain — Stage 5.3 (Backend Foundation + Admin Moderation)

Dokumen ini menjelaskan fondasi backend ojek online TapGo Release 2:
state machine, batas domain, keamanan, moderasi admin awal, dan rekomendasi
retensi data.

> Status: **fondasi**. Belum ada provider Maps/routing/realtime/payment nyata,
> belum ada payout/settlement driver, dan fitur ini **tidak** diekspos ke
> aplikasi Play Release 1.

## 1. Batas domain

| Domain | Sumber kebenaran | Catatan |
|---|---|---|
| Perjalanan | `RideOrder.status` | State machine authoritative di server |
| Pembayaran ride | `RideOrder.paymentState` | **Domain terpisah**, tidak dicampur ke status ride |
| Membership/bonus | `Wallet`, `WalletTransaction`, Business Engine | **Tidak disentuh** oleh domain ride |
| Model ride legacy | `rides`, `drivers`, `payments` (0001_init) | Read-only compatibility boundary; tidak ditulis flow baru |

Nominal tarif memakai **integer rupiah penuh** (kolom `Int`), bukan float.

## 2. State machine RideOrder

```
CREATED ──▶ SEARCHING_DRIVER ──▶ DRIVER_ASSIGNED ──▶ DRIVER_TO_PICKUP
                                        │                    │
                                        ▼                    ▼
                                   DRIVER_ARRIVED ──▶ IN_TRIP ──▶ COMPLETED
```

Status terminal: `COMPLETED`, `CANCELLED_BY_PASSENGER`, `CANCELLED_BY_DRIVER`,
`CANCELLED_BY_SYSTEM`, `NO_DRIVER`, `EXPIRED`, `PAYMENT_FAILED`.

### Matriks transisi (aktor yang berhak)

| Dari | Ke | Aktor |
|---|---|---|
| CREATED | SEARCHING_DRIVER | SYSTEM |
| CREATED | CANCELLED_BY_PASSENGER | PASSENGER |
| CREATED | CANCELLED_BY_SYSTEM / EXPIRED | SYSTEM |
| SEARCHING_DRIVER | DRIVER_ASSIGNED | DRIVER, SYSTEM |
| SEARCHING_DRIVER | NO_DRIVER / CANCELLED_BY_SYSTEM / EXPIRED | SYSTEM |
| SEARCHING_DRIVER | CANCELLED_BY_PASSENGER | PASSENGER |
| DRIVER_ASSIGNED | DRIVER_TO_PICKUP | DRIVER |
| DRIVER_ASSIGNED | CANCELLED_BY_PASSENGER / _DRIVER / _SYSTEM | sesuai aktor |
| DRIVER_TO_PICKUP | DRIVER_ARRIVED | DRIVER |
| DRIVER_TO_PICKUP | CANCELLED_BY_PASSENGER / _DRIVER / _SYSTEM | sesuai aktor |
| DRIVER_ARRIVED | IN_TRIP | DRIVER |
| DRIVER_ARRIVED | CANCELLED_BY_PASSENGER / _DRIVER / _SYSTEM | sesuai aktor |
| IN_TRIP | COMPLETED | DRIVER |
| IN_TRIP | CANCELLED_BY_SYSTEM | SYSTEM |
| *terminal* | — | tidak ada transisi keluar |

### Aturan yang ditegakkan

- Order hanya dibuat dari quote yang valid, milik sendiri, dan belum kedaluwarsa.
- `RideOrder.quoteId` unique → satu quote tidak dapat menghasilkan dua order.
- Satu penumpang hanya boleh memiliki satu perjalanan aktif.
- Penerimaan driver **atomic**: conditional `updateMany` pada
  (`status = SEARCHING_DRIVER` AND `driverProfileId IS NULL`). Hanya satu driver
  menang; sisanya menerima `RIDE_ALREADY_TAKEN`.
- Driver tidak dapat `start` sebelum `DRIVER_ARRIVED`, tidak dapat `complete`
  sebelum `IN_TRIP`.
- Penumpang/driver tidak dapat memutasi perjalanan milik orang lain.
- Status terminal tidak dapat kembali aktif (`RIDE_ALREADY_FINAL`).
- Permintaan identik berulang bersifat idempoten.
- Transisi tidak sah → `RIDE_INVALID_TRANSITION` (error stabil, tanpa detail internal).

### Kode error domain (stabil)

`RIDE_QUOTE_NOT_FOUND`, `RIDE_QUOTE_FORBIDDEN`, `RIDE_QUOTE_EXPIRED`,
`RIDE_QUOTE_ALREADY_USED`, `RIDE_ACTIVE_ORDER_EXISTS`,
`RIDE_DIGITAL_PAYMENT_NOT_CONFIGURED`, `RIDE_ORDER_NOT_FOUND`,
`RIDE_ALREADY_TAKEN`, `RIDE_DRIVER_FORBIDDEN`, `RIDE_DRIVER_NOT_ACTIVE`,
`RIDE_DRIVER_PROFILE_REQUIRED`, `RIDE_VEHICLE_NOT_ELIGIBLE`,
`RIDE_INVALID_TRANSITION`, `RIDE_ALREADY_FINAL`, `RIDE_STATUS_CONFLICT`,
`RIDE_STATUS_UNCHANGED`, `RIDE_COORDINATE_INVALID`, `RIDE_LOCATION_INVALID`,
`RIDE_LOCATION_INACCURATE`, `RIDE_LOCATION_STALE`,
`RIDE_LOCATION_OUT_OF_ORDER`, `RIDE_RATE_LIMITED`.

## 3. Pembayaran (domain terpisah)

`RidePaymentState`: `NOT_CONFIGURED`, `CASH_EXPECTED`, `CASH_REPORTED`, `FAILED`.

- **CASH** adalah satu-satunya metode yang diterima pada Stage 5.2.
- **DIGITAL** fail-closed → `RIDE_DIGITAL_PAYMENT_NOT_CONFIGURED`.
- Menyelesaikan ride tunai hanya menandai `CASH_REPORTED`. **Tidak** ada
  kredit wallet, komisi, reward, bonus sponsor/level, profit sharing, PPOB,
  settlement driver, atau panggilan provider.
- `PAYMENT_FAILED` ada pada enum status ride sesuai kontrak Stage 5.2, tetapi
  **tidak dipakai** pada tahap ini (tidak ada transisi menuju status tersebut).

## 4. Tarif

`RIDE_FARE_RULE_V1`, pembulatan `ROUND_TO_NEAREST_100_HALF_UP`.

| Komponen | MOTORCYCLE | CAR |
|---|---:|---:|
| Base | 5.000 | 10.000 |
| Per km | 2.500 | 4.200 |
| Minimum | 9.000 | 17.000 |
| Service fee | 1.000 | 2.000 |

Urutan: hitung komponen → jumlahkan → terapkan minimum → **bulatkan total**
ke Rp100 terdekat (half-up). Jarak berasal dari `DistancePort` di server
(`HAVERSINE_LOCAL_V1`), **bukan** dari client. Masa berlaku quote 120 detik.
Konfigurasi tarif berada di layer domain server, bukan di UI.

## 5. Matching

`MatchingPort` provider-neutral; implementasi `PrismaMatchingAdapter`
deterministik dan tanpa jaringan. Kelayakan: driver `ACTIVE` + `ONLINE`,
akun user `ACTIVE`, punya kendaraan `isActive` + `VERIFIED` dengan tipe cocok,
dan tidak sedang memegang ride aktif. Adapter hanya menyarankan kandidat;
penetapan tetap atomic di service.

## 6. Keamanan

- Autentikasi wajib pada semua endpoint; endpoint driver butuh role
  `DRIVER`/`ADMIN`/`SUPER_ADMIN` **dan** profil driver.
- Ownership diperiksa per operasi. Resource milik orang lain dijawab `404`
  agar keberadaannya tidak bocor.
- API memakai `publicReference` (`RID-XXXXXXXXXX`), bukan UUID internal.
- Idempotency: header `Idempotency-Key` untuk quote/order; accept/advance
  idempoten bila status sudah sesuai; `RideEvent.eventKey` unique.
- Rate limit: tulis ride 20/menit, lokasi 120/menit.
- Validasi Zod pada body/params/query; alasan pembatalan memakai allowlist enum.
- Tidak ada mass assignment (field ditulis eksplisit).
- Tarif/jarak/status tidak pernah dipercaya dari client.
- Error tidak mengembalikan stack trace atau detail internal.

## 7. Privasi & retensi data (rekomendasi)

**Status: PROVISIONAL — menunggu persetujuan management/legal.**
Belum ada job retensi/penghapusan yang diimplementasikan.

| Data | Rekomendasi awal | Alasan |
|---|---|---|
| `RideDriverLocation` (presisi tinggi) | maks **30 hari**, lalu hapus/agregasi | Operasional & dispute |
| `RideOrder` (termasuk alamat) | ikut kebijakan retensi transaksi | Bukti layanan |
| `RideEvent` | dipertahankan (immutable) | Audit & forensik |
| Nomor plat | **tidak** disimpan plaintext (hash + versi ter-mask) | Minimisasi PII |

Wajib sejak awal: minimisasi data, RBAC, dan **redaksi koordinat/PII dari log**.
Koordinat tidak pernah dimasukkan ke pesan error, respons lokasi, atau metadata
`RideEvent`.

## 8. Admin/moderasi minimum

Stage 5.3 menambahkan endpoint admin dasar di `/api/v1/admin/rides`, dengan
akses hanya `ADMIN`/`SUPER_ADMIN`:

- melihat daftar/detail ride dengan kontak termasking;
- koreksi status ride aktif ke status terminal operasional
  (`CANCELLED_BY_SYSTEM`, `NO_DRIVER`, `EXPIRED`, `PAYMENT_FAILED`);
- suspend/reactivate/reject driver profile;
- verifikasi/reject/deactivate kendaraan;
- audit moderasi melalui `RideEvent` saat ada ride terkait;
- koreksi admin tidak memanggil payment provider, tidak membuat wallet, dan
  tidak mengubah Business Engine.

Yang masih harus diselesaikan sebelum produksi penuh: verifikasi KYC lengkap,
tinjauan pembatalan & dispute, penanganan insiden keselamatan, laporan
rekonsiliasi tunai, workflow review multi-level, serta UI admin ride. Semua
lanjutan itu tetap harus role-gated dan menulis audit trail.

## 9. Yang sengaja BELUM ada pada Stage 5.3

Realtime/socket ride (tetap di balik `REALTIME_ENABLED=false`), provider Maps/
routing/geocoding nyata, push notification, pembayaran digital, payout &
settlement driver, komisi ride, rating/review, chat, promo/voucher, dan
UI admin ride.
