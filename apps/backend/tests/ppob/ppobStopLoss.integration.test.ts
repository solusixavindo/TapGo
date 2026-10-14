import { Prisma, PpobCategory } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { PrismaPpobRepository } from "../../src/modules/ppob/infrastructure/PrismaPpobRepository.js";

/**
 * Pilihan A (keputusan Owner 14 Okt 2026): produk prabayar yang baru saja terjual dengan untung bersih nol atau negatif
 * dinonaktifkan otomatis sampai sinkronisasi harga berikutnya menghitung ulang harganya. Angka bersih dihitung terpisah:
 * jual 11.000 / modal 11.000 = -55; jual 11.000 / modal 10.500 = 396 (di bawah target, tetapi tidak rugi);
 * jual 11.000 / modal 10.300 = 576 (memenuhi target).
 */
let sequence = 0;
const repository = new PrismaPpobRepository(prisma);

async function clean() {
  await prisma.auditLog.deleteMany({ where: { action: "ppob.product.auto_deactivated" } });
  await prisma.ppobBillInquiry.deleteMany();
  await prisma.ppobTransaction.deleteMany();
  await prisma.ppobProduct.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
}

async function seedPending(options: { category?: PpobCategory; total: number; synced: boolean; active?: boolean }) {
  sequence += 1;
  const user = await prisma.user.create({
    data: { fullName: `Stop Loss ${sequence}`, phone: `+6285${String(sequence).padStart(9, "0")}`, referralCode: `STOP${String(sequence).padStart(6, "0")}`, role: "USER" }
  });
  const category = options.category ?? "PULSA";
  const product = await prisma.ppobProduct.create({
    data: {
      sku: `STOP_${sequence}`, category, brand: "Telkomsel", name: "Pulsa uji", price: new Prisma.Decimal(options.total), providerSku: `stop${sequence}`,
      isActive: options.active ?? true, priceSyncedAt: options.synced ? new Date() : null, isPostpaid: category === "BPJS"
    }
  });
  const transaction = await prisma.ppobTransaction.create({
    data: {
      publicReference: `PPOB-STOP-${sequence}`, userId: user.id, productId: product.id, skuSnapshot: product.sku, productNameSnapshot: product.name,
      brandSnapshot: product.brand, category, targetNumber: "081298765432", amount: new Prisma.Decimal(options.total), totalAmount: new Prisma.Decimal(options.total),
      status: "PENDING", provider: "digiflazz"
    }
  });
  return { product, transaction };
}

function succeed(transactionId: string, providerCost?: number) {
  return repository.transaction((tx) =>
    repository.finalizePurchase(
      { transactionId, outcome: { kind: "SUCCESS", providerReference: "DGF-STOP", serialNumber: null, ...(providerCost !== undefined ? { providerCost } : {}) } },
      tx
    )
  );
}

const audits = () => prisma.auditLog.findMany({ where: { action: "ppob.product.auto_deactivated" } });
const isActive = async (id: string) => (await prisma.ppobProduct.findUniqueOrThrow({ where: { id } })).isActive;

describe.skipIf(!runIntegration)("Stop-loss PPOB: produk rugi bersih dinonaktifkan otomatis", () => {
  beforeEach(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    await clean();
  });

  it("rugi bersih pada produk hasil sinkronisasi: produk nonaktif dan jejak audit tercatat", async () => {
    const { product, transaction } = await seedPending({ total: 11_000, synced: true });
    const record = await succeed(transaction.id, 11_000);
    expect(record.status).toBe("SUCCESS"); // penjualan tetap sukses; hanya produknya yang dihentikan

    expect(await isActive(product.id)).toBe(false);
    const logs = await audits();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ entityType: "PpobProduct", entityId: product.sku, actorId: null });
    expect(logs[0]!.metadata).toMatchObject({
      reason: "NET_LOSS", transactionReference: transaction.publicReference, salePrice: 11_000, providerCost: 11_000, netMargin: -55
    });
  });

  it("untung bersih memenuhi target atau hanya di bawah target (tetapi positif): produk tetap aktif", async () => {
    const ok = await seedPending({ total: 11_000, synced: true });
    await succeed(ok.transaction.id, 10_300); // bersih 576
    const low = await seedPending({ total: 11_000, synced: true });
    await succeed(low.transaction.id, 10_500); // bersih 396: dilaporkan di konsol, tidak dihentikan
    expect(await isActive(ok.product.id)).toBe(true);
    expect(await isActive(low.product.id)).toBe(true);
    expect(await audits()).toHaveLength(0);
  });

  it("produk yang belum pernah disinkronkan harganya (katalog awal) tidak disentuh", async () => {
    const { product, transaction } = await seedPending({ total: 11_000, synced: false });
    await succeed(transaction.id, 11_000);
    expect(await isActive(product.id)).toBe(true);
    expect(await audits()).toHaveLength(0);
  });

  it("modal tidak diketahui: tidak ada penilaian dan produk tetap aktif", async () => {
    const { product, transaction } = await seedPending({ total: 11_000, synced: true });
    await succeed(transaction.id);
    expect(await isActive(product.id)).toBe(true);
    expect(await audits()).toHaveLength(0);
  });

  it("pascabayar tidak pernah dinonaktifkan otomatis, walau tagihan melebihi total", async () => {
    const { product, transaction } = await seedPending({ category: "BPJS", total: 101_000, synced: true });
    await succeed(transaction.id, 101_000);
    expect(await isActive(product.id)).toBe(true);
    expect(await audits()).toHaveLength(0);
  });

  it("produk yang sudah nonaktif tidak menambah jejak audit", async () => {
    const { product, transaction } = await seedPending({ total: 11_000, synced: true, active: false });
    await succeed(transaction.id, 11_000);
    expect(await isActive(product.id)).toBe(false);
    expect(await audits()).toHaveLength(0);
  });

  it("finalisasi ulang (webhook ganda) tidak menonaktifkan lagi dan tidak menulis audit kedua", async () => {
    const { product, transaction } = await seedPending({ total: 11_000, synced: true });
    await succeed(transaction.id, 11_000);
    expect(await audits()).toHaveLength(1);

    // Sinkronisasi harga mengaktifkan kembali produk; pengiriman ulang hasil lama tidak boleh mematikannya lagi.
    await prisma.ppobProduct.update({ where: { id: product.id }, data: { isActive: true } });
    const replay = await succeed(transaction.id, 11_000);
    expect(replay.status).toBe("SUCCESS");
    expect(await isActive(product.id)).toBe(true);
    expect(await audits()).toHaveLength(1);
  });
});
