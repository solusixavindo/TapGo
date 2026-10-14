import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { ppobMarginStatus, ppobNetMargin } from "../../src/core/finance/ppobMargin.js";
import { ppobSellingPriceFor } from "../../src/core/finance/ppobPricing.js";
import { detectMobileOperator } from "../../src/modules/ppob/domain/operatorDetection.js";

/**
 * Migrasi 20261014190000: 11 paket data baru (Owner 14 Okt 2026). Diuji dengan menjalankan berkas SQL-nya pada tabel
 * bersih: harga harus sama persis dengan hasil sinkronisasi dari modal Digiflazz hari itu, setiap paket terkunci ke
 * satu operator, dan menjalankannya dua kali tidak menggandakan baris.
 */
const migrationSql = readFileSync(resolve(__dirname, "../../prisma/migrations/20261014190000_ppob_data_packages/migration.sql"), "utf8");

const COST_BY_CODE: Record<string, number> = {
  flash2: 21_925, flash3: 27_925, if2: 14_410, if3g30d: 30_250, if5g30d: 30_225, flexs: 31_790,
  axdss2: 10_900, axdj1: 13_660, happy1: 7_455, happy3: 12_490, smdu1: 22_210
};

describe.skipIf(!runIntegration)("Migrasi paket data (11 paket, 6 operator)", () => {
  beforeEach(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    await prisma.ppobBillInquiry.deleteMany();
    await prisma.ppobTransaction.deleteMany();
    await prisma.ppobProduct.deleteMany();
  });

  async function apply() {
    await prisma.$executeRawUnsafe(migrationSql);
  }

  it("menambah 11 paket aktif, satu operator per paket, kode sesuai daftar Digiflazz", async () => {
    await apply();
    const rows = await prisma.ppobProduct.findMany({ where: { category: "DATA" }, orderBy: { sortOrder: "asc" } });
    expect(rows).toHaveLength(11);
    const codes: string[] = [];
    for (const row of rows) {
      expect(row.isActive).toBe(true);
      expect(row.isPostpaid).toBe(false);
      expect(row.providerSku).toBeNull();
      expect(row.priceSyncedAt).toBeNull();
      const map = row.providerSkus as Record<string, string>;
      const operators = Object.keys(map);
      expect(operators).toHaveLength(1);
      // Kunci operator harus dikenali pendeteksi nomor, supaya pembelian tidak ditolak sebagai "operator tidak dikenal".
      expect(["telkomsel", "indosat", "xl", "axis", "tri", "smartfren"]).toContain(operators[0]);
      codes.push(map[operators[0]!]!);
      // Nama dan deskripsi menyebut operatornya, supaya pelanggan tidak salah beli.
      expect(row.name.toLowerCase()).toContain(row.brand.toLowerCase());
      expect(row.description ?? "").toContain("Hanya untuk nomor");
    }
    expect(codes.sort()).toEqual(Object.keys(COST_BY_CODE).sort());
    expect(detectMobileOperator("0812345678")).toBe("telkomsel"); // jaring pengaman: pendeteksi yang sama dipakai backend
  });

  it("harga awal = harga hasil sinkronisasi dan untung bersih memenuhi target Rp500 pada setiap paket", async () => {
    await apply();
    const rows = await prisma.ppobProduct.findMany({ where: { category: "DATA" } });
    for (const row of rows) {
      const code = Object.values(row.providerSkus as Record<string, string>)[0]!;
      const cost = COST_BY_CODE[code]!;
      expect(Number(row.price), `${row.sku} (${code})`).toBe(ppobSellingPriceFor(cost));
      const net = ppobNetMargin({ salePrice: Number(row.price), cost, kind: "PREPAID" });
      expect(ppobMarginStatus(net, "PREPAID"), `${row.sku} bersih ${Math.round(net)}`).toBe("OK");
    }
  });

  it("dijalankan dua kali tidak menggandakan baris dan tidak menimpa produk yang sudah ada", async () => {
    await apply();
    await prisma.ppobProduct.update({ where: { sku: "DATA_XL_FLEX_S" }, data: { price: 99_999, isActive: false } });
    await apply();
    expect(await prisma.ppobProduct.count({ where: { category: "DATA" } })).toBe(11);
    const kept = await prisma.ppobProduct.findUniqueOrThrow({ where: { sku: "DATA_XL_FLEX_S" } });
    expect(Number(kept.price)).toBe(99_999);
    expect(kept.isActive).toBe(false);
  });
});
