import { Prisma, PrismaClient, User } from "@prisma/client";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/core/errors/AppError.js";
import { PrismaAuthRepository } from "../../src/modules/auth/infrastructure/PrismaAuthRepository.js";
import {
  decimalString,
  prisma,
  registerBasicUser,
  runIntegration,
  setRegistrationQuotaGranted,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";

const QUOTA_KEY = "BASIC_PPOB_FIRST_1000";

function fulfilledUsers(results: PromiseSettledResult<User>[]): User[] {
  return results
    .filter((r): r is PromiseFulfilledResult<User> => r.status === "fulfilled")
    .map((r) => r.value);
}

/**
 * Diagnostik kegagalan konkurensi.
 *
 * Promise.allSettled sebelumnya menelan seluruh alasan penolakan sehingga
 * kegagalan hanya terlihat sebagai "expected 20, got 19". Helper ini
 * mengekstrak identitas error secara AMAN: hanya nama class, Prisma error
 * code, dan meta.code/meta.modelName. Pesan asli, parameter SQL, nomor
 * telepon, dan PII lain TIDAK pernah ditulis ke output.
 */
function describeRejections(results: PromiseSettledResult<User>[]): string {
  const rejected = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  );
  if (rejected.length === 0) {
    return "none";
  }

  const details = rejected.map((r, index) => {
    const error = r.reason as unknown;
    const parts: string[] = [`#${index}`];

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      parts.push("PrismaClientKnownRequestError", `code=${error.code}`);
      const meta = error.meta as { code?: string; modelName?: string } | undefined;
      if (meta?.code) parts.push(`meta.code=${meta.code}`);
      if (meta?.modelName) parts.push(`meta.modelName=${meta.modelName}`);
    } else if (error instanceof Error) {
      parts.push(error.constructor.name, `name=${error.name}`);
      // Hanya kelas pesan yang sudah diketahui aman (tanpa nilai/PII).
      const known = [
        "Unable to start a transaction",
        "Transaction already closed",
        "Transaction not found",
        "Timed out fetching a new connection",
        "write conflict or a deadlock",
        "could not serialize access"
      ].find((needle) => error.message.includes(needle));
      parts.push(`class=${known ?? "UNCLASSIFIED"}`);
      if (!known) {
        // Fingerprint stabil agar kemunculan berikutnya dapat dikorelasikan
        // tanpa memancarkan isi pesan (yang bisa memuat nilai/PII).
        parts.push(
          `msgLen=${error.message.length}`,
          `msgSha=${createHash("sha256").update(error.message).digest("hex").slice(0, 12)}`
        );
      }
      // attempt number bila operasi mengeksposnya
      const attempt = (error as { attempt?: number }).attempt;
      if (typeof attempt === "number") parts.push(`attempt=${attempt}`);
    } else {
      parts.push(`nonError=${typeof error}`);
    }

    return parts.join(" ");
  });

  return `${rejected.length} rejected -> ${details.join(" | ")}`;
}

describe.skipIf(!runIntegration)("P1-4 Basic first-1000 registration quota concurrency", () => {
  setupReferralWalletIntegration();

  it("grants the last slot to exactly one of two racing registrations", async () => {
    // Sisa tepat 1 slot benefit.
    await setRegistrationQuotaGranted(999);

    const results = await Promise.allSettled([
      registerBasicUser("RACEA000001"),
      registerBasicUser("RACEB000002")
    ]);
    const users = fulfilledUsers(results);
    expect(users).toHaveLength(2);

    const wallets = await Promise.all(
      users.map((u) => prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } }))
    );
    const ppob = wallets.map((w) => decimalString(w.ppobBalance)).sort();
    // Tepat satu penerima Rp5.000, satu lagi Rp0 — tidak ada double credit.
    expect(ppob).toEqual(["0.00", "5000.00"]);

    const quota = await prisma.registrationQuota.findUniqueOrThrow({ where: { key: QUOTA_KEY } });
    expect(quota.granted).toBe(1000);
    expect(quota.granted).toBeLessThanOrEqual(quota.limit);

    const bonusCount = await prisma.walletTransaction.count({ where: { type: "REGISTRATION_BONUS" } });
    expect(bonusCount).toBe(1);
  });

  it("does not grant benefit once quota is full (user #1001)", async () => {
    await setRegistrationQuotaGranted(1000);

    const user = await registerBasicUser("RACEFULL0001");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decimalString(wallet.ppobBalance)).toBe("0.00");

    const quota = await prisma.registrationQuota.findUniqueOrThrow({ where: { key: QUOTA_KEY } });
    expect(quota.granted).toBe(1000);
  });

  it("never exceeds the limit under many concurrent registrations at the boundary", async () => {
    // Sisa 5 slot, tetapi 20 registrasi berlomba bersamaan.
    await setRegistrationQuotaGranted(995);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => registerBasicUser(`RACEM${String(i).padStart(6, "0")}`))
    );

    // Tidak boleh ada satu pun promise yang ditolak. Bila ada, identitas error
    // dilaporkan (class + Prisma code + meta.code) tanpa PII.
    const rejectionReport = describeRejections(results);
    expect(rejectionReport, `registrasi gagal: ${rejectionReport}`).toBe("none");

    const users = fulfilledUsers(results);
    expect(users).toHaveLength(20);

    // Setiap registrasi sukses membuat tepat satu user (tidak ada duplikat/hilang).
    expect(new Set(users.map((u) => u.id)).size).toBe(20);
    expect(await prisma.user.count()).toBe(20);

    const wallets = await Promise.all(
      users.map((u) => prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } }))
    );
    // Satu wallet per user — tidak ada wallet ganda.
    expect(await prisma.wallet.count()).toBe(20);

    const grantedCount = wallets.filter((w) => decimalString(w.ppobBalance) === "5000.00").length;
    // Hanya 5 slot tersisa -> tepat 5 penerima, sisanya Rp0.
    expect(grantedCount).toBe(5);
    // Tidak ada nilai PPOB di luar {0, 5000} (mis. 10000 = double credit).
    expect(
      [...new Set(wallets.map((w) => decimalString(w.ppobBalance)))].sort()
    ).toEqual(["0.00", "5000.00"]);

    const quota = await prisma.registrationQuota.findUniqueOrThrow({ where: { key: QUOTA_KEY } });
    expect(quota.granted).toBe(1000);
    expect(quota.granted).toBeLessThanOrEqual(quota.limit);

    const bonusCount = await prisma.walletTransaction.count({ where: { type: "REGISTRATION_BONUS" } });
    expect(bonusCount).toBe(5);
    // Tidak ada dua REGISTRATION_BONUS untuk wallet yang sama.
    const bonusRows = await prisma.walletTransaction.findMany({
      where: { type: "REGISTRATION_BONUS" },
      select: { walletId: true }
    });
    expect(new Set(bonusRows.map((b) => b.walletId)).size).toBe(5);
  });

  it("eksekusi berulang dalam satu proses tidak membocorkan state kuota", async () => {
    // Dua gelombang identik. Gelombang kedua harus menghasilkan angka yang
    // sama persis, membuktikan tidak ada sisa state dari gelombang pertama.
    for (const wave of [1, 2]) {
      await prisma.walletTransaction.deleteMany();
      await prisma.wallet.deleteMany();
      await prisma.user.deleteMany();
      await setRegistrationQuotaGranted(995);

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          registerBasicUser(`WAVE${wave}${String(i).padStart(6, "0")}`)
        )
      );
      const report = describeRejections(results);
      expect(report, `gelombang ${wave} gagal: ${report}`).toBe("none");

      const users = fulfilledUsers(results);
      expect(users).toHaveLength(20);

      const wallets = await Promise.all(
        users.map((u) => prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } }))
      );
      expect(wallets.filter((w) => decimalString(w.ppobBalance) === "5000.00")).toHaveLength(5);

      const quota = await prisma.registrationQuota.findUniqueOrThrow({ where: { key: QUOTA_KEY } });
      expect(quota.granted).toBe(1000);
      expect(quota.granted).toBeLessThanOrEqual(quota.limit);
    }
  });

  it("retry exhaustion mengembalikan AppError terkendali, bukan error Prisma mentah", async () => {
    // Simulasikan kegagalan serialisasi yang tidak pernah pulih agar seluruh
    // attempt habis. Kontraknya: klien menerima AppError 503 dengan kode stabil,
    // BUKAN PrismaClientKnownRequestError.
    const serializationFailure = new Prisma.PrismaClientKnownRequestError(
      "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
      { code: "P2034", clientVersion: "5.22.0" }
    );
    let attempts = 0;
    const alwaysConflicting = {
      $transaction: async () => {
        attempts += 1;
        throw serializationFailure;
      }
    } as unknown as PrismaClient;

    const repo = new PrismaAuthRepository(alwaysConflicting);
    const failure = await repo
      .createUser({
        fullName: "Exhaustion Probe",
        phone: "+628999000111",
        passwordHash: "hashed-password",
        role: "USER",
        referralCode: "EXHAUST0001"
      })
      .then(() => undefined)
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).not.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const appError = failure as AppError;
    expect(appError.statusCode).toBe(503);
    expect(appError.code).toBe("REGISTRATION_TEMPORARILY_UNAVAILABLE");
    // Pesan tidak boleh membocorkan detail internal database.
    expect(appError.message).not.toMatch(/prisma|transaction|conflict|deadlock/i);
    // Retry benar-benar bounded (tidak tak-hingga).
    expect(attempts).toBe(8);
  });
});
