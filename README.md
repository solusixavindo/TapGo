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
npm run db:migrate
npm run db:seed
npm run dev:backend
```

## Architecture

The backend follows Clean Architecture with module boundaries:

- `domain`: entities, value objects, repository contracts.
- `application`: use cases and service orchestration.
- `infrastructure`: database, external providers, adapters.
- `presentation`: HTTP routes, controllers, validators.

See `docs/architecture/SYSTEM_ARCHITECTURE.md` and `docs/architecture/DATABASE_DESIGN.md`.
