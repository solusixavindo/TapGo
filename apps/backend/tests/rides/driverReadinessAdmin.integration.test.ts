import { UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { cleanDatabase, prisma, runIntegration } from "../helpers/referralWalletHarness.js";

/**
 * Konsol admin menampilkan kesiapan tiap driver menerima pesanan, dan pencarian akun VIP menampilkannya untuk satu
 * driver. Memakai aturan yang sama dengan penerimaan pesanan sungguhan.
 */
const describeIntegration = runIntegration ? describe : describe.skip;
let server: Server | undefined;
let baseUrl = "";
let sequence = 0;
let signAccessToken: (payload: { sub: string; role: UserRole; sessionId: string }) => string;
const mutableEnv = env as unknown as Record<string, unknown>;
const saved = { enabled: env.DRIVER_COMMISSION_ENABLED, min: env.DRIVER_MIN_CASH_BALANCE };

async function user(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Siap ${role} ${sequence}`,
      phone: `08129990${String(1000 + sequence)}`,
      referralCode: `RDY${String(sequence).padStart(6, "0")}`,
      role,
      status: "ACTIVE"
    }
  });
}
const tokenOf = (u: { id: string; role: UserRole }) => signAccessToken({ sub: u.id, role: u.role, sessionId: `s-${u.id}` });
const get = async (path: string, token: string) => {
  const response = await fetch(`${baseUrl}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: (await response.json()) as { data?: any } };
};

async function driver(profileStatus: "ACTIVE" | "PENDING", balance: string | null, verified = true) {
  const account = await user("DRIVER");
  const profile = await prisma.rideDriverProfile.create({ data: { userId: account.id, status: profileStatus, availability: "ONLINE", lastSeenAt: new Date() } });
  await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: "MOTORCYCLE",
      plateNumberHash: `hash-${account.id}`,
      plateNumberMasked: "B ****",
      verificationStatus: verified ? "VERIFIED" : "PENDING",
      isActive: true
    }
  });
  if (balance !== null) await prisma.wallet.create({ data: { userId: account.id, balance, cashBalance: balance } });
  return { account, profile };
}

describeIntegration("Kesiapan driver di konsol admin", () => {
  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-please-change-000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-please-change-00000";
    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    mutableEnv.DRIVER_COMMISSION_ENABLED = saved.enabled;
    mutableEnv.DRIVER_MIN_CASH_BALANCE = saved.min;
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await cleanDatabase();
    mutableEnv.DRIVER_COMMISSION_ENABLED = true;
    mutableEnv.DRIVER_MIN_CASH_BALANCE = 0;
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.adminRateLimiter.resetKey(key);
      limiters.apiRateLimiter.resetKey(key);
    }
  });

  it("daftar driver admin memuat kesiapan: siap, belum diaktifkan, saldo nol, kendaraan belum terverifikasi", async () => {
    const admin = await user("ADMIN");
    const ready = await driver("ACTIVE", "50000.00");
    const pending = await driver("PENDING", "50000.00");
    const broke = await driver("ACTIVE", null);
    const noVehicle = await driver("ACTIVE", "50000.00", false);

    const list = await get("/admin/rides/drivers", tokenOf(admin));
    expect(list.status).toBe(200);
    const byId = new Map<string, any>(list.body.data.map((row: any) => [row.profileId, row]));

    expect(byId.get(ready.profile.id).readiness).toMatchObject({ canAccept: true, blockers: [] });
    expect(byId.get(pending.profile.id).readiness.blockers.map((b: any) => b.code)).toEqual(["RIDE_DRIVER_NOT_ACTIVE"]);
    expect(byId.get(broke.profile.id).readiness.blockers.map((b: any) => b.code)).toEqual(["RIDE_COMMISSION_BALANCE_INSUFFICIENT"]);
    expect(byId.get(noVehicle.profile.id).readiness.blockers.map((b: any) => b.code)).toEqual(["RIDE_VEHICLE_NOT_ELIGIBLE"]);
    // Data pribadi tetap tersamar dan userId internal tidak ikut keluar.
    expect(JSON.stringify(list.body.data)).not.toContain(ready.account.id);
  });

  it("pencarian akun VIP menampilkan kesiapan satu driver; komisi dimatikan menghilangkan penghalang saldo", async () => {
    const vip = await user("SUPER_ADMIN_VIP");
    const broke = await driver("ACTIVE", "0.00");

    const found = await get(`/admin/account-assist?phone=${broke.account.phone}`, tokenOf(vip));
    expect(found.status).toBe(200);
    expect(found.body.data.driver.readiness.canAccept).toBe(false);
    expect(found.body.data.driver.readiness.blockers[0].code).toBe("RIDE_COMMISSION_BALANCE_INSUFFICIENT");

    mutableEnv.DRIVER_COMMISSION_ENABLED = false;
    const after = await get(`/admin/account-assist?phone=${broke.account.phone}`, tokenOf(vip));
    expect(after.body.data.driver.readiness.canAccept).toBe(true);
  });
});
