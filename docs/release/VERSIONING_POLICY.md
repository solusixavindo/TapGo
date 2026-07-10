# TapGo Versioning Policy

Tanggal: 2026-07-11

TapGo menggunakan Semantic Versioning dengan pre-release label untuk milestone sebelum public launch.

## Current Mapping

| Item | Nilai |
| --- | --- |
| Product version | `v1.0.0-alpha` |
| Backend package version | `1.0.0-alpha` |
| Flutter version | `1.0.0-alpha+1` |
| Android versionName | `1.0.0-alpha` |
| Android versionCode / build number | `1` |

Catatan: Jika channel distribusi tertentu tidak menerima suffix pre-release pada `versionName`, build release dapat menggunakan mapping kompatibel yang terdokumentasi tanpa mengubah product milestone.

## Milestone

### `v1.0.0-alpha`

Status: pre-production.

Kriteria:
- Core business engine tersedia.
- DOKU Checkout tersedia sebagai primary gateway.
- Midtrans tersedia sebagai secondary/fallback flow.
- Payment production UAT belum selesai.

### `v1.0.0-beta`

Status: payment production UAT verified.

Kriteria:
- Backend production deployed.
- DOKU webhook production registered.
- Real/controlled DOKU payment transaction PASS.
- Invoice berubah menjadi `PAID`.
- Membership aktif otomatis.
- Bonus/referral tetap idempotent.
- Tidak ada critical payment bug.

### `v1.0.0-rc1`

Status: release candidate.

Kriteria:
- Closed beta selesai.
- Tidak ada P0/P1 critical blocker.
- Google Play release checklist siap.

### `v1.0.0`

Status: public production release.

Kriteria:
- Google Play production release.
- Payment engine production stable.
- Support, recovery, and monitoring SOP ready.

## Version Types

### Patch

Format: `v1.0.1`

Digunakan untuk bug fix kecil yang backward compatible.

### Minor

Format: `v1.1.0`

Digunakan untuk fitur baru yang backward compatible.

### Major

Format: `v2.0.0`

Digunakan untuk perubahan besar yang dapat mengubah kontrak API, flow bisnis, atau compatibility.
