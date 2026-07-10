# TapGo Backend Integration Tests

Integration tests are guarded by `TAPGO_TEST_DATABASE_URL` and must never run against
development or production databases.

See the root-level setup guide:

- `TEST_DATABASE_SETUP.md`

Quick path:

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis
docker exec tapgo-postgres dropdb -U tapgo --if-exists tapgo_test
docker exec tapgo-postgres createdb -U tapgo tapgo_test

TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
npm --workspace apps/backend run db:deploy

TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
npm --workspace apps/backend run test
```
