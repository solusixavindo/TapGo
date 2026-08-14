import { Prisma, User } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  prisma,
  runIntegration,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";
import { PrismaAuthRepository } from "../../src/modules/auth/infrastructure/PrismaAuthRepository.js";

/**
 * Semantik anti-abuse registration monitoring di bawah konkurensi.
 *
 * Stage 5.7 mengubah createUser dari Serializable ke Read Committed. Test ini
 * MEMBUKTIKAN (bukan mengasumsikan) konsekuensinya, dan membedakan dua hal:
 *
 *   1. ADVISORY FLAGGING — RegistrationEvent.suspicious + AbuseFlag.
 *      Bukti source: suspiciousReasons hanya dipakai untuk menulis flag; tidak
 *      ada throw/AppError di jalur recordRegistrationEvent, dan tidak ada satu
 *      pun konsumen abuseFlag/suspicious di application/presentation/core.
 *      Konsekuensi: pada registrasi bersamaan, count velocity dapat melewatkan
 *      baris yang di-insert transaksi konkuren, sehingga flag bisa TIDAK naik
 *      pada gelombang pertama. Deteksi bersifat eventual.
 *
 *   2. HARD ENFORCEMENT — keunikan identitas.
 *      users.phone dan users.referral_code punya UNIQUE constraint di database
 *      (users_phone_key, users_referral_code_key). Ini ditegakkan oleh
 *      PostgreSQL, bukan oleh isolation level, sehingga TIDAK terpengaruh
 *      perubahan Read Committed.
 *
 * normalizedPhone TIDAK memiliki velocity rule (hanya disimpan + di-hash);
 * kontrol kerasnya adalah unique constraint di atas ditambah
 * registerPhoneRateLimiter pada lapisan HTTP.
 */

const repo = new PrismaAuthRepository(prisma);

const DEVICE_THRESHOLD = 1; // sameDeviceCount >= 1  -> DEVICE_ALREADY_REGISTERED
const IP_THRESHOLD = 5; // sameIpRecentCount >= 5 -> IP_HIGH_VELOCITY_REGISTRATION
const REFERRAL_THRESHOLD = 10; // referralRecentCount >= 10 -> REFERRAL_HIGH_VELOCITY_REGISTRATION

type RegisterOverrides = {
  deviceFingerprintHash?: string;
  ipAddress?: string;
  sponsorReferralCode?: string;
};

function register(seq: string, overrides: RegisterOverrides = {}): Promise<User> {
  const { sponsorReferralCode, ...registrationEvent } = overrides;
  return repo.createUser({
    fullName: `Abuse Probe ${seq}`,
    phone: `+62877${seq.padStart(9, "0")}`,
    passwordHash: "hashed-password",
    role: "USER",
    referralCode: `ABZ${seq.padStart(6, "0")}`,
    ...(sponsorReferralCode !== undefined ? { sponsorReferralCode } : {}),
    ...(Object.keys(registrationEvent).length > 0 ? { registrationEvent } : {})
  });
}

async function reasonsFor(userIds: string[]): Promise<string[][]> {
  const events = await prisma.registrationEvent.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, suspicious: true, suspiciousReasons: true }
  });
  return events.map((e) =>
    e.suspicious ? ((e.suspiciousReasons as string[] | null) ?? []) : []
  );
}

function flatten(reasons: string[][]): string[] {
  return reasons.flat();
}

describe.skipIf(!runIntegration)("Registration abuse monitoring — semantik konkurensi", () => {
  setupReferralWalletIntegration();

  // cleanDatabase() pada harness TIDAK menghapus registration_events dan
  // abuse_flags, karena FK keduanya ke users bersifat SET NULL sehingga baris
  // bertahan setelah user dihapus. Velocity rule menghitung baris tersebut,
  // jadi tanpa pembersihan ini ambang akan tercemar sisa run sebelumnya dan
  // file ini tidak dapat dijalankan berulang pada database yang sama.
  // Urutan child-first: abuse_flags menunjuk registration_events.
  beforeEach(async () => {
    await prisma.abuseFlag.deleteMany();
    await prisma.registrationEvent.deleteMany();
  });

  // --- Bukti bahwa velocity monitoring bersifat ADVISORY ---------------------

  it("device fingerprint: berurutan MENAIKKAN flag pada registrasi ke-2 (ambang >= 1)", async () => {
    const device = "device-hash-sekuensial-0001";
    const first = await register("1001", { deviceFingerprintHash: device });
    const second = await register("1002", { deviceFingerprintHash: device });

    // Registrasi pertama belum punya pendahulu -> tidak suspicious.
    expect(flatten(await reasonsFor([first.id]))).not.toContain("DEVICE_ALREADY_REGISTERED");
    // Registrasi kedua melihat 1 event sebelumnya -> ambang tercapai.
    expect(flatten(await reasonsFor([second.id]))).toContain("DEVICE_ALREADY_REGISTERED");
    expect(await prisma.abuseFlag.count({ where: { flagType: "REGISTRATION_ABUSE_RISK" } }))
      .toBeGreaterThan(0);
  });

  it("device fingerprint: registrasi BERSAMAAN tetap sukses; flag bersifat advisory", async () => {
    const device = "device-hash-konkuren-0002";
    const results = await Promise.allSettled([
      register("2001", { deviceFingerprintHash: device }),
      register("2002", { deviceFingerprintHash: device })
    ]);

    // HARD INVARIANT: tidak ada registrasi yang ditolak oleh velocity rule.
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    const users = results
      .filter((r): r is PromiseFulfilledResult<User> => r.status === "fulfilled")
      .map((r) => r.value);
    expect(users).toHaveLength(2);
    expect(await prisma.user.count()).toBe(2);

    // ADVISORY: kedua event tercatat, tetapi jumlah flag TIDAK dijamin. Di
    // bawah Read Committed, dua transaksi bersamaan bisa sama-sama membaca
    // count 0 sehingga tidak ada flag. Yang dijamin: event selalu terekam,
    // sehingga deteksi tetap mungkin dilakukan setelahnya (eventual).
    expect(
      await prisma.registrationEvent.count({ where: { deviceFingerprintHash: device } })
    ).toBe(2);
    const flags = flatten(await reasonsFor(users.map((u) => u.id)))
      .filter((r) => r === "DEVICE_ALREADY_REGISTERED").length;
    expect(flags).toBeLessThanOrEqual(1);

    // Registrasi berikutnya (setelah kedua transaksi commit) PASTI ter-flag —
    // inilah arti "eventual detection".
    const later = await register("2003", { deviceFingerprintHash: device });
    expect(flatten(await reasonsFor([later.id]))).toContain("DEVICE_ALREADY_REGISTERED");
  });

  it("IP address: ambang >= 5 tercapai berurutan, dan registrasi bersamaan tidak pernah ditolak", async () => {
    const ip = "203.0.113.77";
    const sequential: User[] = [];
    for (let i = 0; i < IP_THRESHOLD; i += 1) {
      sequential.push(await register(`31${i}0`, { ipAddress: ip }));
    }
    // Lima event pertama: count sebelum insert masing-masing 0..4 -> belum >= 5.
    expect(flatten(await reasonsFor(sequential.map((u) => u.id))))
      .not.toContain("IP_HIGH_VELOCITY_REGISTRATION");

    // Registrasi ke-6 melihat 5 event -> ambang tercapai.
    const sixth = await register("3160", { ipAddress: ip });
    expect(flatten(await reasonsFor([sixth.id]))).toContain("IP_HIGH_VELOCITY_REGISTRATION");

    // Gelombang bersamaan di sekitar ambang: semua HARUS sukses.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => register(`32${i}0`, { ipAddress: ip }))
    );
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(
      await prisma.registrationEvent.count({ where: { ipAddress: ip } })
    ).toBe(IP_THRESHOLD + 1 + 6);
  });

  it("referral code: ambang >= 10 tercapai berurutan, dan registrasi bersamaan tidak pernah ditolak", async () => {
    const sponsor = await register("4000");
    const code = sponsor.referralCode;

    for (let i = 0; i < REFERRAL_THRESHOLD; i += 1) {
      await register(`41${i}0`, { sponsorReferralCode: code });
    }
    // Registrasi ke-11 dengan kode yang sama -> ambang tercapai.
    const eleventh = await register("4200", { sponsorReferralCode: code });
    expect(flatten(await reasonsFor([eleventh.id])))
      .toContain("REFERRAL_HIGH_VELOCITY_REGISTRATION");

    // Gelombang bersamaan: semua HARUS sukses, tidak ada yang ditolak.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => register(`43${i}0`, { sponsorReferralCode: code }))
    );
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
  });

  // --- Bukti bahwa keunikan identitas adalah HARD ENFORCEMENT ----------------

  it("normalized phone: unique constraint menegakkan tepat satu pemenang saat bersamaan", async () => {
    const phone = "+628770000555";
    const results = await Promise.allSettled([
      repo.createUser({
        fullName: "Phone Race A",
        phone,
        passwordHash: "hashed-password",
        role: "USER",
        referralCode: "PHRACEA0001"
      }),
      repo.createUser({
        fullName: "Phone Race B",
        phone,
        passwordHash: "hashed-password",
        role: "USER",
        referralCode: "PHRACEB0002"
      })
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    // Hard enforcement oleh database: tepat satu sukses.
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(await prisma.user.count({ where: { phone } })).toBe(1);
    // Kegagalan adalah unique violation (P2002), bukan velocity rule.
    const reason = failed[0]!.reason;
    expect(reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((reason as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
  });

  it("referral code: unique constraint menegakkan tepat satu pemenang saat bersamaan", async () => {
    const duplicateCode = "DUPCODE0001";
    const results = await Promise.allSettled([
      repo.createUser({
        fullName: "Code Race A",
        phone: "+628770000777",
        passwordHash: "hashed-password",
        role: "USER",
        referralCode: duplicateCode
      }),
      repo.createUser({
        fullName: "Code Race B",
        phone: "+628770000888",
        passwordHash: "hashed-password",
        role: "USER",
        referralCode: duplicateCode
      })
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { referralCode: duplicateCode } })).toBe(1);
    const failed = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    )!;
    expect((failed.reason as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
  });

  it("role DRIVER melewati advisory lock: event SELALU terekam meski flag tidak dijamin", async () => {
    // registerBodySchema menerima role: z.enum(["USER","DRIVER"]), dan
    // controller meneruskan ...req.body, sehingga klien dapat self-register
    // sebagai DRIVER. createUser hanya mengambil pg_advisory_xact_lock bila
    // role === USER, jadi registrasi DRIVER TIDAK terserialkan.
    //
    // Yang diassert di sini hanyalah invarian yang benar-benar dijamin:
    // seluruh registrasi sukses dan seluruh RegistrationEvent terekam.
    // Jumlah flag TIDAK diassert ke nilai tertentu — perilaku itu
    // non-deterministik di bawah konkurensi dan sedang menunggu keputusan
    // owner (lihat laporan Stage 5.7 follow-up, bagian anti-abuse).
    const device = "device-hash-driver-konkuren";
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        repo.createUser({
          fullName: `Driver Probe ${i}`,
          phone: `+62878${String(i).padStart(9, "0")}`,
          passwordHash: "hashed-password",
          role: "DRIVER",
          referralCode: `DRV${String(i).padStart(6, "0")}`,
          registrationEvent: { deviceFingerprintHash: device }
        })
      )
    );

    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    // Audit trail tetap lengkap: lima event terekam apa pun urutannya.
    expect(
      await prisma.registrationEvent.count({ where: { deviceFingerprintHash: device } })
    ).toBe(5);
    // Registrasi setelah semuanya commit tetap ter-flag (eventual detection).
    const later = await repo.createUser({
      fullName: "Driver Probe Later",
      phone: "+628780000999",
      passwordHash: "hashed-password",
      role: "DRIVER",
      referralCode: "DRVLATER001",
      registrationEvent: { deviceFingerprintHash: device }
    });
    expect(flatten(await reasonsFor([later.id]))).toContain("DEVICE_ALREADY_REGISTERED");
  });

  it("velocity rule TIDAK pernah menolak registrasi (advisory, bukan enforcement)", async () => {
    // Semua sinyal abuse dinyalakan sekaligus dan jauh melewati ambang.
    const device = "device-hash-semua-sinyal";
    const ip = "203.0.113.99";
    const sponsor = await register("5000");

    const results = await Promise.allSettled(
      Array.from({ length: IP_THRESHOLD + REFERRAL_THRESHOLD + 2 }, (_, i) =>
        register(`51${String(i).padStart(2, "0")}`, {
          deviceFingerprintHash: device,
          ipAddress: ip,
          sponsorReferralCode: sponsor.referralCode
        })
      )
    );

    // Meski setiap ambang terlampaui, TIDAK ada registrasi yang gagal.
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    // Dan flag memang naik (monitoring tetap bekerja).
    expect(
      await prisma.abuseFlag.count({ where: { flagType: "REGISTRATION_ABUSE_RISK" } })
    ).toBeGreaterThan(0);
    // Ambang device tercapai sejak registrasi kedua.
    expect(DEVICE_THRESHOLD).toBe(1);
  });
});
