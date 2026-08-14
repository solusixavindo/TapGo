import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pemilihan operasi pembalikan dana di Midtrans.
 *
 * Midtrans memakai DUA operasi berbeda dan yang benar ditentukan status
 * transaksi, bukan pilihan kita. Memakai yang keliru dijawab "Transaction
 * status cannot be updated" dan uangnya TIDAK bergerak — kegagalan yang diam,
 * karena permintaannya sendiri dijawab 200.
 *
 * Aturan di bawah bukan hasil membaca dokumentasi, melainkan hasil pengujian
 * terhadap sandbox yang hidup:
 *
 *   settlement        -> /refund   (menuntut saldo merchant cukup)
 *   capture, pending  -> /cancel   (pembatalan hari sama)
 *   bank transfer VA  -> ditolak Midtrans untuk refund lewat API
 */

const REQUEST = {
  invoiceNumber: "INV-MBR-20260813-UJI",
  amount: new Prisma.Decimal("500000.00"),
  reason: "Dokumen identitas tidak dapat diverifikasi",
  refundKey: "tapgo-refund-uji"
};

type Call = { url: string; method: string; body: unknown };

let calls: Call[] = [];
let Gateway: typeof import("../../src/modules/payments/application/PaymentRefundGateway.js");

/** Menjawab /status dengan status yang diminta, dan /refund atau /cancel sukses. */
function stubFetch(transactionStatus: string, writeBody?: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({
      url: href,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    });

    if (href.endsWith("/status")) {
      return new Response(
        JSON.stringify({ transaction_status: transactionStatus, transaction_id: "TX-UJI" }),
        { status: 200 }
      );
    }
    return new Response(
      JSON.stringify(
        writeBody ?? { status_code: "200", status_message: "ok", refund_key: "REF-UJI" }
      ),
      { status: 200 }
    );
  });
}

describe("Midtrans refund gateway", () => {
  beforeEach(async () => {
    calls = [];
    process.env.MIDTRANS_SERVER_KEY = "Mid-server-uji-tidak-dipakai-untuk-jaringan";
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-midtrans-refund-gateway";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-midtrans-refund-gateway";
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? "postgresql://user@127.0.0.1:5432/tapgo_test";
    Gateway = await import(
      "../../src/modules/payments/application/PaymentRefundGateway.js"
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("memakai /refund untuk transaksi yang sudah settlement", async () => {
    stubFetch("settlement");
    const result = await new Gateway.MidtransRefundGateway().refund(REQUEST);

    const write = calls.find((call) => call.method === "POST")!;
    expect(write.url).toContain("/refund");
    expect(write.url).not.toContain("/cancel");
    // Kunci idempotensi dan nominal harus ikut terkirim.
    expect(write.body).toMatchObject({
      refund_key: "tapgo-refund-uji",
      amount: 500000
    });
    expect(result.providerReference).toBe("REF-UJI");
  });

  it("memakai /cancel untuk transaksi yang belum settlement", async () => {
    for (const status of ["capture", "pending", "authorize"]) {
      calls = [];
      stubFetch(status);
      await new Gateway.MidtransRefundGateway().refund(REQUEST);

      const write = calls.find((call) => call.method === "POST")!;
      expect(write.url, `status ${status} harus memakai cancel`).toContain("/cancel");
      // Cancel tidak menerima body; mengirimkannya justru ditolak.
      expect(write.body).toBeUndefined();
    }
  });

  it("memperlakukan transaksi yang sudah terbalik sebagai berhasil", async () => {
    for (const status of ["refund", "partial_refund", "cancel", "expire"]) {
      calls = [];
      stubFetch(status);
      const result = await new Gateway.MidtransRefundGateway().refund(REQUEST);

      // Tidak boleh ada permintaan tulis kedua: dananya sudah terbalik.
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
      expect(result.providerReference).toBe("TX-UJI");
    }
  });

  it("meneruskan pesan penolakan penyedia apa adanya", async () => {
    stubFetch("settlement", {
      status_code: "412",
      status_message: "Sorry, your refund request was declined due to merchant insufficient funds."
    });

    await expect(
      new Gateway.MidtransRefundGateway().refund(REQUEST)
    ).rejects.toMatchObject({
      code: "REFUND_PROVIDER_REJECTED",
      // Pesan asli penyedia dipertahankan; admin butuh tahu sebabnya.
      message: expect.stringContaining("insufficient funds")
    });
  });

  it("menolak tanpa kunci penyedia, tanpa menyentuh jaringan", async () => {
    stubFetch("settlement");
    delete process.env.MIDTRANS_SERVER_KEY;
    vi.resetModules();
    const fresh = await import(
      "../../src/modules/payments/application/PaymentRefundGateway.js"
    );

    await expect(new fresh.MidtransRefundGateway().refund(REQUEST)).rejects.toMatchObject({
      code: "REFUND_PROVIDER_NOT_CONFIGURED"
    });
    expect(calls).toHaveLength(0);
  });

  it("menolak jujur untuk DOKU alih-alih menebak alamat endpoint", async () => {
    await expect(new Gateway.DokuRefundGateway().refund()).rejects.toMatchObject({
      code: "REFUND_PROVIDER_NOT_CONFIGURED"
    });
  });
});
