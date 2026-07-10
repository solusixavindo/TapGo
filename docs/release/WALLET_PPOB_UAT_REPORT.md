# Wallet & PPOB UAT Report

Tanggal: 2026-06-11  
API: `https://api.tapgolion.id`

## Ringkasan

| Validasi | Status | Bukti |
| --- | --- | --- |
| Wallet response punya `balance` | PASS | `GET /api/v1/wallet` 200 |
| Wallet response punya `cashBalance` | PASS | `GET /api/v1/wallet` 200 |
| Wallet response punya `ppobBalance` | PASS | `GET /api/v1/wallet` 200 |
| Cash dan PPOB terpisah | PASS | User UAT: cash `0`, PPOB `0`; admin liability memisahkan cash/PPOB |
| PPOB tidak masuk cashBalance | PASS | Package PPOB ada di package metadata, wallet cash tetap `0` sebelum payment approved |
| Silver PPOB benefit | PASS | Package Silver `ppobBalance: 100000` |
| Gold PPOB benefit | PASS | Package Gold `ppobBalance: 600000` |
| Platinum PPOB benefit | PASS | Package Platinum `ppobBalance: 1000000` |
| Withdraw memakai cash | PASS API-readiness | `GET /api/v1/wallet/withdrawals` 200 dan financial report memisahkan withdrawable cash |
| Basic PPOB untuk user UAT | PENDING/CONTEXT | User UAT seed memiliki `ppobBalance: 0`; rule Basic Rp5.000 berlaku untuk registrasi user baru pertama 1.000, bukan akun seed lama |

## User UAT Wallet

```json
{
  "balance": "0",
  "cashBalance": "0",
  "ppobBalance": "0",
  "currency": "IDR"
}
```

## Super Admin Wallet Liability

```json
{
  "totalCashBalance": "226000.00",
  "totalPpobBalance": "0.00",
  "totalWithdrawableBalance": "226000.00",
  "totalNonWithdrawablePpob": "0.00",
  "usersWithCashBalance": 38,
  "usersWithPpobBalance": 0
}
```

## PPOB Summary

```json
{
  "basicRegistrationPpobTotal": "190000.00",
  "silverPpobTotal": "0.00",
  "goldPpobTotal": "0.00",
  "platinumPpobTotal": "0.00",
  "packagePpobBenefitTotal": "0.00",
  "totalPpobLiability": "0.00"
}
```

## Catatan

- Package benefit sudah benar.
- Karena belum ada membership paid/approved di production UAT saat audit ini, package PPOB Silver/Gold/Platinum belum masuk ke wallet user mana pun.
- Validasi aktivasi PPOB nyata masih menunggu Midtrans Snap/payment path selesai.
