import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DigiflazzPpobProvider,
  mapDigiflazzStatus,
  parseBillInquiry
} from "../../src/modules/ppob/infrastructure/DigiflazzPpobProvider.js";
import { PpobBillInquiryError } from "../../src/modules/ppob/domain/ppobProvider.js";
import {
  classifyPostpaidEntry,
  postpaidSkuFor,
  PpobPriceSyncService
} from "../../src/modules/ppob/application/PpobPriceSyncService.js";
import { normalizePpobTarget } from "../../src/modules/ppob/domain/targetValidation.js";
import { nextWibMidnight } from "../../src/modules/ppob/application/PpobService.js";

const config = { username: "tapgo", apiKey: "secret-key", baseUrl: "https://api.digiflazz.test/v1", testing: true };

function mockFetch(payload: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function lastBody(fn: ReturnType<typeof mockFetch>): Record<string, unknown> {
  const call = fn.mock.calls.at(-1) as unknown as [string, RequestInit];
  return JSON.parse(call[1].body as string);
}

afterEach(() => vi.unstubAllGlobals());

describe("Digiflazz pascabayar — format permintaan", () => {
  it("inq-pasca memakai commands, buyer_sku_code, customer_no, ref_id, sign md5(username+apiKey+ref_id), dan testing", async () => {
    const fn = mockFetch({
      data: { status: "Sukses", rc: "00", customer_name: "BUDI", price: 128500, selling_price: 127350, admin: 2500 }
    });
    await new DigiflazzPpobProvider(config).inquireBill({
      publicReference: "PPB-A2B3C4D5E6",
      providerSku: "bpjs",
      targetNumber: "0000002610115"
    });
    const body = lastBody(fn);
    expect(body).toMatchObject({
      commands: "inq-pasca",
      username: "tapgo",
      buyer_sku_code: "bpjs",
      customer_no: "0000002610115",
      ref_id: "PPB-A2B3C4D5E6",
      testing: true
    });
    expect(body.sign).toBe(createHash("md5").update("tapgosecret-keyPPB-A2B3C4D5E6").digest("hex"));
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe("https://api.digiflazz.test/v1/transaction");
  });

  it("pay-pasca memakai ref_id inquiry yang SAMA dan tanpa flag testing", async () => {
    const fn = mockFetch({ data: { ref_id: "PPB-A2B3C4D5E6", status: "Sukses", rc: "00", selling_price: 127350 } });
    const outcome = await new DigiflazzPpobProvider(config).payBill({
      publicReference: "PPB-A2B3C4D5E6",
      providerSku: "bpjs",
      targetNumber: "0000002610115"
    });
    const body = lastBody(fn);
    expect(body).toMatchObject({ commands: "pay-pasca", ref_id: "PPB-A2B3C4D5E6", buyer_sku_code: "bpjs" });
    expect(body).not.toHaveProperty("testing");
    expect(outcome).toMatchObject({ kind: "SUCCESS", providerCost: 127350 });
  });

  it("cek status transaksi pascabayar memakai status-pasca, prabayar tetap tanpa commands", async () => {
    const fn = mockFetch({ data: { ref_id: "PPB-X", status: "Pending", rc: "03" } });
    const provider = new DigiflazzPpobProvider(config);
    const pasca = await provider.checkStatus({
      publicReference: "PPB-X",
      providerSku: "pdamkota",
      sku: "PSC_X",
      category: "PDAM",
      targetNumber: "5121400300"
    });
    expect(lastBody(fn)).toMatchObject({ commands: "status-pasca", ref_id: "PPB-X" });
    expect(pasca.kind).toBe("PROCESSING");
    await provider.checkStatus({
      publicReference: "PPB-Y",
      providerSku: "tsel10",
      sku: "PULSA_X",
      category: "PULSA",
      targetNumber: "085612345678"
    });
    expect(lastBody(fn)).not.toHaveProperty("commands");
  });

  it("jaringan putus saat inquiry = galat inquiry yang aman (tidak ada uang bergerak)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    await expect(
      new DigiflazzPpobProvider(config).inquireBill({ publicReference: "PPB-A", providerSku: "bpjs", targetNumber: "1" })
    ).rejects.toBeInstanceOf(PpobBillInquiryError);
  });
});

describe("parseBillInquiry", () => {
  it("memakai selling_price sebagai biaya kita dan price - admin sebagai tagihan murni", () => {
    const result = parseBillInquiry(
      {
        status: "Sukses",
        rc: "00",
        customer_name: "John Doe",
        admin: 2500,
        price: 128500,
        selling_price: 127350,
        desc: { kode_cabang: "1013", nama_cabang: "BANJAR", jumlah_peserta: "3", tagihan: { detail: [{ periode: "01" }] } }
      },
      true
    );
    expect(result).toMatchObject({
      customerName: "John Doe",
      billAmount: 126000,
      adminFee: 2500,
      cost: 127350,
      period: "01"
    });
    expect(result.detail).toMatchObject({ nama_cabang: "BANJAR", jumlah_peserta: "3" });
  });

  it("tanpa selling_price memakai price (tidak pernah lebih murah dari yang sebenarnya)", () => {
    expect(parseBillInquiry({ status: "Sukses", price: 40240, admin: 2000 }, true)).toMatchObject({
      cost: 40240,
      billAmount: 38240
    });
  });

  it("fail-closed: status bukan Sukses, tanpa angka, angka tak masuk akal, atau HTTP gagal", () => {
    expect(() => parseBillInquiry({ status: "Gagal", rc: "60" }, true)).toThrow(PpobBillInquiryError);
    expect(() => parseBillInquiry({ status: "Sukses" }, true)).toThrow(PpobBillInquiryError);
    expect(() => parseBillInquiry({ status: "Sukses", price: 0, selling_price: 0 }, true)).toThrow(PpobBillInquiryError);
    expect(() => parseBillInquiry({ status: "Sukses", price: 999_999_999 }, true)).toThrow(PpobBillInquiryError);
    expect(() => parseBillInquiry({ status: "Sukses", price: 1000 }, false)).toThrow(PpobBillInquiryError);
    expect(() => parseBillInquiry(undefined, true)).toThrow(PpobBillInquiryError);
  });

  it("pesan galat aman per kode dan tidak membocorkan pesan mentah penyedia", () => {
    try {
      parseBillInquiry({ status: "Gagal", rc: "60", message: "ERR_INTERNAL biller 10.0.0.3" }, true);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PpobBillInquiryError);
      const e = error as PpobBillInquiryError;
      expect(e.code).toBe("DIGIFLAZZ_RC_60");
      expect(e.userMessage).toContain("belum tersedia");
      expect(e.userMessage).not.toContain("10.0.0.3");
    }
  });
});

describe("mapDigiflazzStatus pascabayar", () => {
  it("providerCost memakai selling_price bila ada, jika tidak price (prabayar tidak berubah)", () => {
    expect(mapDigiflazzStatus({ ref_id: "R", status: "Sukses", price: 128500, selling_price: 127350 })).toMatchObject({ providerCost: 127350 });
    expect(mapDigiflazzStatus({ ref_id: "R", status: "Sukses", price: 20074 })).toMatchObject({ providerCost: 20074 });
  });
});

describe("validasi nomor tujuan kategori pascabayar", () => {
  it("nomor sah diterima dan dinormalkan; isian tak masuk akal ditolak", () => {
    expect(normalizePpobTarget("HP_POSTPAID", "+6281234567890")).toBe("081234567890");
    expect(normalizePpobTarget("TELKOM", "021-1234 5678")).toBe("02112345678");
    expect(normalizePpobTarget("INTERNET", "1234 5678 9012")).toBe("123456789012");
    expect(normalizePpobTarget("PBB", "32.73.010.001.002-0010.0")).toBe("327301000100200100");
    expect(normalizePpobTarget("MULTIFINANCE", " 5171-712/AB 345 ")).toBe("5171-712/AB345");
    expect(normalizePpobTarget("TV", "12345678")).toBe("12345678");
    expect(normalizePpobTarget("GAS", "1234567")).toBe("1234567");
    expect(normalizePpobTarget("EMONEY", "6032123456")).toBe("6032123456");
    expect(normalizePpobTarget("BPJS_TK", "12345678901")).toBe("12345678901");
    for (const [category, bad] of [
      ["HP_POSTPAID", "12345"], ["TELKOM", "123"], ["INTERNET", "12"], ["PBB", "123456"],
      ["MULTIFINANCE", "a b"], ["MULTIFINANCE", "<script>alert(1)</script>"], ["GAS", ""], ["EMONEY", "abc"]
    ] as const) {
      expect(() => normalizePpobTarget(category, bad), `${category} ${bad}`).toThrow();
    }
  });
});

describe("katalog pascabayar", () => {
  it("semua kategori yang diminta Owner dikenali dari brand/nama katalog; yang tak dikenal dilaporkan", () => {
    const cases: Array<[string, string, string | null]> = [
      ["PDAM", "aetra", "PDAM"],
      ["PDAM", "PDAM KAB. PURWOREJO", "PDAM"],
      ["BPJS KESEHATAN", "BPJS KESEHATAN", "BPJS"],
      ["BPJS KETENAGAKERJAAN", "BPJS KETENAGAKERJAAN", "BPJS_TK"],
      ["PLN PASCABAYAR", "Pln Postpaid", "PLN_POSTPAID"],
      ["PLN", "Pln Postpaid", "PLN_POSTPAID"],
      ["PLN NONTAGLIS", "PLN NONTAGLIS PASCA", null],
      ["TELKOM", "Telkom", "TELKOM"],
      ["INTERNET PASCABAYAR", "INDIHOME", "INTERNET"],
      ["TV PASCABAYAR", "TRANSVISION", "TV"],
      ["HP PASCABAYAR", "HALO", "HP_POSTPAID"],
      ["HP PASCABAYAR", "XL PASCABAYAR", "HP_POSTPAID"],
      ["MULTIFINANCE", "BAF", "MULTIFINANCE"],
      ["PBB", "PBB KOTA BANDUNG", "PBB"],
      ["GAS NEGARA", "PGN", "GAS"],
      ["PERTAGAS", "Pertagas", "GAS"],
      ["E-MONEY", "E-Money", "EMONEY"],
      ["KARTU KREDIT", "Kartu Kredit", null]
    ];
    for (const [brand, name, expected] of cases) {
      expect(classifyPostpaidEntry({ brand, name }), `${brand} / ${name}`).toBe(expected);
    }
  });

  it("SKU internal stabil, buram, dan lolos validasi klien", () => {
    const sku = postpaidSkuFor("pdamkab.purworejo");
    expect(sku).toBe(postpaidSkuFor("pdamkab.purworejo"));
    expect(sku).not.toBe(postpaidSkuFor("pdamkab-purworejo"));
    expect(sku).toMatch(/^[A-Z0-9_]{3,40}$/);
  });

  it("sinkronisasi membuat BPJS/PDAM, melaporkan brand lain, dan katalog kosong tidak menonaktifkan apa pun", async () => {
    const calls: unknown[] = [];
    const repository = {
      transaction: async (h: (tx: unknown) => unknown) => h({}),
      tryAcquireReconcileLock: async () => true,
      syncPostpaidCatalog: async (entries: unknown[]) => {
        calls.push(entries);
        return { created: entries.length, updated: 0, deactivated: 0 };
      }
    };
    const entry = (providerSku: string, brand: string, name: string) => ({
      providerSku, brand, name, adminFee: 2000, commission: 500, active: true, description: null
    });
    const provider = {
      name: "x",
      purchase: async () => { throw new Error("no"); },
      fetchPostpaidCatalog: async () => [
        entry("bpjs", "BPJS KESEHATAN", "BPJS KESEHATAN"),
        entry("aetra", "PDAM", "aetra"),
        entry("pln", "PLN PASCABAYAR", "Pln Postpaid"),
        entry("kk", "KARTU KREDIT", "Kartu Kredit A"),
        entry("kk2", "KARTU KREDIT", "Kartu Kredit B")
      ]
    };
    const service = new PpobPriceSyncService(repository as never, provider as never);
    const result = await service.runPostpaidCatalogSync();
    expect(result).toMatchObject({ created: 3, ignoredBrands: { "KARTU KREDIT": 2 }, errors: 0 });

    calls.length = 0;
    const empty = new PpobPriceSyncService(repository as never, { ...provider, fetchPostpaidCatalog: async () => [] } as never);
    expect(await empty.runPostpaidCatalogSync()).toMatchObject({ created: 0, deactivated: 0 });
    expect(calls).toHaveLength(0);

    const failing = new PpobPriceSyncService(repository as never, {
      ...provider,
      fetchPostpaidCatalog: async () => { throw new Error("boom"); }
    } as never);
    expect(await failing.runPostpaidCatalogSync()).toMatchObject({ skipped: false, errors: 1, created: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe("nextWibMidnight", () => {
  it("tengah malam WIB berikutnya sebagai instan UTC", () => {
    // 6 Okt 2026 23:30 WIB = 16:30 UTC -> 7 Okt 00:00 WIB = 6 Okt 17:00 UTC
    expect(nextWibMidnight(new Date("2026-10-06T16:30:00Z")).toISOString()).toBe("2026-10-06T17:00:00.000Z");
    // 6 Okt 2026 00:10 WIB = 5 Okt 17:10 UTC -> 7 Okt 00:00 WIB = 6 Okt 17:00 UTC
    expect(nextWibMidnight(new Date("2026-10-05T17:10:00Z")).toISOString()).toBe("2026-10-06T17:00:00.000Z");
  });
});
