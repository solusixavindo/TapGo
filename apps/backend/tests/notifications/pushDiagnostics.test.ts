import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/core/logger/logger.js";
import {
  FcmClient,
  ServiceAccountTokenProvider,
  describePushConfigProblem,
  summarizeGoogleError
} from "../../src/modules/notifications/infrastructure/FcmClient.js";

/**
 * Kejadian 15 Nov 2026: FIREBASE_PROJECT_ID=tapgo-demo di .env produksi, padahal kunci dan aplikasi milik tapgo-c7cb3.
 * Google menolak SEMUA push dengan 403 PERMISSION_DENIED, tetapi server hanya mengembalikan "failed" tanpa jejak, sehingga
 * notifikasi order/chat/saldo mati tanpa ada yang tahu. Tes ini menjaga agar kegagalan seperti itu terbaca di log.
 */
const account = (projectId: string) => ({ project_id: projectId, client_email: `svc@${projectId}.iam.gserviceaccount.com`, private_key: "k" });
const encode = (projectId: string) => JSON.stringify(account(projectId));

const REAL_403 = {
  error: {
    code: 403,
    message: "Permission denied on resource project tapgo-demo.",
    status: "PERMISSION_DENIED",
    details: [
      { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "CONSUMER_INVALID", domain: "googleapis.com" },
      { "@type": "type.googleapis.com/google.rpc.LocalizedMessage", locale: "en-US", message: "Permission denied on resource project tapgo-demo." }
    ]
  }
};

afterEach(() => vi.restoreAllMocks());

describe("describePushConfigProblem", () => {
  it("push sengaja mati (tanpa kunci) bukan masalah", () => {
    expect(describePushConfigProblem({ serviceAccountJson: undefined, projectId: "apa-saja" })).toBeNull();
    expect(describePushConfigProblem({ serviceAccountJson: "   ", projectId: "apa-saja" })).toBeNull();
  });

  it("kunci ada tetapi tidak terbaca", () => {
    expect(describePushConfigProblem({ serviceAccountJson: "{rusak", projectId: undefined })).toContain("tidak terbaca");
  });

  it("proyek di .env berbeda dari proyek di kunci: terdeteksi (kasus nyata tapgo-demo vs tapgo-c7cb3)", () => {
    const problem = describePushConfigProblem({ serviceAccountJson: encode("tapgo-c7cb3"), projectId: "tapgo-demo" });
    expect(problem).toContain("tapgo-demo");
    expect(problem).toContain("tapgo-c7cb3");
    expect(problem).toContain("403");
  });

  it("proyek sama, kosong, atau hanya spasi: wajar", () => {
    expect(describePushConfigProblem({ serviceAccountJson: encode("tapgo-c7cb3"), projectId: "tapgo-c7cb3" })).toBeNull();
    expect(describePushConfigProblem({ serviceAccountJson: encode("tapgo-c7cb3"), projectId: undefined })).toBeNull();
    expect(describePushConfigProblem({ serviceAccountJson: encode("tapgo-c7cb3"), projectId: "  " })).toBeNull();
  });

  it("kunci base64 juga diperiksa", () => {
    const base64 = Buffer.from(encode("tapgo-c7cb3")).toString("base64");
    expect(describePushConfigProblem({ serviceAccountJson: base64, projectId: "tapgo-demo" })).toContain("tapgo-demo");
  });
});

describe("summarizeGoogleError", () => {
  it("mengambil status, alasan, dan pesan dari galat 403 nyata", () => {
    expect(summarizeGoogleError(REAL_403)).toEqual({
      status: "PERMISSION_DENIED",
      reason: "CONSUMER_INVALID",
      message: "Permission denied on resource project tapgo-demo."
    });
  });
  it("tahan terhadap bentuk tak terduga", () => {
    expect(summarizeGoogleError(null)).toEqual({});
    expect(summarizeGoogleError("teks")).toEqual({});
    expect(summarizeGoogleError({ error: "bukan objek" })).toEqual({});
    expect(summarizeGoogleError({ error: { details: "bukan larik" } })).toEqual({});
  });
});

describe("FcmClient mencatat alasan kegagalan", () => {
  function clientWith(responder: () => Response | Promise<Response>) {
    const fetchImpl = vi.fn(async () => responder()) as unknown as typeof fetch;
    const client = new FcmClient("tapgo-demo", { client_email: "a@p", private_key: "k" }, fetchImpl);
    (client as unknown as { auth: { getAccessToken: () => Promise<string> } }).auth = { getAccessToken: async () => "oauth" };
    return client;
  }
  const message = { title: "Pesanan baru di dekat Anda", body: "Rahasia isi pesan 12345", data: { rideReference: "RID-RAHASIA" } };
  const DEVICE_TOKEN = "TOKEN-PERANGKAT-SANGAT-RAHASIA-abc123";

  it("403 PERMISSION_DENIED: hasil failed DAN tercatat dengan proyek, status, dan alasan", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const client = clientWith(() => new Response(JSON.stringify(REAL_403), { status: 403 }));
    expect(await client.send(DEVICE_TOKEN, message)).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, text] = warn.mock.calls[0]! as [Record<string, unknown>, string];
    expect(text).toContain("ditolak");
    expect(fields).toMatchObject({ httpStatus: 403, projectId: "tapgo-demo", status: "PERMISSION_DENIED", reason: "CONSUMER_INVALID" });
  });

  it("log tidak pernah memuat token perangkat maupun isi pesan", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const client = clientWith(() => new Response(JSON.stringify(REAL_403), { status: 403 }));
    await client.send(DEVICE_TOKEN, message);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(DEVICE_TOKEN);
    expect(logged).not.toContain("Rahasia isi pesan");
    expect(logged).not.toContain("RID-RAHASIA");
  });

  it("token mati (404) adalah kejadian biasa: invalid_token dan TIDAK dicatat", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const client = clientWith(() => new Response("{}", { status: 404 }));
    expect(await client.send(DEVICE_TOKEN, message)).toBe("invalid_token");
    expect(warn).not.toHaveBeenCalled();
  });

  it("400 UNREGISTERED juga tidak dicatat; 400 lain (payload salah) dicatat", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const dead = clientWith(() => new Response(JSON.stringify({ error: { details: [{ errorCode: "UNREGISTERED" }] } }), { status: 400 }));
    expect(await dead.send(DEVICE_TOKEN, message)).toBe("invalid_token");
    expect(warn).not.toHaveBeenCalled();
    const bad = clientWith(() => new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "payload salah" } }), { status: 400 }));
    expect(await bad.send(DEVICE_TOKEN, message)).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("kuota 429 dan galat server 503 dicatat sebagai failed", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    for (const status of [429, 503]) {
      const client = clientWith(() => new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status }));
      expect(await client.send(DEVICE_TOKEN, message)).toBe("failed");
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("jaringan putus: failed, tercatat tanpa token", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const client = clientWith(() => {
      throw new Error("connect ETIMEDOUT");
    });
    expect(await client.send(DEVICE_TOKEN, message)).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).toContain("ETIMEDOUT");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(DEVICE_TOKEN);
  });

  it("200: sent dan tidak ada catatan", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const client = clientWith(() => new Response("{}", { status: 200 }));
    expect(await client.send(DEVICE_TOKEN, message)).toBe("sent");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("ServiceAccountTokenProvider mencatat penolakan OAuth", () => {
  it("izin ditolak Google: null dan tercatat (tanpa kunci privat)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid JWT Signature." }), { status: 400 })
    ) as unknown as typeof fetch;
    const provider = new ServiceAccountTokenProvider({ client_email: "svc@p.iam", private_key: privateKey }, "scope", fetchImpl);
    expect(await provider.getAccessToken()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields] = warn.mock.calls[0]! as [Record<string, unknown>];
    expect(fields).toMatchObject({ httpStatus: 400, error: "invalid_grant" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE KEY");
  });
});
