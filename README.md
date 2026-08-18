# TapGo Platform

TapGo is a production-oriented ride-hailing super app platform inspired by Gojek, Grab, and Uber.

## Apps

- `apps/user_app`: Flutter customer application.
- `apps/driver_app`: Flutter driver application.
- `apps/admin_dashboard`: Next.js admin dashboard.
- `apps/backend`: Node.js, Express.js, PostgreSQL, Prisma, Socket.io, Redis backend.
- `packages/shared`: shared contracts and constants.

## Initial Backend Commands

```bash
npm install
cp apps/backend/.env.example apps/backend/.env
# Isi secret di .env sebelum melanjutkan. Lihat catatan di bawah.
npm run db:migrate
npm run db:seed
npm run dev:backend
```

### Secret yang wajib diisi

Beberapa secret ditegakkan secara *fail-closed pada titik pemakaian*, bukan saat
boot: server tetap berhasil start tanpanya, tetapi fiturnya menolak dengan 503.
Ini mudah terlewat, jadi isi semuanya sebelum menguji:

| Variabel | Bila kosong |
| --- | --- |
| `MEMBERSHIP_DOCUMENT_SECRET` | Unggahan KTP/swafoto selalu gagal 503 |
| `AUTH_RECOVERY_HMAC_SECRET` | Pemulihan password selalu gagal 503 |
| `IDENTIFIER_INDEX_KEY_V1` | Blind index identifier tidak dapat dibentuk |
| `RATE_LIMIT_REDIS_URL` | Rate limit dihitung per-proses, bukan bersama |

Bangkitkan masing-masing dengan nilai yang **berbeda**:

```bash
openssl rand -base64 48
```

Secret sengaja dipisah per domain: kebocoran satu domain tidak boleh melemahkan
domain lain. Jangan memakai nilai yang sama untuk dua variabel.

### Seed akun demo

`npm run db:seed` menuntut tiga password lewat environment dan **gagal** tanpa
mereka — password akun seed tidak lagi ditanam di dalam kode:

```bash
SEED_ADMIN_PASSWORD='...' SEED_DRIVER_PASSWORD='...' SEED_USER_PASSWORD='...' npm run db:seed
```

Seed demo tidak punya tempat di production. Untuk memeriksa apakah akun seed lama
masih ada dan masih memakai password yang pernah bocor lewat Git:

```bash
npm --workspace apps/backend run audit:leaked-seed
```

Perintah itu read-only. Tambahkan `-- --rotate --confirm-credential-rotation`
untuk merotasi password akun yang terdampak.

## Architecture

The backend follows Clean Architecture with module boundaries:

- `domain`: entities, value objects, repository contracts.
- `application`: use cases and service orchestration.
- `infrastructure`: database, external providers, adapters.
- `presentation`: HTTP routes, controllers, validators.

See `docs/architecture/SYSTEM_ARCHITECTURE.md` and `docs/architecture/DATABASE_DESIGN.md`.
