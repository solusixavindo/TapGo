import { User } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  prisma,
  runIntegration,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";
import { PrismaAuthRepository } from "../../src/modules/auth/infrastructure/PrismaAuthRepository.js";

/**
 * Keyed transaction-scoped advisory locking untuk sinyal anti-abuse.
 *
 * Sebelum Stage 5.8, evaluasi velocity berjalan tanpa serialisasi per-key:
 * dua registrasi bersamaan yang berbagi device/IP/kode referral dapat
 * sama-sama membaca count lama sehingga flag hilang (terukur: 5 registrasi
 * DRIVER bersamaan menghasilkan 0 flag pada 87% round).
 *
 * Sekarang recordRegistrationEvent mengambil pg_advisory_xact_lock ber-namespace
 * per sinyal, di-dedupe dan diurutkan deterministik, sehingga blok
 * count -> evaluate -> write bersifat sequentially consistent.
 *
 * Kebijakan TIDAK berubah: monitoring tetap advisory, tidak pernah menolak
 * registrasi. Keunikan tetap ditegakkan constraint database.
 */

const repo = new PrismaAuthRepository(prisma);

const DEVICE_THRESHOLD = 1;
const IP_THRESHOLD = 5;
const REFERRAL_THRESHOLD = 10;

type Signals = {
  deviceFingerprintHash?: string;
  ipAddress?: string;
  sponsorReferralCode?: string;
};

let seq = 0;

function register(signals: Signals = {}): Promise<User> {
  seq += 1;
  const tag = String(seq).padStart(7, "0");
  const { sponsorReferralCode, ...registrationEvent } = signals;
  return repo.createUser({
    fullName: `Lock Probe ${tag}`,
    phone: `+62856${tag.padStart(9, "0")}`,
    passwordHash: "hashed-password",
    role: "DRIVER", // sengaja melewati global PPOB quota lock
    referralCode: `LK${tag}`,
    ...(sponsorReferralCode !== undefined ? { sponsorReferralCode } : {}),
    ...(Object.keys(registrationEvent).length > 0 ? { registrationEvent } : {})
  });
}

function fulfilled(results: PromiseSettledResult<User>[]): User[] {
  return results
    .filter((r): r is PromiseFulfilledResult<User> => r.status === "fulfilled")
    .map((r) => r.value);
}

function rejections(results: PromiseSettledResult<User>[]): string[] {
  return results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => {
      const e = r.reason as { code?: string; constructor?: { name?: string } };
      return e?.code ?? e?.constructor?.name ?? "unknown";
    });
}

describe.skipIf(!runIntegration)("Keyed advisory locking sinyal anti-abuse", () => {
  setupReferralWalletIntegration();

  // registration_events dan abuse_flags tidak dihapus cleanDatabase() (FK ke
  // users SET NULL), sehingga harus dibersihkan child-first agar file ini bisa
  // dijalankan berulang pada database yang sama.
  beforeEach(async () => {
    await prisma.abuseFlag.deleteMany();
    await prisma.registrationEvent.deleteMany();
  });

  it("8. device key: registrasi bersamaan menghasilkan evaluasi sequentially consistent", async () => {
    const device = "lock-device-key-0001";
    const N = 5;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => register({ deviceFingerprintHash: device }))
    );

    expect(rejections(results)).toEqual([]);
    expect(fulfilled(results)).toHaveLength(N);
    // 14. tidak ada RegistrationEvent yang hilang.
    expect(
      await prisma.registrationEvent.count({ where: { deviceFingerprintHash: device } })
    ).toBe(N);
    // Ambang device >= 1: registrasi pertama tidak ter-flag, sisanya ter-flag.
    expect(
      await prisma.registrationEvent.count({
        where: { deviceFingerprintHash: device, suspicious: true }
      })
    ).toBe(N - DEVICE_THRESHOLD);
  });

  it("9. IP key: registrasi bersamaan menghasilkan evaluasi sequentially consistent", async () => {
    const ip = "198.51.100.31";
    const N = IP_THRESHOLD + 1;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => register({ ipAddress: ip }))
    );

    expect(rejections(results)).toEqual([]);
    expect(await prisma.registrationEvent.count({ where: { ipAddress: ip } })).toBe(N);
    // Ambang IP >= 5: hanya registrasi ke-6 yang melihat 5 event sebelumnya.
    expect(
      await prisma.registrationEvent.count({ where: { ipAddress: ip, suspicious: true } })
    ).toBe(N - IP_THRESHOLD);
  });

  it("10. referral key: registrasi bersamaan menghasilkan evaluasi sequentially consistent", async () => {
    const sponsor = await register();
    const code = sponsor.referralCode;

    // Isi hingga tepat di bawah ambang secara berurutan.
    for (let i = 0; i < REFERRAL_THRESHOLD; i += 1) {
      await register({ sponsorReferralCode: code });
    }

    const N = 4;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => register({ sponsorReferralCode: code }))
    );

    expect(rejections(results)).toEqual([]);
    // Seluruh N registrasi melihat >= 10 event sebelumnya -> semuanya ter-flag.
    const flagged = await prisma.registrationEvent.count({
      where: { referralCodeUsed: code, suspicious: true }
    });
    expect(flagged).toBe(N);
    expect(
      await prisma.registrationEvent.count({ where: { referralCodeUsed: code } })
    ).toBe(REFERRAL_THRESHOLD + N);
  });

  it("11. kombinasi key yang tumpang-tindih tidak menimbulkan deadlock", async () => {
    // Setiap registrasi memakai sebagian key yang beririsan dengan yang lain.
    // Tanpa urutan pengambilan lock yang deterministik, pola ini adalah
    // pemicu deadlock klasik.
    const devA = "lock-dev-A";
    const devB = "lock-dev-B";
    const ipA = "198.51.100.41";
    const ipB = "198.51.100.42";
    const sponsor = await register();
    const code = sponsor.referralCode;

    const combos: Signals[] = [
      { deviceFingerprintHash: devA, ipAddress: ipA },
      { ipAddress: ipA, sponsorReferralCode: code },
      { deviceFingerprintHash: devB, ipAddress: ipA, sponsorReferralCode: code },
      { deviceFingerprintHash: devA, ipAddress: ipB, sponsorReferralCode: code },
      { sponsorReferralCode: code, deviceFingerprintHash: devB },
      { ipAddress: ipB, deviceFingerprintHash: devA },
      { deviceFingerprintHash: devB, ipAddress: ipB, sponsorReferralCode: code },
      { ipAddress: ipA, deviceFingerprintHash: devB }
    ];

    const results = await Promise.allSettled(combos.map((c) => register(c)));
    // 13. tidak ada kegagalan akibat kontensi lock (deadlock akan muncul
    // sebagai P2034/40P01 di sini).
    expect(rejections(results)).toEqual([]);
    expect(fulfilled(results)).toHaveLength(combos.length);
  });

  it("12. sepuluh round konkurensi berulang tetap konsisten dan tanpa kegagalan", async () => {
    for (let round = 0; round < 10; round += 1) {
      await prisma.abuseFlag.deleteMany();
      await prisma.registrationEvent.deleteMany();

      const device = `lock-round-device-${round}`;
      const ip = `198.51.100.${100 + round}`;
      const N = 5;
      const results = await Promise.allSettled(
        Array.from({ length: N }, () =>
          register({ deviceFingerprintHash: device, ipAddress: ip })
        )
      );

      expect(rejections(results), `round ${round}`).toEqual([]);
      expect(
        await prisma.registrationEvent.count({ where: { deviceFingerprintHash: device } }),
        `round ${round} event`
      ).toBe(N);
      expect(
        await prisma.registrationEvent.count({
          where: { deviceFingerprintHash: device, suspicious: true }
        }),
        `round ${round} flag`
      ).toBe(N - DEVICE_THRESHOLD);
    }
  });

  it("15/16. registrasi gagal me-rollback seluruh tulisan terkait", async () => {
    const device = "lock-rollback-device";
    const okUser = await register({ deviceFingerprintHash: device });
    const usersBefore = await prisma.user.count();
    const walletsBefore = await prisma.wallet.count();
    const eventsBefore = await prisma.registrationEvent.count();
    const flagsBefore = await prisma.abuseFlag.count();

    // Paksa kegagalan di tengah transaksi lewat pelanggaran unique phone.
    const failure = await repo
      .createUser({
        fullName: "Rollback Probe",
        phone: okUser.phone,
        passwordHash: "hashed-password",
        role: "DRIVER",
        referralCode: "LKROLLBACK1",
        registrationEvent: { deviceFingerprintHash: device }
      })
      .then(() => undefined)
      .catch((e: unknown) => e);

    expect(failure).toBeDefined();
    // Tidak ada tulisan parsial: user, wallet, event, maupun flag.
    expect(await prisma.user.count()).toBe(usersBefore);
    expect(await prisma.wallet.count()).toBe(walletsBefore);
    expect(await prisma.registrationEvent.count()).toBe(eventsBefore);
    expect(await prisma.abuseFlag.count()).toBe(flagsBefore);
    expect(await prisma.user.count({ where: { referralCode: "LKROLLBACK1" } })).toBe(0);

    // Lock transaction-scoped sudah dilepas oleh ROLLBACK: registrasi
    // berikutnya dengan key yang sama tetap berjalan normal.
    const after = await register({ deviceFingerprintHash: device });
    expect(after.id).toBeTruthy();
  });

  it("15. tidak ada duplikasi user/wallet/PPOB/abuse flag di luar semantik yang dimaksud", async () => {
    const device = "lock-dedupe-device";
    const N = 4;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => register({ deviceFingerprintHash: device }))
    );
    const users = fulfilled(results);
    expect(users).toHaveLength(N);

    // Satu user, satu wallet, satu event per registrasi.
    expect(new Set(users.map((u) => u.id)).size).toBe(N);
    expect(await prisma.wallet.count({ where: { userId: { in: users.map((u) => u.id) } } })).toBe(N);
    expect(
      await prisma.registrationEvent.count({ where: { deviceFingerprintHash: device } })
    ).toBe(N);

    // Satu AbuseFlag per event yang ter-flag (bukan berlipat).
    const flaggedEvents = await prisma.registrationEvent.count({
      where: { deviceFingerprintHash: device, suspicious: true }
    });
    expect(await prisma.abuseFlag.count()).toBe(flaggedEvents);

    // role DRIVER tidak mendapat slot kuota PPOB (hanya USER yang memakai slot).
    const wallets = await prisma.wallet.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
      select: { ppobBalance: true }
    });
    expect(wallets.every((w) => w.ppobBalance.toFixed(2) === "0.00")).toBe(true);
  });

  it("7. kebijakan tetap ADVISORY: sinyal jauh melewati ambang tidak menolak registrasi", async () => {
    const device = "lock-advisory-device";
    const ip = "198.51.100.77";
    const sponsor = await register();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        register({
          deviceFingerprintHash: device,
          ipAddress: ip,
          sponsorReferralCode: sponsor.referralCode
        })
      )
    );

    expect(rejections(results)).toEqual([]);
    expect(fulfilled(results)).toHaveLength(12);
    expect(await prisma.abuseFlag.count()).toBeGreaterThan(0);
  });
});
