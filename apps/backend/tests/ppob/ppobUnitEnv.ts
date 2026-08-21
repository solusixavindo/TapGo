/**
 * Lingkungan minimal agar modul src yang transitif memuat config/env.ts
 * (lewat logger) dapat di-import oleh unit test tanpa database dan tanpa
 * bergantung pada file .env pengembang. Nilai di sini dummy dan hanya hidup
 * di proses test — rahasia nyata tidak pernah ditulis di sini.
 *
 * Wajib di-import PERTAMA (paling atas) oleh file test yang memuat modul src
 * secara statis; urutan import ESM menentukan kapan env diparse.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public";
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-ppob-unit-tests-64-chars";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-ppob-unit-tests-64-chars";
process.env.MIDTRANS_SNAP_URL =
  process.env.MIDTRANS_SNAP_URL ?? "http://127.0.0.1:59999/snap/v1/transactions";
