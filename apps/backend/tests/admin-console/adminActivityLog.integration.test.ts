import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { readZip } from "../helpers/zipReader.js";

/**
 * Pemilik (VIP) harus tahu persis apa yang dilakukan admin: masuk, menekan tombol, ditolak, keluar. Aktivitas direkam dari
 * HTTP nyata, dibaca lewat Log Aktivitas, dan dapat diunduh; Admin/Super Admin tidak dapat melihat log sama sekali.
 */
const PASSWORD = "Sandi-Uji-Admin-2026!";
const ZERO = "00000000-0000-4000-8000-000000000000";
let server: Server | undefined;
let baseUrl = "";
let sign: (p: { sub: string; role: UserRole; sessionId: string; channel?: "WEB" | "APP" | "ADMIN" }) => string;
let resetLimits: () => void = () => {};
let seq = 0;

async function user(role: UserRole, withPassword = false): Promise<User> {
  seq += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  const { hashPassword } = await import("../../src/core/security/passwordHasher.js");
  return prisma.user.create({
    data: {
      fullName: `Pelaku ${role} ${seq}`,
      phone: `+62898${String(2000000 + seq)}`,
      referralCode: `ACT${String(seq).padStart(6, "0")}`,
      role,
      membershipId: basic.id,
      ...(withPassword ? { passwordHash: await hashPassword(PASSWORD) } : {})
    }
  });
}
const h = (u: User) => ({
  "content-type": "application/json",
  authorization: `Bearer ${sign({ sub: u.id, role: u.role, sessionId: `s-${u.id}`, channel: "ADMIN" })}`
});
async function logsFor(actorId: string, action?: string, tries = 40) {
  // Penulisan ke database tidak menunggu respons; beri waktu singkat.
  for (let i = 0; i < tries; i += 1) {
    const rows = await prisma.auditLog.findMany({ where: { actorId, ...(action ? { action } : {}) }, orderBy: { createdAt: "asc" } });
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

describe.skipIf(!runIntegration)("Log Aktivitas admin", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) throw new Error("Need dedicated test DB");
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "activity-log-access-secret-000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "activity-log-refresh-secret-00000";
    const [{ createApp }, tokenService, rate] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/core/security/rateLimit.js")
    ]);
    sign = tokenService.signAccessToken as typeof sign;
    const limiters = [rate.adminRateLimiter, rate.apiRateLimiter, rate.authRateLimiter] as unknown as Array<{ resetKey?: (k: string) => void }>;
    resetLimits = () => limiters.forEach((l) => ["127.0.0.1", "::ffff:127.0.0.1", "::1"].forEach((k) => l.resetKey?.(k)));
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);
  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    resetLimits();
  });
  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  it("masuk dan keluar admin tercatat (siapa, kapan, dari IP mana); login gagal juga; member biasa tidak ikut", async () => {
    const admin = await user("SUPER_ADMIN", true);
    const member = await user("USER", true);

    const bad = await fetch(`${baseUrl}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: admin.phone, password: "salah-salah-salah" }) });
    expect(bad.status).toBe(401);
    const ok = await fetch(`${baseUrl}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "KonsolUji/1.0" }, body: JSON.stringify({ phone: admin.phone, password: PASSWORD }) });
    expect(ok.status).toBe(200);
    const { data } = (await ok.json()) as { data: { accessToken: string } };

    const login = (await logsFor(admin.id, "ADMIN_LOGIN"))[0]!;
    expect(login.entityId).toBe(admin.id);
    expect(login.metadata).toMatchObject({ userAgent: "KonsolUji/1.0" });
    expect(await prisma.auditLog.count({ where: { action: "AUTH_LOGIN_FAILED", entityId: admin.id } })).toBe(1);

    const out = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${data.accessToken}` } });
    expect(out.status).toBe(204);
    expect((await logsFor(admin.id, "ADMIN_LOGOUT")).length).toBe(1);

    const mLogin = await fetch(`${baseUrl}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: member.phone, password: PASSWORD }) });
    expect(mLogin.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { actorId: member.id } })).toBe(0);
  });

  it("menekan tombol tercatat rinci (kalimat, hasil, isian dengan rahasia disamarkan); GET penyegaran tidak; ditolak 403 juga tercatat", async () => {
    const superAdmin = await user("SUPER_ADMIN");
    await fetch(`${baseUrl}/api/v1/admin/dashboard/summary`, { headers: h(superAdmin) });
    const reject = await fetch(`${baseUrl}/api/v1/admin/withdrawals/${ZERO}/reject`, {
      method: "POST",
      headers: h(superAdmin),
      body: JSON.stringify({ reason: "Nama rekening tidak sesuai", password: "jangan-bocor" })
    });
    expect(reject.status).toBeGreaterThanOrEqual(400); // id tidak ada; yang dinilai adalah catatannya
    await fetch(`${baseUrl}/api/v1/admin/withdrawals/${ZERO}/paid`, { method: "POST", headers: h(superAdmin), body: "{}" });

    const rows = (await logsFor(superAdmin.id, "ADMIN_REQUEST"));
    await new Promise((r) => setTimeout(r, 300));
    const all = await prisma.auditLog.findMany({ where: { actorId: superAdmin.id, action: "ADMIN_REQUEST" }, orderBy: { createdAt: "asc" } });
    expect(rows.length).toBeGreaterThan(0);
    const labels = all.map((r) => (r.metadata as { label: string }).label);
    expect(labels).toContain("Menolak penarikan dana");
    expect(labels).toContain("Menandai penarikan sudah ditransfer");
    expect(labels.some((l) => l.includes("summary"))).toBe(false);
    expect(all.length).toBe(2); // summary tidak ikut
    const rejectRow = all.find((r) => (r.metadata as { label: string }).label === "Menolak penarikan dana")!;
    const meta = rejectRow.metadata as { body: Record<string, string>; method: string; statusCode: number; ok: boolean };
    expect(meta.method).toBe("POST");
    expect(meta.body).toEqual({ reason: "Nama rekening tidak sesuai", password: "***" });
    expect(JSON.stringify(rejectRow.metadata)).not.toContain("jangan-bocor");
    expect(meta.ok).toBe(false);
  });

  it("Admin/Super Admin tidak dapat melihat log atau mengunduhnya; VIP melihat dan mengunduh Excel dengan saringan", async () => {
    const admin = await user("ADMIN");
    const superAdmin = await user("SUPER_ADMIN");
    const vip = await user("SUPER_ADMIN_VIP");
    for (const path of ["/api/v1/admin/audit-logs", "/api/v1/admin/audit-logs.xlsx", "/api/v1/admin/audit-logs.csv", "/api/v1/admin/dashboard/oversight", "/api/v1/admin/dashboard/activity"]) {
      for (const who of [admin, superAdmin]) {
        expect((await fetch(`${baseUrl}${path}`, { headers: h(who) })).status, `${who.role} ${path}`).toBe(403);
      }
    }

    await fetch(`${baseUrl}/api/v1/admin/withdrawals/${ZERO}/reject`, { method: "POST", headers: h(superAdmin), body: JSON.stringify({ reason: "uji unduh" }) });
    await fetch(`${baseUrl}/api/v1/admin/members`, { headers: h(superAdmin) });
    await logsFor(superAdmin.id, "ADMIN_REQUEST");
    await new Promise((r) => setTimeout(r, 400));

    const list = (await (await fetch(`${baseUrl}/api/v1/admin/audit-logs?actorId=${superAdmin.id}`, { headers: h(vip) })).json()) as { data: { total: number } };
    const hidden = (await (await fetch(`${baseUrl}/api/v1/admin/audit-logs?actorId=${superAdmin.id}&hideReadOnly=true`, { headers: h(vip) })).json()) as { data: { total: number; items: Array<{ metadata: { label: string } }> } };
    // Menolak penarikan + membuka Direktori Member + dua percobaan mengunduh log yang DITOLAK (percobaan akses pun tercatat).
    expect(list.data.total).toBe(4);
    expect(hidden.data.total).toBe(1);
    const denied = (await (await fetch(`${baseUrl}/api/v1/admin/audit-logs?actorId=${superAdmin.id}`, { headers: h(vip) })).json()) as { data: { items: Array<{ metadata: { label: string; statusCode: number } }> } };
    expect(denied.data.items.filter((i) => i.metadata.label === "Mengunduh Log Aktivitas" && i.metadata.statusCode === 403)).toHaveLength(2);
    expect(hidden.data.items[0]!.metadata.label).toBe("Menolak penarikan dana");

    const xlsx = await fetch(`${baseUrl}/api/v1/admin/audit-logs.xlsx?actorId=${superAdmin.id}`, { headers: h(vip) });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("content-disposition")).toContain("tapgo-log-aktivitas.xlsx");
    const sheet = readZip(Buffer.from(await xlsx.arrayBuffer())).get("xl/worksheets/sheet1.xml")!;
    for (const header of ["Waktu (WIB)", "Pelaku", "Golongan", "Uraian", "Metode", "Rute", "Status HTTP", "Alamat IP", "Isian yang dikirim"]) expect(sheet).toContain(`>${header}</t>`);
    expect(sheet).toContain("Menolak penarikan dana");
    expect(sheet).toContain("Membuka Direktori Member");
    expect(sheet).toContain(superAdmin.fullName);
    expect(sheet).not.toContain("jangan-bocor");

    const csv = await fetch(`${baseUrl}/api/v1/admin/audit-logs.csv?actorId=${superAdmin.id}&hideReadOnly=true`, { headers: h(vip) });
    const text = await csv.text();
    expect(text.split("\\n")[0]).toContain("waktu,pelaku,peran,golongan,uraian");
    expect(text).toContain("Menolak penarikan dana");
    expect(text).not.toContain("Membuka Direktori Member");
    // Unduhan log sendiri tercatat sebagai aksi VIP.
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.auditLog.count({ where: { actorId: vip.id, action: "REPORT_EXPORT", entityId: "audit-logs" } })).toBeGreaterThanOrEqual(2);
  });
});
