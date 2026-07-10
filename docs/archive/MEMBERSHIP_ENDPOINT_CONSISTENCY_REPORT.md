# Membership Endpoint Consistency Report

Tanggal: 2026-06-11

## Masalah

Saat UAT Phase B:

- `GET /api/v1/membership/me` mengembalikan `status: EMPTY`, `membership: null`.
- `GET /api/v1/memberships/me` mengembalikan user membership Basic dari `users.membershipId`.

Keduanya membuat pengalaman berbeda untuk user yang sama.

## Root Cause

| Endpoint | Source Data Lama | Dampak |
| --- | --- | --- |
| `/api/v1/membership/me` | `userMembership` aktif dari order membership paid | Akun Basic hasil seed/register tanpa row `userMembership` terlihat EMPTY |
| `/api/v1/memberships/me` | `users.membershipId`, fallback Basic | Akun Basic terlihat benar |

## Perubahan Lokal

File:

- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts`
- `apps/backend/tests/memberships/membershipOrders.integration.test.ts`

Perubahan:

- `MembershipOrderService.getMyMembership()` tetap memprioritaskan `userMembership` aktif.
- Jika belum ada `userMembership`, endpoint fallback ke `users.membershipId`.
- Jika user belum punya membershipId, fallback ke package Basic.
- Response fallback diberi metadata:

```json
{
  "source": "USER_PROFILE_MEMBERSHIP"
}
```

## Dampak

- Tidak mengubah business logic payment.
- Tidak membuat membership order baru.
- Tidak mengubah database.
- Tidak mengaktifkan membership berbayar.
- Hanya menyamakan read model agar Basic user tidak terlihat EMPTY.

## Validasi Lokal

- `npm --workspace apps/backend run build`: PASS
- `npm --workspace apps/backend run test`: PASS, 14 files, 94 tests

## Status Deploy

Belum dideploy ke VPS sesuai instruksi. Patch siap ikut deploy backend berikutnya.
