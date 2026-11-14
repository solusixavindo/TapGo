import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Pemisahan kewenangan Super Admin / Super Admin VIP (keputusan Owner 14 Nov 2026): VIP memegang pembagian laba, koreksi
 * status perjalanan/driver, refund manual, dan pengawasan (log audit). Pencairan dan konfirmasi uang tetap di Super Admin. Tiap rute di tabel ini harus
 * ditolak untuk ADMIN dan Super Admin (403 persis), dan tidak ditolak untuk VIP (ditolak guard = 403, bukan validasi/404).
 */
type Endpoint = { method: string; path: string };
const ZERO = "00000000-0000-4000-8000-000000000000";

const VIP_ONLY: ReadonlyArray<Endpoint> = [
  { method: "POST", path: `/api/v1/admin/member-requests/${ZERO}/execute-refund` },
  { method: "POST", path: `/api/v1/admin/member-requests/${ZERO}/confirm-manual-refund` },
  { method: "POST", path: `/api/v1/admin/profit-sharing/periods/${ZERO}/approve` },
  { method: "POST", path: `/api/v1/admin/profit-sharing/periods/${ZERO}/distribute` },
  { method: "PATCH", path: "/api/v1/admin/rides/RID-NOTEXIST/status" },
  { method: "PATCH", path: `/api/v1/admin/rides/drivers/${ZERO}/status` },
  { method: "GET", path: "/api/v1/admin/audit-logs" },
  { method: "GET", path: "/api/v1/admin/dashboard/oversight" }
];

/**
 * Tetap boleh Super Admin. Keputusan Owner 14 Nov 2026: Owner (VIP) tidak memegang akses rekening perusahaan, jadi yang
 * memerlukan cek mutasi bank atau pencairan tetap di Super Admin, dan Owner mengawasi lewat Log Aktivitas dan peringatan.
 */
const SUPER_ADMIN_KEEPS: ReadonlyArray<Endpoint> = [
  { method: "POST", path: `/api/v1/admin/withdrawals/${ZERO}/paid` },
  { method: "POST", path: `/api/v1/wallet/admin/withdrawals/${ZERO}/paid` },
  { method: "POST", path: `/api/v1/admin/rewards/${ZERO}/mark-paid` },
  { method: "POST", path: "/api/v1/admin/driver-incentives" },
  { method: "PATCH", path: `/api/v1/admin/driver-incentives/${ZERO}` },
  { method: "POST", path: `/api/v1/admin/driver-incentives/claims/${ZERO}/reverse` },
  { method: "POST", path: `/api/v1/admin/manual-topups/${ZERO}/confirm` },
  { method: "POST", path: `/api/v1/admin/withdrawals/${ZERO}/approve` },
  { method: "POST", path: `/api/v1/admin/withdrawals/${ZERO}/reject` },
  { method: "POST", path: `/api/v1/admin/rewards/${ZERO}/approve` },
  { method: "POST", path: `/api/v1/admin/rewards/${ZERO}/reject` },
  { method: "POST", path: `/api/v1/admin/driver-incentives/claims/${ZERO}/approve` },
  { method: "POST", path: `/api/v1/admin/driver-incentives/claims/${ZERO}/reject` },
  { method: "POST", path: `/api/v1/admin/member-requests/${ZERO}/reject` },
  { method: "GET", path: "/api/v1/admin/reports/users.xlsx" }
];

let server: Server | undefined;
let baseUrl = "";
let sign: (payload: { sub: string; role: UserRole; sessionId: string; channel?: "WEB" | "APP" | "ADMIN" }) => string;
let resetLimits: () => void = () => {};
let seq = 0;

async function user(role: UserRole): Promise<User> {
  seq += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: { fullName: `Peran ${role} ${seq}`, phone: `+62899${String(1000000 + seq)}`, referralCode: `PRV${String(seq).padStart(6, "0")}`, role, membershipId: basic.id }
  });
}
const headers = (u: User, channel: "WEB" | "APP" | "ADMIN" = "ADMIN") => ({
  "content-type": "application/json",
  authorization: `Bearer ${sign({ sub: u.id, role: u.role, sessionId: `s-${u.id}`, channel })}`
});
const call = (e: Endpoint, u: User) =>
  fetch(`${baseUrl}${e.path}`, { method: e.method, headers: headers(u), ...(e.method === "GET" ? {} : { body: "{}" }) });

describe.skipIf(!runIntegration)("Pemisahan kewenangan Super Admin dan VIP", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) throw new Error("Need dedicated test DB");
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "privilege-split-access-secret-00000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "privilege-split-refresh-secret-0000";
    const [{ createApp }, tokenService, rate] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/core/security/rateLimit.js")
    ]);
    sign = tokenService.signAccessToken as typeof sign;
    const limiters = [rate.adminRateLimiter, rate.apiRateLimiter, rate.rideWriteRateLimiter] as unknown as Array<{ resetKey?: (k: string) => void }>;
    resetLimits = () => limiters.forEach((l) => ["127.0.0.1", "::ffff:127.0.0.1", "::1"].forEach((k) => l.resetKey?.(k)));
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    resetLimits();
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  it("rute khusus VIP: ADMIN dan Super Admin ditolak 403, VIP lolos penjaga peran", async () => {
    const admin = await user("ADMIN");
    const superAdmin = await user("SUPER_ADMIN");
    const vip = await user("SUPER_ADMIN_VIP");
    const wrong: string[] = [];
    for (const e of VIP_ONLY) {
      for (const [label, who] of [["ADMIN", admin], ["SUPER_ADMIN", superAdmin]] as const) {
        const s = (await call(e, who)).status;
        if (s !== 403) wrong.push(`${label} ${e.method} ${e.path} → ${s} (harus 403)`);
      }
      const v = (await call(e, vip)).status;
      if (v === 401 || v === 403) wrong.push(`VIP ${e.method} ${e.path} → ${v} (harus lolos penjaga)`);
    }
    expect(wrong).toEqual([]);
  });

  it("Super Admin tetap boleh menyetujui/menolak dan mengekspor (tidak ditolak penjaga peran)", async () => {
    const superAdmin = await user("SUPER_ADMIN");
    const admin = await user("ADMIN");
    const wrong: string[] = [];
    for (const e of SUPER_ADMIN_KEEPS) {
      const s = (await call(e, superAdmin)).status;
      if (s === 401 || s === 403) wrong.push(`SUPER_ADMIN ${e.method} ${e.path} → ${s}`);
      const a = (await call(e, admin)).status;
      if (a !== 403) wrong.push(`ADMIN ${e.method} ${e.path} → ${a} (harus 403)`);
    }
    expect(wrong).toEqual([]);
  });

  it("harga paket dan pengaturan aplikasi tidak ada lagi: tidak ada rute yang menerimanya untuk peran apa pun", async () => {
    const vip = await user("SUPER_ADMIN_VIP");
    const plans = await fetch(`${baseUrl}/api/v1/memberships/admin/plans/GOLD`, {
      method: "PUT",
      headers: headers(vip, "APP"),
      body: JSON.stringify({ price: 1 })
    });
    expect(plans.status).toBe(404);
    const settings = await call({ method: "PUT", path: "/api/v1/admin/app-settings" }, vip);
    expect(settings.status).toBe(404);
    const gold = await prisma.membership.findUniqueOrThrow({ where: { tier: "GOLD" } });
    expect(Number(gold.price)).not.toBe(1);
  });

  it("pengawasan: VIP melihat ringkasan per admin dan peringatan dari audit nyata; log dapat disaring per pelaku", async () => {
    const vip = await user("SUPER_ADMIN_VIP");
    const bendahara = await user("SUPER_ADMIN");
    const lain = await user("SUPER_ADMIN");
    const soon = Date.now() - 60_000;
    for (let i = 0; i < 6; i += 1) {
      await prisma.auditLog.create({
        data: { actorId: bendahara.id, action: "MANUAL_TOPUP_CONFIRMED", entityType: "WALLET_TOPUP_ORDER", entityId: `o${i}`, metadata: { amount: "100000" }, createdAt: new Date(soon - i * 120_000) }
      });
    }
    await prisma.auditLog.create({ data: { actorId: lain.id, action: "WITHDRAWAL_APPROVED", entityType: "WITHDRAWAL", entityId: "w1", metadata: { amount: "50000" } } });

    const res = await fetch(`${baseUrl}/api/v1/admin/dashboard/oversight?hours=24`, { headers: headers(vip) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { admins: Array<{ name: string; total: number; moneyTotal: number }>; alerts: Array<{ key: string; actorId: string }> } };
    const row = body.data.admins.find((a) => a.name === bendahara.fullName)!;
    expect(row).toMatchObject({ total: 6, moneyTotal: 600_000 });
    expect(body.data.alerts.find((a) => a.key === "topup-burst")?.actorId).toBe(bendahara.id);
    expect(body.data.alerts.some((a) => a.actorId === lain.id)).toBe(false);

    const filtered = await fetch(`${baseUrl}/api/v1/admin/audit-logs?actorId=${lain.id}`, { headers: headers(vip) });
    const items = ((await filtered.json()) as { data: { total: number; items: Array<{ action: string; actorName: string }> } }).data;
    expect(items.total).toBe(1);
    expect(items.items[0]).toMatchObject({ action: "WITHDRAWAL_APPROVED", actorName: lain.fullName });

    const tooLong = await fetch(`${baseUrl}/api/v1/admin/dashboard/oversight?hours=9999`, { headers: headers(vip) });
    expect(tooLong.status).toBe(400);
  });
});
