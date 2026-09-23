# Dibangun dari ROOT monorepo, bukan dari apps/backend/ — repo ini pakai npm
# workspaces (lihat package.json root), jadi npm ci butuh package-lock.json
# root untuk resolusi dependency yang benar. Jalankan:
#   docker build -f apps/backend/Dockerfile -t tapgo-backend .
# dari root repo, atau lewat infra/docker-compose.prod.yml (context: ..).
#
# Base image node:20-slim (Debian, glibc) — BUKAN node:20-alpine. Dicoba
# alpine dulu; engine query Prisma (dan kemungkinan besar juga argon2, native
# addon lain di dependencies) butuh libssl.so.1.1 yang tidak ada di musl libc
# Alpine, gagal saat runtime dengan "Error loading shared library libssl.so.1.1"
# meski build sukses. Ini masalah kompatibilitas yang sudah didokumentasikan
# Prisma sendiri untuk Alpine — slim (glibc) menghindari seluruh kelas masalah
# ini, bukan cuma ditambal dengan apk add openssl1.1-compat.

# ---- Stage 1: install semua dependency workspace + generate Prisma client ----
FROM node:20-slim AS deps
# node:20-slim TIDAK menyertakan openssl secara default. Tanpanya, `prisma
# generate` tidak bisa mendeteksi versi libssl yang tersedia dan diam-diam
# fallback menebak "openssl-1.1.x" (bookworm sebenarnya punya OpenSSL 3.x) —
# menghasilkan binary query engine yang tidak cocok dan gagal saat runtime
# ("libssl.so.1.1: cannot open shared object file"). Install DULU sebelum
# generate supaya Prisma mendeteksi versi yang benar.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/backend/prisma ./apps/backend/prisma
RUN npm ci
RUN npx prisma generate --schema apps/backend/prisma/schema.prisma

# ---- Stage 2: build TypeScript -> dist/ ----
# Catatan: npm workspaces meng-hoist dependency ke node_modules ROOT (bukan
# per-workspace) kecuali ada konflik versi — tidak ada apps/backend/node_modules
# terpisah untuk di-copy di sini, resolusi modul Node berjalan lewat lookup ke
# atas direktori sampai ketemu node_modules root, jadi cukup satu copy ini.
FROM node:20-slim AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/tsconfig.json ./apps/backend/
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/backend/src ./apps/backend/src
RUN npm run build --workspace apps/backend

# ---- Stage 3: dependency produksi saja (tanpa devDependencies) ----
FROM node:20-slim AS prod-deps
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/backend/prisma ./apps/backend/prisma
RUN npm ci --omit=dev --workspace apps/backend
RUN npx prisma generate --schema apps/backend/prisma/schema.prisma

# ---- Stage 4: image runtime akhir ----
FROM node:20-slim AS runtime
# Engine query Prisma butuh libssl HIDUP saat runtime juga, bukan cuma saat
# generate — lihat catatan di stage "deps".
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/backend/dist ./apps/backend/dist
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/backend/package.json ./apps/backend/package.json
WORKDIR /app/apps/backend

# Image node:*-slim resmi sudah menyediakan user non-root "node" (uid 1000) —
# tidak perlu membuat user baru.
USER node

EXPOSE 4000

# Endpoint /health sudah ada (lihat src/app.ts) — tidak menyentuh business
# logic, aman dipakai container orchestrator untuk cek kesiapan.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:' + (process.env.PORT || 4000) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Node sebagai PID 1 sudah menangani SIGTERM dengan benar di sini — server.ts
# sudah punya graceful shutdown eksplisit (server.close() -> drain koneksi ->
# disconnect Redis/Prisma sebelum exit), jadi tidak perlu init process (tini)
# tambahan hanya untuk masalah sinyal.
CMD ["node", "dist/src/server.js"]
