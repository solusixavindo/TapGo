# Founder Program Final Recommendation

Tanggal: 2026-06-17

## Final Decision

Status: **GO dengan migration nanti**

Founder Program direkomendasikan memiliki dua role:

```text
FOUNDER_CHAIRMAN = 1 akun
FOUNDER_PLATINUM = maksimal 10 akun
```

Keduanya bukan membership tier baru. Keduanya adalah **admin-granted founder status** dengan membership efektif Platinum.

## Founder Chairman Final Design

Founder Chairman:

- maksimal 1 akun aktif
- dibuat hanya oleh Super Admin
- user belum punya akun
- membership efektif Platinum
- memiliki badge Founder Chairman
- boleh membangun jaringan referral
- boleh menerima sponsor bonus dari paid downline valid
- boleh menerima level bonus sesuai Platinum
- cash wallet awal Rp0
- PPOB balance awal Rp0
- tidak mendapat PPOB Platinum Rp1.000.000
- tidak dibuatkan invoice/payment
- tidak dicatat sebagai revenue
- profit sharing default false sampai approval owner

## Founder Platinum Final Design

Founder Platinum:

- maksimal 10 akun aktif
- dibuat hanya oleh Super Admin
- user belum punya akun
- membership efektif Platinum
- memiliki badge Founder Platinum
- boleh membangun jaringan referral
- boleh menerima sponsor bonus dari paid downline valid
- boleh menerima level bonus sesuai Platinum
- cash wallet awal Rp0
- PPOB balance awal Rp0
- tidak mendapat PPOB Platinum Rp1.000.000
- tidak dibuatkan invoice/payment
- tidak dicatat sebagai revenue
- profit sharing default false sampai approval owner

## Schema Recommendation

Gunakan satu tabel:

```text
founder_program_grants
```

Dengan field utama:

- userId
- founderRole
- slotNumber
- status
- profitSharingEligible
- grantedBy
- grantedAt
- revokedBy
- revokedAt
- reason
- metadata

Alasan:

- lebih rapi dibanding tabel terpisah
- bisa report Founder Program dalam satu tempat
- memudahkan audit/revoke
- memudahkan filter profit sharing
- memudahkan enforcement limit Chairman/Platinum

## Risiko

| Risiko | Prioritas | Mitigasi |
| --- | --- | --- |
| Founder ikut profit sharing tanpa sengaja | P1 | `profitSharingEligible=false` default dan service filter. |
| Founder masuk revenue report | P1 | Tidak membuat order/invoice/payment; report split. |
| Founder menambah PPOB liability | P1 | Wallet ppob 0 dan no PPOB_BENEFIT transaction. |
| Lebih dari 1 Chairman | P1 | Service validation + DB constraint/partial unique jika memungkinkan. |
| Lebih dari 10 Platinum | P1 | Slot 1-10 + count validation. |
| Admin biasa membuat founder | P1 | Endpoint SUPER_ADMIN only. |
| Audit tidak lengkap | P1 | AuditLog wajib grant/revoke/eligibility update. |

## Rekomendasi Setelah Google dan Midtrans Selesai Review

Urutan kerja:

1. Final owner approval untuk role, daftar akun, dan profit sharing eligibility.
2. Buat migration Founder Program di local/test DB.
3. Implement service dan endpoint Super Admin.
4. Tambahkan report split founder vs paid/auto Platinum.
5. Tambahkan audit trail lengkap.
6. Tambahkan test no revenue/no invoice/no PPOB.
7. UAT di test/local DB.
8. Deploy production hanya setelah backup dan migration sequence aman.

## GO / NO-GO

Closed Testing saat ini:

```text
GO tanpa Founder Program
```

Founder Program production:

```text
GO dengan migration nanti
```

Tanpa migration:

```text
NO-GO untuk production
```

## Konfirmasi Batasan

Dokumen ini dibuat tanpa:

- deploy
- build APK/AAB
- migration
- cleanup execute
- production DB change
- perubahan business flow utama
