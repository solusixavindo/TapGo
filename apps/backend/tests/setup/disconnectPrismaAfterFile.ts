import { afterAll } from "vitest";
import { prisma, runIntegration } from "../helpers/referralWalletHarness.js";

/**
 * Menutup connection pool bersama (referralWalletHarness.ts) di akhir SETIAP
 * file test, otomatis untuk seluruh suite — tanpa perlu menyentuh puluhan
 * file test satu per satu.
 *
 * Akar masalah: suite ini berjalan serial dalam satu proses (fileParallelism:
 * false, singleFork: true di vitest.config.ts), tapi isolate:true (default
 * vitest) tetap memberi tiap file MODUL segar — termasuk harness ini, yang
 * mengekspor `prisma` sebagai singleton per-file. Mayoritas file test HANYA
 * mengimpor `prisma`/`cleanDatabase` langsung tanpa memanggil
 * setupReferralWalletIntegration() (yang men-disconnect di afterAll-nya
 * sendiri), sehingga PrismaClient/connection-pool setiap file itu tidak
 * pernah ditutup — menumpuk sepanjang suite berjalan sampai Postgres
 * menolak dengan "too many clients already" (baru kena di CI, bukan di
 * workstation lokal yang kebetulan sempat menanggung penumpukan itu).
 *
 * setupFiles vitest berjalan sebelum SETIAP file test (tetap menghormati
 * isolate:true, bukan sekali untuk seluruh run seperti globalSetup), jadi
 * afterAll di sini otomatis terpasang per file dan menutup pool milik file
 * itu SEBELUM file berikutnya membuat pool barunya. $disconnect() aman
 * dipanggil dobel (mis. oleh file yang sudah punya afterAll sendiri lewat
 * setupReferralWalletIntegration()) — idempoten, tidak melempar error.
 */
afterAll(async () => {
  if (!runIntegration) return;
  await prisma.$disconnect();

  // Pool milik APLIKASI (src/config/prisma.ts) dipakai berkas yang menyalakan
  // createApp() dan juga tidak pernah ditutup. Pool itu ikut menumpuk antar
  // berkas (connection_limit di CI = 25 per pool) sampai Postgres menolak
  // dengan "too many clients already" — penyebab kegagalan acak di berkas yang
  // kebetulan berjalan belakangan. Mengimpor modul ini aman walau berkas
  // tidak memakainya: klien baru tidak membuka koneksi sampai dipakai.
  try {
    const { disconnectPrisma } = await import("../../src/config/prisma.js");
    await disconnectPrisma();
  } catch {
    // Berkas unit tanpa environment lengkap: tidak ada pool aplikasi untuk ditutup.
  }
});
