# Founder Platinum Admin Guide

Tanggal: 2026-07-09

## Tujuan

Dokumen ini menjadi panduan operasional Super Admin untuk mengelola 10 akun Founder Platinum TapGo tanpa melanggar aturan bisnis yang sudah divalidasi.

Founder Program juga memiliki satu akun tertinggi `Founder Chairman` dengan Founder ID `FCH-001`. Akun ini dikelola dari menu yang sama, tetapi tidak termasuk kuota 10 Founder Platinum.

## Aturan Utama

- Founder Platinum maksimal 10 akun aktif/granted.
- Founder Platinum mendapat status membership Platinum secara gratis.
- Founder Platinum tidak dibuatkan invoice, payment, atau revenue palsu.
- Founder Platinum tidak mendapat benefit PPOB Platinum otomatis.
- Wallet awal Founder Platinum harus `cashBalance = 0` dan `ppobBalance = 0`.
- Grant Founder Platinum tidak boleh memicu sponsor bonus, level bonus, reward, atau profit sharing.
- Founder Platinum tetap boleh menjadi sponsor.
- Founder Platinum `ACTIVE` tetap boleh menerima sponsor bonus dan level bonus dari downline yang benar-benar membayar membership valid.
- Founder Platinum `SUSPENDED` atau `REVOKED` tidak boleh menerima bonus baru.
- Bonus history yang sudah terjadi tidak boleh dihapus.
- Founder Chairman mengikuti prinsip finansial yang sama: tidak ada invoice/payment/revenue/PPOB benefit saat grant, tetapi akun `ACTIVE` boleh menerima bonus dari transaksi downline paid valid.
- Data rekening Founder Chairman bersifat sensitif dan hanya boleh tampil dalam bentuk masked, misalnya `******1234`.

## Cara Grant Founder Platinum

Gunakan endpoint atau seed script yang sudah disediakan backend.

Endpoint:

```http
POST /api/v1/admin/founder-platinum/grants
```

Role:

- `SUPER_ADMIN` only.

Input minimal:

```json
{
  "fullName": "Nama Founder",
  "phone": "081300000000",
  "password": "PasswordAwal",
  "founderId": "FND-001",
  "email": "email@example.com",
  "reason": "Akun penghormatan Founder Platinum"
}
```

Catatan:

- Jangan gunakan endpoint ini untuk akun yang sudah ada.
- Jangan membuat invoice manual untuk Founder Platinum.
- Jangan menambahkan PPOB benefit manual.
- Jangan membuat payment dummy.

## Cara Melihat 10 Founder

Super Admin membuka menu:

`Super Admin Dashboard -> Founder Program`

Menu ini juga menampilkan card khusus Founder Chairman jika `FCH-001` sudah dibuat.

Atau gunakan endpoint:

```http
GET /api/v1/admin/founder-platinum
```

Data yang harus dicek:

- Total slot = 10.
- Used slot.
- Available slot.
- Status `ACTIVE`, `SUSPENDED`, `REVOKED`.
- Founder ID.
- Nama.
- Phone.
- Email.
- Wallet cash.
- Wallet PPOB.
- Referral count.
- Total sponsor bonus.
- Total level bonus.
- Total commission.

Untuk Founder Chairman, cek tambahan:

- Founder ID `FCH-001`.
- Membership `Founder Chairman / Platinum`.
- Bank account masked.
- Status lifecycle.
- Audit trail grant/status.

## Cara Melihat Detail Founder

Endpoint:

```http
GET /api/v1/admin/founder-platinum/:founderId
```

Contoh:

```http
GET /api/v1/admin/founder-platinum/FND-001
```

Detail menampilkan:

- Founder ID.
- Nama.
- Phone.
- Email.
- Membership Founder Platinum.
- Status.
- Granted by.
- Granted at.
- Wallet cash.
- Wallet PPOB.
- Referral count.
- Sponsor bonus.
- Level bonus.
- Total commission.
- Audit trail ringkas.

## Status Lifecycle

Status yang digunakan:

- `ACTIVE`
- `SUSPENDED`
- `REVOKED`

Transition normal:

- `ACTIVE -> SUSPENDED`
- `SUSPENDED -> ACTIVE`
- `ACTIVE -> REVOKED`
- `SUSPENDED -> REVOKED`

Tidak diizinkan:

- `REVOKED -> ACTIVE`
- `REVOKED -> SUSPENDED`
- Status yang sama ke status yang sama.

## Cara Suspend Founder

Gunakan menu `Founder Program`, pilih Founder, lalu klik `Suspend`.

Endpoint:

```http
PATCH /api/v1/admin/founder-platinum/:founderId/status
```

Body:

```json
{
  "status": "SUSPENDED",
  "reason": "Alasan suspend"
}
```

Dampak:

- User status menjadi `SUSPENDED`.
- Founder tidak menerima bonus baru.
- Riwayat bonus lama tetap ada.
- Tidak ada invoice/payment/revenue yang berubah.
- Audit log dibuat.

## Cara Reactivate Founder

Gunakan menu `Founder Program`, pilih Founder `SUSPENDED`, lalu klik `Aktifkan`.

Body:

```json
{
  "status": "ACTIVE"
}
```

Dampak:

- User status kembali `ACTIVE`.
- Founder dapat menerima bonus baru lagi dari downline paid valid.
- Audit log dibuat.

## Cara Revoke Founder

Gunakan menu `Founder Program`, pilih Founder, lalu klik `Revoke`.

Body:

```json
{
  "status": "REVOKED",
  "reason": "Alasan revoke"
}
```

Dampak:

- Founder grant diberi `revokedAt` dan `revokedBy`.
- User status menjadi `SUSPENDED`.
- Founder tidak menerima bonus baru.
- Slot tidak dihitung sebagai used slot aktif/suspended.
- Riwayat lama tetap tersimpan.
- Tidak ada delete data.
- Audit log dibuat.

## Hal yang Tidak Boleh Dilakukan

- Jangan delete user Founder.
- Jangan delete founder grant.
- Jangan delete wallet.
- Jangan delete commission history.
- Jangan buat invoice palsu.
- Jangan buat payment palsu.
- Jangan beri PPOB benefit Platinum otomatis.
- Jangan proses bonus saat grant.
- Jangan reaktifkan Founder `REVOKED` tanpa flow override khusus dan audit approval.

## Audit Trail

Event yang dicatat:

- `FOUNDER_PLATINUM_GRANTED`
- `FOUNDER_PLATINUM_SUSPENDED`
- `FOUNDER_PLATINUM_ACTIVE`
- `FOUNDER_PLATINUM_REVOKED`

Data audit minimal:

- Actor ID.
- Founder ID.
- Target user ID.
- Status asal.
- Status tujuan.
- Reason.
- Timestamp.

## Rollback Jika Salah Status

Jika salah suspend:

1. Buka Founder Program.
2. Pilih Founder.
3. Klik `Aktifkan`.
4. Tambahkan catatan operasional internal.
5. Pastikan audit trail tercatat.

Jika salah revoke:

- Jangan restore manual lewat database.
- Buat keputusan owner/Super Admin terlebih dahulu.
- Jika benar-benar perlu, buat flow override khusus dengan audit approval sebelum production.

## Checklist Harian Super Admin

- Cek jumlah used slot tidak lebih dari 10.
- Cek Founder `SUSPENDED` dan alasan suspend.
- Cek tidak ada wallet PPOB otomatis dari Founder grant.
- Cek bonus Founder hanya berasal dari downline paid valid.
- Cek audit trail setelah perubahan status.
