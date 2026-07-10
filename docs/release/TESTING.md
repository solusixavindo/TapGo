# TapGo Testing Guide

## Unit dan Build Check

Jalankan dari root project:

```bash
npm --workspace apps/backend run build
npm --workspace apps/backend run test
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo?schema=public npx prisma validate --schema apps/backend/prisma/schema.prisma
cd apps/user_app
flutter analyze
flutter test
flutter build apk --debug --dart-define=TAPGO_APP_MODE=staging
```

## Integration Test Database

Integration test backend tidak otomatis berjalan jika `TAPGO_TEST_DATABASE_URL` belum disiapkan. Ini disengaja agar test tidak menyentuh database development atau production.

### 1. Jalankan PostgreSQL lokal

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 2. Buat database test terpisah

```bash
docker exec tapgo-postgres createdb -U tapgo tapgo_test
```

Jika database sudah ada, command di atas bisa mengembalikan pesan already exists dan dapat diabaikan.

### 3. Deploy migration ke database test

```bash
cd apps/backend
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
npm run db:deploy
```

### 4. Jalankan integration test

```bash
cd apps/backend
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
npm test
```

Test yang aktif jika `TAPGO_TEST_DATABASE_URL` tersedia mencakup:

- User role guard admin endpoint.
- Referral A sponsor B.
- Upgrade Silver menghasilkan PPOB Rp100.000.
- Withdraw request persistence.
- Approve/reject withdraw.
- Invoice membership dapat diambil melalui API.

Jika `TAPGO_TEST_DATABASE_URL` tidak ada, integration test akan skip dengan aman.

