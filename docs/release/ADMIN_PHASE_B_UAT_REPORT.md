# Admin Phase B UAT Report

Tanggal: 2026-06-11  
API: `https://api.tapgolion.id`  
Akun: `+6280000000002`

## Ringkasan Endpoint

| Fitur | Endpoint | Status |
| --- | --- | --- |
| Login Admin | `POST /api/v1/auth/login` | PASS 200 |
| Dashboard Admin | `GET /api/v1/admin/dashboard/summary` | PASS 200 |
| User Management | `GET /api/v1/admin/members` | PASS 200 |
| Membership Approval/List | `GET /api/v1/admin/member-requests` | PASS 200 |
| Invoice List | `GET /api/v1/admin/invoices` | PASS 200 |
| Withdraw List | `GET /api/v1/admin/withdrawals` | PASS 200 |
| Wallet Monitoring | `GET /api/v1/admin/wallets` | PASS 200 |
| Super Admin-only guard | `GET /api/v1/admin/commission-settings` | PASS 403 |

## Dashboard Summary

```json
{
  "totalMembers": 39,
  "totalBasic": 39,
  "totalSilver": 0,
  "totalGold": 0,
  "totalPlatinum": 0,
  "totalRevenue": "0.00",
  "totalCommission": "36000.00",
  "totalWalletBalance": "226000.00",
  "totalPpobGiven": "0.00"
}
```

## Data Source

- Data berasal dari production API.
- Tidak ditemukan response dummy pada endpoint yang diuji.
- Admin tidak bisa mengakses endpoint Super Admin-only `commission-settings`; response 403 `FORBIDDEN`.

## Catatan

- Admin endpoint inti responsif.
- Data production saat audit didominasi Basic karena belum ada payment membership sukses pada flow UAT ini.
