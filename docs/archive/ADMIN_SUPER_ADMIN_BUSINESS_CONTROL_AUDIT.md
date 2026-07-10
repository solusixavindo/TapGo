# Admin & Super Admin Business Control Audit

Tanggal audit: 16 Juni 2026

Scope: audit read-only role guard, admin reports, reward lifecycle, withdrawal lifecycle, member approval, dan super admin controls.

## Ringkasan

Status: **PASS dengan WARNING**

Admin console dilindungi `requireAuth` dan `requireRoles("ADMIN", "SUPER_ADMIN")`. Endpoint super-admin-only sudah dipisah untuk mark withdrawal paid, role/settings, app settings, dan profit sharing approve/distribute.

WARNING: beberapa endpoint super admin sensitif masih return 501, yang aman dari sisi risiko, tetapi berarti belum full operational untuk public admin management. Ini lebih baik daripada fake functionality.

## Evidence Source

- `apps/backend/src/core/security/authContext.ts:18` sampai `33`: Bearer auth wajib.
- `apps/backend/src/core/security/authContext.ts:35` sampai `47`: role guard.
- `apps/backend/src/modules/admin-console/presentation/admin-console.routes.ts:38`: seluruh admin console wajib ADMIN/SUPER_ADMIN.
- `apps/backend/src/modules/admin-console/presentation/admin-console.routes.ts:40` sampai `110`: dashboard, member, invoice, commission, reports, rewards.
- `apps/backend/src/modules/admin-console/presentation/admin-console.routes.ts:111` sampai `117`: commission settings super admin 501 approval required.
- `apps/backend/src/modules/admin-console/presentation/admin-console.routes.ts:124` sampai `153`: withdrawal list/approve/reject dan mark paid super admin.
- `apps/backend/src/modules/admin-console/presentation/admin-console.routes.ts:156` sampai `175`: role/app settings super admin 501 approval required.
- `apps/backend/src/modules/profit-sharing/presentation/profit-sharing.routes.ts:18` sampai `30`: profit sharing protected admin/super admin, approve/distribute super admin.

## Control Matrix

| Area | Admin | Super Admin | Status |
| --- | --- | --- | --- |
| Dashboard summary | Allowed | Allowed | PASS |
| User/member list | Allowed | Allowed | PASS |
| Membership approve/reject | Allowed | Allowed | PASS |
| Invoice list | Allowed | Allowed | PASS |
| Commission/bonus reports | Allowed | Allowed | PASS |
| Reward list/approve/reject/mark-paid | Allowed | Allowed | PASS |
| Withdrawal approve/reject | Allowed | Allowed | PASS |
| Withdrawal mark paid | Not allowed | Allowed | PASS |
| Profit sharing create/list | Admin route protected | Super Admin also allowed | PASS |
| Profit sharing approve/distribute | Not allowed | Allowed | PASS |
| Role/app settings | Not available/501 | Super Admin only/501 | PASS with WARNING |

## Data Report Coverage

Admin report routes include:

- Bonus report.
- PPOB report.
- Reward report.
- Financial summary.
- Wallet liability.
- Commission summary.
- Reward summary.
- Profit sharing summary.
- PPOB summary.

Status: **PASS**

## Risiko

| Temuan | Risiko | Prioritas |
| --- | --- | --- |
| Reward mark-paid allowed for ADMIN as currently routed | Jika policy final mengharuskan payout reward hanya SUPER_ADMIN, perlu pembatasan tambahan | P1/P2 tergantung SOP |
| Role/app settings masih 501 | Aman, tetapi belum operational jika dibutuhkan saat launch | P2 |
| Profit sharing endpoint sangat sensitif | Pastikan hanya SUPER_ADMIN kredensial trusted yang memiliki akses | P1 |

## Kesimpulan

Role guard dan admin business controls cukup aman untuk Closed Testing. Sebelum public launch dengan transaksi real besar, putuskan apakah reward paid harus dibatasi ke Super Admin saja.

