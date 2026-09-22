import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PpobPriceSyncService } from "../../src/modules/ppob/application/PpobPriceSyncService.js";
import {
  PpobPriceSyncCandidate,
  PpobPriceSyncUpdate,
  PpobRepository
} from "../../src/modules/ppob/domain/PpobRepository.js";
import { PpobPriceListEntry, PpobProviderGateway } from "../../src/modules/ppob/domain/ppobProvider.js";

/**
 * Repository dan provider palsu (tanpa DB/HTTP) — mengunci PERILAKU
 * PpobPriceSyncService: apa yang dilewati, apa yang dinonaktifkan, dan apa
 * yang benar-benar ditulis. selectPricingBand/ppobSellingPriceFor sendiri
 * sudah diuji tuntas di tests/finance/ppobPricing.test.ts.
 */
class FakeRepository implements Pick<
  PpobRepository,
  "transaction" | "tryAcquireReconcileLock" | "listProductsForPriceSync" | "applyPriceSyncUpdates"
> {
  lockAvailable = true;
  candidates: PpobPriceSyncCandidate[] = [];
  applied: { updates: PpobPriceSyncUpdate[]; syncedAt: Date }[] = [];

  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return handler({} as Prisma.TransactionClient);
  }
  async tryAcquireReconcileLock(): Promise<boolean> {
    return this.lockAvailable;
  }
  async listProductsForPriceSync(): Promise<PpobPriceSyncCandidate[]> {
    return this.candidates;
  }
  async applyPriceSyncUpdates(updates: PpobPriceSyncUpdate[], syncedAt: Date) {
    this.applied.push({ updates, syncedAt });
    return { updated: updates.length };
  }
}

function candidate(overrides: Partial<PpobPriceSyncCandidate>): PpobPriceSyncCandidate {
  return {
    id: "id-1",
    sku: "SKU_1",
    name: "Produk 1",
    category: "PULSA",
    price: new Prisma.Decimal(0),
    isActive: true,
    providerSku: null,
    providerSkus: null,
    ...overrides
  };
}

function fakeProvider(
  entries: PpobPriceListEntry[],
  opts?: { supportsSync?: boolean; error?: Error }
): PpobProviderGateway {
  return {
    name: "fake",
    purchase: vi.fn(),
    ...(opts?.supportsSync === false
      ? {}
      : {
          fetchPriceList: vi.fn(async () => {
            if (opts?.error) throw opts.error;
            return entries;
          })
        })
  };
}

describe("PpobPriceSyncService — provider tidak mendukung sinkronisasi", () => {
  it("dilewati (skipped) tanpa membaca repository sama sekali", async () => {
    const repo = new FakeRepository();
    const service = new PpobPriceSyncService(repo as unknown as PpobRepository, fakeProvider([], { supportsSync: false }));
    const result = await service.runSyncCycle();
    expect(result).toEqual({ skipped: true, considered: 0, updated: 0, deactivated: 0, reactivated: 0, errors: 0 });
    expect(repo.applied).toHaveLength(0);
  });
});

describe("PpobPriceSyncService — kunci lock", () => {
  it("instance lain sedang menjalankan siklus: dilewati", async () => {
    const repo = new FakeRepository();
    repo.lockAvailable = false;
    repo.candidates = [candidate({ providerSku: "s5" })];
    const service = new PpobPriceSyncService(
      repo as unknown as PpobRepository,
      fakeProvider([{ providerSku: "s5", cost: 5405, buyerProductStatus: true }])
    );
    const result = await service.runSyncCycle();
    expect(result.skipped).toBe(true);
    expect(repo.applied).toHaveLength(0);
  });
});

describe("PpobPriceSyncService — kegagalan mengambil daftar harga", () => {
  it("membatalkan SELURUH siklus, tidak ada satu pun tulisan", async () => {
    const repo = new FakeRepository();
    repo.candidates = [candidate({ providerSku: "s5" })];
    const service = new PpobPriceSyncService(
      repo as unknown as PpobRepository,
      fakeProvider([], { error: new Error("jaringan putus") })
    );
    const result = await service.runSyncCycle();
    expect(result).toEqual({ skipped: false, considered: 0, updated: 0, deactivated: 0, reactivated: 0, errors: 1 });
    expect(repo.applied).toHaveLength(0);
  });
});

describe("PpobPriceSyncService — produk kode tunggal", () => {
  it("harga naik mengikuti kenaikan modal Digiflazz", async () => {
    const repo = new FakeRepository();
    repo.candidates = [
      candidate({ id: "pln100", providerSku: "pln100", price: new Prisma.Decimal("101500") })
    ];
    const service = new PpobPriceSyncService(
      repo as unknown as PpobRepository,
      // Modal naik dari 101095 (lama) menjadi 101600 (baru).
      fakeProvider([{ providerSku: "pln100", cost: 101_600, buyerProductStatus: true }])
    );
    const result = await service.runSyncCycle();
    expect(result).toEqual({ skipped: false, considered: 1, updated: 1, deactivated: 0, reactivated: 0, errors: 0 });
    expect(repo.applied[0]!.updates).toEqual([{ id: "pln100", price: 102_500, isActive: true }]);
  });

  it("harga tidak berubah: TIDAK menulis apa pun (bukan menulis nilai yang sama)", async () => {
    const repo = new FakeRepository();
    // 101095 -> ppobSellingPriceFor = 102000 (lihat tests/finance/ppobPricing.test.ts).
    repo.candidates = [candidate({ id: "pln100", providerSku: "pln100", price: new Prisma.Decimal("102000") })];
    const service = new PpobPriceSyncService(
      repo as unknown as PpobRepository,
      fakeProvider([{ providerSku: "pln100", cost: 101_095, buyerProductStatus: true }])
    );
    const result = await service.runSyncCycle();
    expect(result.updated).toBe(0);
    expect(repo.applied[0]!.updates).toEqual([]);
  });

  it("Digiflazz menutup kode produk (buyerProductStatus=false): dinonaktifkan, harga lama dipertahankan", async () => {
    const repo = new FakeRepository();
    repo.candidates = [candidate({ id: "pln100", providerSku: "pln100", price: new Prisma.Decimal("101500"), isActive: true })];
    const service = new PpobPriceSyncService(
      repo as unknown as PpobRepository,
      fakeProvider([{ providerSku: "pln100", cost: 101_095, buyerProductStatus: false }])
    );
    const result = await service.runSyncCycle();
    expect(result.deactivated).toBe(1);
    expect(repo.applied[0]!.updates).toEqual([{ id: "pln100", price: 101_500, isActive: false }]);
  });

  it("kode produk hilang total dari daftar harga: dinonaktifkan", async () => {
    const repo = new FakeRepository();
    repo.candidates = [candidate({ id: "x", providerSku: "hilang", price: new Prisma.Decimal("5000"), isActive: true })];
    const service = new PpobPriceSyncService(repo as unknown as PpobRepository, fakeProvider([]));
    const result = await service.runSyncCycle();
    expect(result.deactivated).toBe(1);
  });

  it("Digiflazz membuka lagi kode yang tadinya nonaktif: diaktifkan kembali otomatis", async () => {
    const repo = new FakeRepository();
    repo.candidates = [candidate({ id: "x", providerSku: "s5", price: new Prisma.Decimal("6000"), isActive: false })];
    const service = new PpobPriceSyncService(
      repo as unknown as PpobRepository,
      fakeProvider([{ providerSku: "s5", cost: 5405, buyerProductStatus: true }])
    );
    const result = await service.runSyncCycle();
    expect(result.reactivated).toBe(1);
    expect(repo.applied[0]!.updates[0]!.isActive).toBe(true);
  });
});

describe("PpobPriceSyncService — produk multi-operator", () => {
  it("hanya operator yang lolos band harga yang ditulis ke providerSkus", async () => {
    const repo = new FakeRepository();
    repo.candidates = [
      candidate({
        id: "pulsa10k",
        providerSku: null,
        providerSkus: { telkomsel: "s10", axis: "ax10", xl: "x10", smartfren: "sm10", tri: "t10" },
        price: new Prisma.Decimal("11000")
      })
    ];
    const service = new PpobPriceSyncService(
      repo as unknown as PpobRepository,
      fakeProvider([
        { providerSku: "s10", cost: 10_662, buyerProductStatus: true },
        { providerSku: "ax10", cost: 10_857, buyerProductStatus: true },
        { providerSku: "x10", cost: 10_860, buyerProductStatus: true },
        { providerSku: "sm10", cost: 11_140, buyerProductStatus: true },
        { providerSku: "t10", cost: 10_165, buyerProductStatus: true }
      ])
    );
    const result = await service.runSyncCycle();
    expect(result.updated).toBe(1);
    const update = repo.applied[0]!.updates[0]!;
    expect(update.price).toBe(11_500);
    expect(update.providerSkus).toEqual({ telkomsel: "s10", axis: "ax10", xl: "x10" });
  });

  it("operator yang buyerProductStatus=false diperlakukan sebagai tidak tersedia (bukan cost 0)", async () => {
    const repo = new FakeRepository();
    repo.candidates = [
      candidate({
        id: "p",
        providerSkus: { telkomsel: "s5", axis: "ax5" },
        price: new Prisma.Decimal("6000")
      })
    ];
    const service = new PpobPriceSyncService(
      repo as unknown as PpobRepository,
      fakeProvider([
        { providerSku: "s5", cost: 5405, buyerProductStatus: true },
        { providerSku: "ax5", cost: 5882, buyerProductStatus: false }
      ])
    );
    const result = await service.runSyncCycle();
    const update = repo.applied[0]!.updates[0]!;
    expect(update.providerSkus).toEqual({ telkomsel: "s5" });
  });

  it("semua operator hilang/ditutup: dinonaktifkan, peta operator LAMA dipertahankan (bisa hidup lagi)", async () => {
    const repo = new FakeRepository();
    repo.candidates = [
      candidate({
        id: "p",
        providerSkus: { telkomsel: "s5", axis: "ax5" },
        price: new Prisma.Decimal("6000"),
        isActive: true
      })
    ];
    const service = new PpobPriceSyncService(repo as unknown as PpobRepository, fakeProvider([]));
    const result = await service.runSyncCycle();
    expect(result.deactivated).toBe(1);
    const update = repo.applied[0]!.updates[0]!;
    expect(update.isActive).toBe(false);
    expect(update.providerSkus).toBeUndefined(); // tidak menyentuh peta operator
  });

  it("produk multi-operator tanpa satu pun kunci (peta kosong): dilewati sebagai galat, bukan crash", async () => {
    const repo = new FakeRepository();
    repo.candidates = [candidate({ id: "p", providerSkus: {} })];
    const service = new PpobPriceSyncService(repo as unknown as PpobRepository, fakeProvider([]));
    const result = await service.runSyncCycle();
    expect(result.errors).toBe(1);
    expect(repo.applied[0]!.updates).toEqual([]);
  });
});

describe("PpobPriceSyncService — ketahanan per-produk", () => {
  it("satu produk gagal dihitung tidak menggagalkan produk lain dalam siklus yang sama", async () => {
    const repo = new FakeRepository();
    repo.candidates = [
      // providerSkus berbentuk bukan objek (data korup) -> harus gagal per-item, bukan melempar seluruh siklus.
      candidate({ id: "bad", providerSkus: "not-an-object" as unknown as Prisma.JsonValue }),
      candidate({ id: "good", providerSku: "s5", price: new Prisma.Decimal("5000") }) // harga lama, harus diperbarui
    ];
    const service = new PpobPriceSyncService(
      repo as unknown as PpobRepository,
      fakeProvider([{ providerSku: "s5", cost: 5405, buyerProductStatus: true }])
    );
    const result = await service.runSyncCycle();
    expect(result.considered).toBe(2);
    expect(result.updated).toBe(1);
    expect(repo.applied[0]!.updates).toEqual([{ id: "good", price: 6000, isActive: true }]); // 5405 -> 6000
  });
});
