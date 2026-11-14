import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readZip } from "../helpers/zipReader.js";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Ekspor data pengguna, driver, dan transaksi driver (Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir 2).
 * Berisi data pribadi: hanya SUPER_ADMIN, setiap unduhan masuk audit, tidak memuat password/token/rekening.
 */
let server: Server | undefined;
let baseUrl = "";
let signAccessToken: (payload: { sub: string; role: UserRole; sessionId: string }) => string;
let seq = 0;

describe.skipIf(!runIntegration)("Admin console — ekspor pengguna, driver, transaksi driver", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-export-reports";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-export-reports";
    const [{ createApp }, tokenService] = await Promise.all([import("../../src/app.js"), import("../../src/core/security/tokenService.js")]);
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  async function user(role: UserRole, fullName?: string) {
    seq += 1;
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    return prisma.user.create({
      data: {
        fullName: fullName ?? `Pengguna ${seq}`,
        phone: `+62877${String(10000000 + seq)}`,
        referralCode: `EXP${String(seq).padStart(6, "0")}`,
        role,
        membershipId: basic.id,
        passwordHash: "RAHASIA-HASH-JANGAN-BOCOR",
        bankAccount: { bankName: "BCA", accountNumber: "9988776655", accountHolderName: "X" }
      }
    });
  }
  const get = (path: string, who: User) =>
    fetch(`${baseUrl}/api/v1/admin/reports/${path}`, { headers: { authorization: `Bearer ${signAccessToken({ sub: who.id, role: who.role, sessionId: `sess-${who.id}` })}` } });

  it("pengguna: SUPER_ADMIN mengunduh CSV ber-BOM; tanpa password/rekening; sel berawalan = dinetralkan; tercatat di audit", async () => {
    const admin = await user("SUPER_ADMIN");
    const member = await user("USER", "=HYPERLINK(\"x\") Sri Wahyuni");
    await prisma.wallet.create({
      data: { userId: member.id, balance: new Prisma.Decimal(100000), cashBalance: new Prisma.Decimal(50000), lockedBonusBalance: new Prisma.Decimal(20000), depositBalance: new Prisma.Decimal(30000) }
    });
    const res = await get("users.csv", admin);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 agar Excel membaca huruf Indonesia
    const csv = new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("nama,telepon,email,kodeReferral,paket,statusAkun,terdaftar,loginTerakhir,saldoTotal,saldoDapatDitarik,bonusTerkunci,deposit,saldoPpob");
    const row = lines.find((l) => l.includes("Sri Wahyuni"))!;
    expect(row).toContain("\"'=HYPERLINK(");
    expect(row).toContain("\"100000\",\"50000\",\"20000\",\"30000\"");
    expect(csv).not.toContain("RAHASIA-HASH");
    expect(csv).not.toContain("9988776655");
    // Admin sendiri (role bukan USER) tidak ikut.
    expect(csv).not.toContain(admin.phone);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "REPORT_EXPORT", entityId: "users" } });
    expect(audit.actorId).toBe(admin.id);
    expect(audit.metadata).toMatchObject({ rows: 1 });
  });

  it("ADMIN biasa dan pengguna biasa ditolak; tidak ada audit ekspor", async () => {
    const ordinary = await user("USER");
    const plainAdmin = await user("ADMIN");
    for (const path of ["users.csv", "drivers.csv", "driver-transactions.csv"]) {
      expect((await get(path, ordinary)).status).toBe(403);
      expect((await get(path, plainAdmin)).status).toBe(403);
    }
    expect(await prisma.auditLog.count({ where: { action: "REPORT_EXPORT" } })).toBe(0);
  });

  it("driver dan transaksi driver: hanya milik driver; perjalanan selesai dihitung", async () => {
    const admin = await user("SUPER_ADMIN");
    const driverUser = await user("USER", "Driver Satu");
    const driver = await prisma.driver.create({ data: { userId: driverUser.id, status: "OFFLINE", vehicleType: "BIKE", vehiclePlate: "A 1234 BB" } });
    const rider = await user("USER", "Penumpang Biasa");
    const dw = await prisma.wallet.create({ data: { userId: driverUser.id, balance: new Prisma.Decimal(10000), cashBalance: new Prisma.Decimal(10000) } });
    const rw = await prisma.wallet.create({ data: { userId: rider.id, balance: new Prisma.Decimal(5000), cashBalance: new Prisma.Decimal(0) } });
    await prisma.walletTransaction.create({ data: { walletId: dw.id, type: "INCENTIVE_BONUS", amount: new Prisma.Decimal(10000), referenceType: "DRIVER_INCENTIVE", referenceId: "c1" } });
    await prisma.walletTransaction.create({ data: { walletId: rw.id, type: "TOPUP", amount: new Prisma.Decimal(5000) } });

    const drivers = await (await get("drivers.csv", admin)).text();
    const dLines = drivers.trim().split("\n");
    expect(dLines[0]).toBe("nama,telepon,email,statusAkun,statusDriver,verifikasi,kendaraan,plat,perjalananSelesai,ratingRataRata,jumlahPenilaian,terdaftar");
    expect(dLines).toHaveLength(2);
    expect(dLines[1]).toContain("Driver Satu");
    expect(dLines[1]).toContain("A 1234 BB");
    expect(dLines[1]).toContain(`"0"`);
    expect(drivers).not.toContain("RAHASIA-HASH");
    void driver;

    const tx = await (await get("driver-transactions.csv", admin)).text();
    const tLines = tx.trim().split("\n");
    expect(tLines[0]).toBe("tanggal,driver,telepon,jenis,jumlah,referensi");
    expect(tLines).toHaveLength(2);
    expect(tLines[1]).toContain("Driver Satu");
    expect(tLines[1]).toContain("INCENTIVE_BONUS");
    expect(tLines[1]).toContain("DRIVER_INCENTIVE:c1");
    expect(tx).not.toContain("Penumpang Biasa");
    expect(await prisma.auditLog.count({ where: { action: "REPORT_EXPORT" } })).toBe(2);
  });

  it("mengikuti rentang tanggal", async () => {
    const admin = await user("SUPER_ADMIN");
    const old = await user("USER", "Anggota Lama");
    const recent = await user("USER", "Anggota Baru");
    await prisma.user.update({ where: { id: old.id }, data: { createdAt: new Date("2026-01-15T05:00:00Z") } });
    const res = await get("users.csv?dateFrom=2026-01-01T00:00:00Z&dateTo=2026-01-31T23:59:59Z", admin);
    const text = await res.text();
    expect(text).toContain("Anggota Lama");
    expect(text).not.toContain(recent.fullName);
  });

  it("Excel (.xlsx): tiap kolom menjadi sel sendiri, judul Indonesia, angka berupa angka; ADMIN biasa ditolak", async () => {
    const admin = await user("SUPER_ADMIN");
    const plain = await user("ADMIN");
    const member = await user("USER", "Sri Wahyuni");
    await prisma.wallet.create({
      data: { userId: member.id, balance: new Prisma.Decimal(100000), cashBalance: new Prisma.Decimal(50000), lockedBonusBalance: new Prisma.Decimal(20000), depositBalance: new Prisma.Decimal(30000) }
    });
    expect((await get("users.xlsx", plain)).status).toBe(403);

    const res = await get("users.xlsx", admin);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toContain("tapgo-data-pengguna.xlsx");
    const files = readZip(Buffer.from(await res.arrayBuffer()));
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    for (const header of ["Nama", "Telepon", "Bonus Terkunci (Rp)", "Deposit (Rp)", "Terdaftar (WIB)"]) expect(sheet).toContain(`>${header}</t>`);
    expect(sheet).toContain("Sri Wahyuni");
    expect(sheet).toMatch(/<c r="I2" s="2"><v>100000<\/v><\/c>/); // saldoTotal angka
    expect(sheet).not.toContain("RAHASIA-HASH");
    expect(sheet).not.toContain("9988776655");
    expect(await prisma.auditLog.count({ where: { action: "REPORT_EXPORT", entityId: "users" } })).toBe(1);

    // Laporan lama (CSV berkoma) juga tersedia sebagai Excel dengan judul Indonesia.
    const bonus = await get("bonus.xlsx", admin);
    expect(bonus.status).toBe(200);
    const bonusSheet = readZip(Buffer.from(await bonus.arrayBuffer())).get("xl/worksheets/sheet1.xml")!;
    for (const header of ["Nama", "Telepon", "Jenis", "Jumlah (Rp)", "Status", "Tanggal (WIB)"]) expect(bonusSheet).toContain(`>${header}</t>`);
  });
});
