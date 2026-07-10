# Wallet Ledger Business Audit

Tanggal audit: 16 Juni 2026

Scope: audit read-only cash wallet, PPOB balance, ledger, withdrawal, dan backward compatibility.

## Ringkasan

Status: **PASS dengan WARNING**

Wallet sudah memisahkan:

- `balance`: alias backward compatible untuk cash.
- `cashBalance`: saldo cash withdrawable.
- `ppobBalance`: saldo PPOB non-withdrawable.

Withdrawal memakai `cashBalance`, bukan `ppobBalance`. Sponsor bonus, level bonus, reward paid, dan profit sharing masuk cash. Basic registration dan benefit membership masuk PPOB.

WARNING: ledger tipe `REGISTRATION_BONUS` masih dipakai untuk Basic PPOB Rp5.000. Secara saldo sudah benar masuk PPOB, tetapi nama tipe bisa membingungkan dashboard/report jika dianggap cash bonus.

## Evidence Source

- `apps/backend/prisma/schema.prisma:636` sampai `651`: wallet memiliki `balance`, `cashBalance`, `ppobBalance`.
- `apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts:59` sampai `82`: register Basic membuat `cashBalance=0`, `ppobBalance=registrationBonus`, ledger `REGISTRATION_BONUS`.
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:506` sampai `560`: PPOB benefit membership hanya increment `ppobBalance`.
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:675` sampai `685`: sponsor bonus increment `cashBalance` dan `balance`.
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:807` sampai `817`: level bonus increment `cashBalance` dan `balance`.
- `apps/backend/src/modules/admin-console/application/AdminConsoleService.ts:433` sampai `470`: reward paid increment cash dan membuat `REWARD_BONUS` ledger.
- `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts:259` sampai `269`: profit sharing increment cash dan balance.
- `apps/backend/src/modules/wallets/infrastructure/PrismaWalletRepository.ts:119` sampai `137`: withdrawal reserve mensyaratkan `cashBalance >= amount` dan tidak menyentuh `ppobBalance`.

## Matrix Wallet

| Sumber Dana | Cash | PPOB | Ledger | Status |
| --- | --- | --- | --- | --- |
| Basic 1.000 user pertama Rp5.000 | Tidak | Ya | `REGISTRATION_BONUS` | PASS dengan WARNING naming |
| Silver benefit Rp100.000 | Tidak | Ya | `PPOB_BENEFIT` | PASS |
| Gold benefit Rp600.000 | Tidak | Ya | `PPOB_BENEFIT` | PASS |
| Platinum benefit Rp1.000.000 | Tidak | Ya | `PPOB_BENEFIT` | PASS |
| Sponsor bonus | Ya | Tidak | `BASIC_SPONSOR_BONUS` / `SPONSOR_BONUS` | PASS |
| Level bonus | Ya | Tidak | `LEVEL_BONUS` | PASS |
| Reward paid | Ya | Tidak | `REWARD_BONUS` | PASS |
| Profit sharing | Ya | Tidak | `PROFIT_SHARING` | PASS |
| Withdrawal request | Debet cash | Tidak | `WITHDRAWAL_REQUEST` | PASS |
| Withdrawal reject | Refund cash | Tidak | `WITHDRAWAL_REFUND` | PASS |

## Withdrawal

Status: **PASS**

Withdrawal reserve dilakukan dengan `wallet.updateMany` dan kondisi `cashBalance >= amount`, sehingga request concurrent tidak bisa membuat saldo cash negatif jika DB isolation berjalan sesuai.

Reject withdrawal hanya untuk status PENDING dan mengecek ledger refund existing sebelum mengembalikan cash, sehingga double refund diblokir.

Approve tidak mendebet lagi; paid hanya status final setelah approve.

## Risiko

| Temuan | Risiko | Prioritas |
| --- | --- | --- |
| `REGISTRATION_BONUS` kini berarti PPOB benefit Basic, bukan cash bonus | Admin/user dapat salah menafsirkan “bonus registrasi” sebagai cash withdrawable jika copy UI/report tidak eksplisit | P1 |
| Belum ada reconciliation report yang secara eksplisit membuktikan `cashBalance = cash credit - cash debit` dan `ppobBalance = ppob credit - ppob debit` untuk production data | Perlu sebelum cleanup/launch besar | P1 |
| `balance` tetap alias cash untuk backward compatibility | Aman untuk Flutter lama, tetapi harus didokumentasikan agar tidak dijumlah dengan PPOB | P2 |

## Kesimpulan

Wallet ledger aman untuk Closed Testing. Sebelum public launch, jalankan read-only reconciliation production dan perbaiki wording report/UI agar Basic Rp5.000 disebut PPOB benefit, bukan cash bonus.

