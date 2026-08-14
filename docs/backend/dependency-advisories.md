# Dependency Advisories (P2)

Hasil `npm audit` read-only (tanpa `npm audit fix`, `package-lock.json` tidak
diubah). Tujuan dokumen: memisahkan temuan runtime produksi dari dev/test,
mencatat versi fix minimum, risiko breaking-change, dan test yang wajib
dijalankan sebelum upgrade. **Upgrade belum dilakukan** — butuh keputusan owner.

Ringkasan: production deps 9 (7 high), seluruh deps 17 (2 critical, 10 high).

## Runtime backend API (perlu ditangani sebelum public Release 2)

| Package | Terpasang | Vulnerable | Severity | Fix minimum | Rantai |
|---|---|---|---|---|---|
| `ws` | 8.20.1 | `<= 8.20.1` | High | > 8.20.1 (rilis patch ws) | `socket.io` → `engine.io` → `ws`; juga `socket.io-client` → `engine.io-client` → `ws` |
| `engine.io` | 6.6.8 | `6.0.0 - 6.6.8` | High | > 6.6.8 | `socket.io` → `engine.io` |
| `socket.io-adapter` | (transitif) | `2.5.2 - 2.5.7` | High | > 2.5.7 | `socket.io` → `socket.io-adapter` |
| `engine.io-client` | (transitif) | `6.0.0 - 6.6.5` | High | > 6.6.5 | `socket.io-client` → `engine.io-client` |

- **Isu inti:** `ws` — *memory exhaustion DoS* dari fragment/chunk kecil pada
  koneksi WebSocket. Backend menjalankan Socket.IO ([src/server.ts](../../apps/backend/src/server.ts)).
- **Cara perbaikan:** `npm update socket.io socket.io-client` sehingga membawa
  `engine.io`/`ws` terpatch (semuanya `fixAvailable: true`, non-major).
- **Risiko breaking-change:** rendah (patch/minor `socket.io` v4). Perlu regresi
  pada jalur realtime (rides/chat) yang saat ini masih deferred.
- **Test wajib sebelum upgrade:** smoke test koneksi Socket.IO (handshake,
  emit/receive), regresi seluruh backend suite, dan verifikasi header
  `Upgrade`/`Connection` di belakang Nginx.

> Catatan Release 1: fitur realtime (Ride/chat) belum aktif di Play, sehingga
> permukaan eksploitasi `ws` untuk Release 1 minimal. Tetap wajib ditangani
> sebelum mengaktifkan realtime pada Release 2.

### Status mitigasi (Release 2 hardening)

Socket.IO kini di belakang gate fail-closed `REALTIME_ENABLED` (default `false`,
lihat [src/realtime/socket.ts](../../apps/backend/src/realtime/socket.ts)). Saat
nonaktif, listener **tidak di-attach** sehingga endpoint `/socket.io/` tidak
merespons dan permukaan `ws`/`engine.io` **tidak terekspos** di runtime Release
1 (terverifikasi di `tests/realtime/realtimeGate.test.ts`).

**Keputusan upgrade:** upgrade `ws`/`socket.io` **tidak** dilakukan pada task
ini untuk menghindari perubahan `package-lock.json` dan regresi realtime yang
belum matang. Karena gate sudah menghilangkan exposure Release 1, urgensi runtime
turun. Upgrade dijadwalkan bersamaan dengan aktivasi realtime Release 2, dengan
langkah:

1. `npm update ws engine.io engine.io-client socket.io-adapter` (semua
   `fixAvailable: true`, non-major) lalu `npm install` untuk memperbarui lock.
2. Jalankan seluruh disposable-DB suite + `tests/realtime/realtimeGate.test.ts`
   dengan `REALTIME_ENABLED=true`.
3. Smoke test handshake/emit/receive di belakang Nginx (`Upgrade`/`Connection`).
4. Verifikasi tidak ada perubahan API `socket.io` v4 (patch/minor saja).

## Frontend monorepo (BUKAN jalur backend API Release 1)

| Package | Severity | Sumber | Catatan |
|---|---|---|---|
| `next` | High | `apps/admin_dashboard`, `apps/landing-page` | SSRF/DoS/cache — tangani sebelum publikasi frontend |
| `postcss` | High | build chain Next.js | idem |
| `sharp` | High | build chain Next.js (libvips CVE) | idem |

Tidak berada pada runtime API backend; tidak memengaruhi Release 1 backend.

## Dev / test tooling saja (tidak ter-deploy)

| Package | Severity | Fix | Breaking |
|---|---|---|---|
| `vitest` | Critical | 4.1.10 | **Major** (SemVer major) |
| `@vitest/coverage-v8` | Critical | mengikuti vitest 4.x | **Major** |

- Advisory: *Vitest UI server arbitrary file read/execute* — hanya relevan saat
  menjalankan Vitest UI, **tidak** ter-deploy ke produksi. Risiko runtime
  produksi = nol; risiko lingkungan dev = ada.
- **Risiko breaking-change:** tinggi (upgrade major dapat mengubah config/API
  test). Perlu menjalankan seluruh suite + menyesuaikan `vitest.config.ts`.
- Rekomendasi: jadwalkan terpisah sebagai peningkatan tooling, bukan bagian
  hardening ini.

## Prinsip

Jangan menaikkan versi hanya untuk menghilangkan warning tanpa bukti
kompatibilitas. Setiap upgrade harus disertai: menjalankan disposable-DB
integration suite, smoke test Socket.IO, dan review breaking-change changelog.
