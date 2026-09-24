import { describe, expect, it, vi } from "vitest";
import { PushService, type PushTokenStore } from "../../src/modules/notifications/application/PushService.js";
import {
  FcmClient,
  parseServiceAccount,
  type PushSender
} from "../../src/modules/notifications/infrastructure/FcmClient.js";

function storeWith(tokens: Array<{ id: string; token: string }>) {
  const deleted: string[] = [];
  const store: PushTokenStore = {
    listTokens: async () => tokens,
    deleteTokens: async (ids) => {
      deleted.push(...ids);
    }
  };
  return { store, deleted };
}

describe("PushService", () => {
  it("tidak mengirim apa pun dan tidak melempar saat sender null (kunci belum dipasang)", async () => {
    const { store } = storeWith([{ id: "1", token: "t".repeat(30) }]);
    const listSpy = vi.spyOn(store, "listTokens");
    const service = new PushService(store, null);
    expect(service.enabled).toBe(false);
    await expect(service.notifyUser("u", { title: "a", body: "b" })).resolves.toBeUndefined();
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("mengirim ke semua token dan menghapus hanya token yang ditolak FCM", async () => {
    const { store, deleted } = storeWith([
      { id: "ok", token: "ok-token-" + "x".repeat(20) },
      { id: "dead", token: "dead-token-" + "x".repeat(20) },
      { id: "flaky", token: "flaky-token-" + "x".repeat(20) }
    ]);
    const sender: PushSender = {
      send: async (token) =>
        token.startsWith("dead") ? "invalid_token" : token.startsWith("flaky") ? "failed" : "sent"
    };
    await new PushService(store, sender).notifyUser("u", { title: "a", body: "b" });
    expect(deleted).toEqual(["dead"]);
  });

  it("tidak melempar walau store atau sender gagal", async () => {
    const broken: PushTokenStore = {
      listTokens: async () => {
        throw new Error("db down");
      },
      deleteTokens: async () => undefined
    };
    await expect(
      new PushService(broken, { send: async () => "sent" }).notifyUser("u", { title: "a", body: "b" })
    ).resolves.toBeUndefined();
  });
});

describe("parseServiceAccount", () => {
  const account = { project_id: "p", client_email: "a@p.iam", private_key: "k" };
  it("menerima JSON mentah dan base64", () => {
    expect(parseServiceAccount(JSON.stringify(account))?.client_email).toBe("a@p.iam");
    expect(parseServiceAccount(Buffer.from(JSON.stringify(account)).toString("base64"))?.client_email).toBe("a@p.iam");
  });
  it("mengembalikan null untuk kosong, rusak, atau tanpa kunci", () => {
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount("bukan json")).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: "p" }))).toBeNull();
  });
});

describe("FcmClient", () => {
  function clientWith(status: number, body: unknown = {}) {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const client = new FcmClient("proj", { client_email: "a@p", private_key: "k" }, fetchImpl);
    // token OAuth dipalsukan: yang diuji adalah pemetaan respons FCM.
    (client as unknown as { auth: { getAccessToken: () => Promise<string> } }).auth = {
      getAccessToken: async () => "oauth"
    };
    return { client, fetchImpl };
  }

  it("memetakan 200 -> sent dan mengirim Authorization serta payload notifikasi", async () => {
    const { client, fetchImpl } = clientWith(200);
    expect(await client.send("tok", { title: "Judul", body: "Isi", data: { rideRef: "RID-1" } })).toBe("sent");
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toContain("/projects/proj/messages:send");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer oauth");
    expect(JSON.parse(init.body as string).message.data.rideRef).toBe("RID-1");
  });

  it("memetakan 404 dan 400 INVALID_ARGUMENT -> invalid_token, lainnya -> failed", async () => {
    expect(await clientWith(404).client.send("t", { title: "a", body: "b" })).toBe("invalid_token");
    expect(
      await clientWith(400, { error: { details: [{ errorCode: "INVALID_ARGUMENT" }] } }).client.send("t", { title: "a", body: "b" })
    ).toBe("invalid_token");
    expect(await clientWith(500).client.send("t", { title: "a", body: "b" })).toBe("failed");
    expect(await clientWith(429).client.send("t", { title: "a", body: "b" })).toBe("failed");
  });
});
