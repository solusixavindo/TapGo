# USER Membership UAT Report

Tanggal: 2026-06-11  
API: `https://api.tapgolion.id`  
Akun: `+6280000000003`

## Ringkasan

| Area | Status | Bukti |
| --- | --- | --- |
| Login User | PASS | `POST /api/v1/auth/login` 200 |
| Auth profile | PASS | `GET /api/v1/auth/me` 200, role `USER`, status `ACTIVE` |
| Wallet/dashboard data API | PASS | `GET /api/v1/wallet` 200, fields `balance`, `cashBalance`, `ppobBalance` ada |
| Membership Basic via legacy endpoint | PASS | `GET /api/v1/memberships/me` 200, tier `BASIC` |
| Membership Basic via order endpoint | FAIL/P1 | `GET /api/v1/membership/me` 200 tetapi data `status: EMPTY`, `membership: null` |
| Package list | PASS | `GET /api/v1/membership/packages` 200 |
| Silver package | PASS | Price `500000`, PPOB `100000`, benefit metadata ada |
| Gold package | PASS | Price `3000000`, PPOB `600000`, benefit metadata ada |
| Platinum package | PASS | Price `5500000`, PPOB `1000000`, benefit metadata ada |
| Create checkout order | PASS | `POST /api/v1/membership/orders` 201 untuk Silver |
| Invoice terbentuk | PASS | Invoice `INV-MBR-20260611-MQ9N31BD7175`, status `PENDING`, amount `500000` |
| Midtrans Snap pay | FAIL/P0 | `POST /api/v1/membership/orders/:id/pay` 502 `MIDTRANS_SNAP_FAILED` unauthorized key |

## Detail Data User

- User ID: `0da4ffa7-e3db-4ea1-83ed-24d39456edd1`
- Nama: `UAT User Test`
- Phone: `+6280000000003`
- Referral Code: `UATUSER`
- Role: `USER`
- Status: `ACTIVE`

## Wallet Response

```json
{
  "balance": "0",
  "cashBalance": "0",
  "ppobBalance": "0",
  "currency": "IDR"
}
```

## Membership Package Response

| Tier | Price | PPOB | Benefit |
| --- | ---: | ---: | --- |
| BASIC | 0 | 0 | Tidak termasuk |
| SILVER | 500000 | 100000 | BPJS JKK, JKM; Kaos TapGo |
| GOLD | 3000000 | 600000 | BPJS JKK, JKM; Kaos TapGo, Jaket TapGo, Banner |
| PLATINUM | 5500000 | 1000000 | BPJS JKK, JKM, JHT; Kaos TapGo, Jaket TapGo |

## Order/Invoice Created During UAT

- Order ID: `a15da24c-e6ec-4f5b-9f25-9a4a84db0fae`
- Package: Silver
- Status: `PENDING`
- Total: `500000`
- Invoice ID: `fe5328a2-83b4-43c2-9e9b-91b644b0c9d1`
- Invoice Number: `INV-MBR-20260611-MQ9N31BD7175`

## Catatan

- Tidak dilakukan payment success.
- Tidak dilakukan transaksi real.
- Ada pending UAT order yang sengaja dibuat untuk validasi checkout.
