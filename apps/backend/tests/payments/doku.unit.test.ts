import { afterEach, describe, expect, it, vi } from "vitest";
import { DokuClient } from "../../src/lib/doku/client.js";
import {
  createDigest,
  signDokuRequest,
  verifyDokuSignature,
} from "../../src/lib/doku/signature.js";

describe("DOKU signature helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates deterministic digest and verifies matching signatures", () => {
    const body = {
      order: {
        invoice_number: "INV-MBR-TEST",
        amount: 500000,
      },
    };
    const signed = signDokuRequest({
      clientId: "BRN-TEST",
      secretKey: "test-secret",
      requestTarget: "/checkout/v1/payment",
      requestId: "req-001",
      requestTimestamp: "2026-07-01T10:00:00Z",
      body,
    });

    expect(signed.digest).toBe(createDigest(body));
    expect(signed.signature).toMatch(/^HMACSHA256=/);
    expect(
      verifyDokuSignature({
        clientId: "BRN-TEST",
        secretKey: "test-secret",
        requestTarget: "/checkout/v1/payment",
        requestId: "req-001",
        requestTimestamp: "2026-07-01T10:00:00Z",
        body,
        signature: signed.signature,
      }),
    ).toBe(true);
  });

  it("rejects signatures when payload is changed", () => {
    const signed = signDokuRequest({
      clientId: "BRN-TEST",
      secretKey: "test-secret",
      requestTarget: "/api/webhooks/doku",
      requestId: "req-002",
      requestTimestamp: "2026-07-01T10:00:00Z",
      body: { transaction: { status: "SUCCESS" } },
    });

    expect(
      verifyDokuSignature({
        clientId: "BRN-TEST",
        secretKey: "test-secret",
        requestTarget: "/api/webhooks/doku",
        requestId: "req-002",
        requestTimestamp: "2026-07-01T10:00:00Z",
        body: { transaction: { status: "FAILED" } },
        signature: signed.signature,
      }),
    ).toBe(false);
  });

  it("rejects missing webhook signature headers", () => {
    const client = new DokuClient({
      clientId: "BRN-TEST",
      secretKey: "test-secret",
      environment: "sandbox",
      integrationMode: "checkout",
      baseUrl: "https://api-sandbox.doku.com",
      enabled: true,
    });

    expect(
      client.verifyWebhookSignature({
        requestTarget: "/api/v1/webhooks/doku",
        body: { transaction: { status: "SUCCESS" } },
        headers: {},
      }),
    ).toBe(false);
  });

  it("checks payment status through configured DOKU base URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        order: { invoice_number: "INV-001" },
        transaction: { status: "SUCCESS" },
      }),
    } as Response);
    const client = new DokuClient({
      clientId: "BRN-TEST",
      secretKey: "test-secret",
      environment: "sandbox",
      integrationMode: "checkout",
      baseUrl: "https://api-sandbox.doku.com",
      enabled: true,
    });

    const status = await client.checkPaymentStatus("INV-001");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-sandbox.doku.com/orders/v1/status/INV-001",
      expect.objectContaining({ method: "GET" }),
    );
    expect(status).toMatchObject({
      order: { invoice_number: "INV-001" },
      transaction: { status: "SUCCESS" },
    });
  });
});
