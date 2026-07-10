# UAT Phase B Bug Report

Tanggal: 2026-06-11

## P0

| Area | Bug | Bukti | Dampak |
| --- | --- | --- | --- |
| Midtrans | Snap payment creation gagal unauthorized | `/api/v1/membership/orders/:id/pay` 502 `MIDTRANS_SNAP_FAILED` | Tidak bisa membuka payment page Midtrans, tidak bisa screenshot flow Midtrans, tidak bisa aktivasi membership via payment |

## P1

| Area | Bug | Bukti | Dampak |
| --- | --- | --- | --- |
| Membership API compatibility | `GET /api/v1/membership/me` mengembalikan `EMPTY` untuk USER UAT, sementara `GET /api/v1/memberships/me` menampilkan Basic | `/api/v1/membership/me` 200 `{status:"EMPTY"}`, `/api/v1/memberships/me` 200 tier `BASIC` | Screen yang memakai endpoint order-module bisa menampilkan member kosong meski profil user Basic valid |
| Basic PPOB validation for seeded user | USER UAT seed memiliki PPOB 0 | `/api/v1/wallet` ppobBalance `0` | Tidak bisa membuktikan Basic first-1000 benefit memakai akun seed; perlu registrasi user baru atau script test khusus |

## P2

| Area | Bug | Bukti | Dampak |
| --- | --- | --- | --- |
| Super Admin Settings | `commission-settings` masih 501 production approval required | `/api/v1/admin/commission-settings` 501 | Non-blocking untuk Phase B, tetapi perlu keputusan sebelum konfigurasi komisi production dibuka |

## Catatan

- Tidak ditemukan crash API.
- Tidak ditemukan 500 pada endpoint admin/super admin yang diuji.
- Tidak ditemukan dummy response pada endpoint yang diuji.
