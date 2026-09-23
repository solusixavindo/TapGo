import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorMonitoringService } from "../../src/modules/admin-console/application/ErrorMonitoringService.js";

const BASE_CONFIG = {
  authToken: "token-abc",
  orgSlug: "tapgo",
  apiBaseUrl: "https://sentry.io/api/0",
  projectSlugs: { backend: "tapgo-backend", driver_app: "tapgo-driver-app", user_app: undefined }
};

describe("ErrorMonitoringService (unit)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("melapor belum dikonfigurasi bila token kosong (fail-closed), tapi tetap melapor project mana yang punya slug", async () => {
    const service = new ErrorMonitoringService({ ...BASE_CONFIG, authToken: undefined });
    const result = await service.recentIssues("backend");
    expect(result).toEqual({
      configured: false,
      configuredProjects: ["backend", "driver_app"]
    });
  });

  it("melapor belum dikonfigurasi untuk project yang slug-nya belum diisi, meski token/org ada", async () => {
    const service = new ErrorMonitoringService(BASE_CONFIG);
    const result = await service.recentIssues("user_app");
    expect(result.configured).toBe(false);
  });

  it("configuredProjects() hanya mengembalikan project dengan slug terisi", () => {
    const service = new ErrorMonitoringService(BASE_CONFIG);
    expect(service.configuredProjects().sort()).toEqual(["backend", "driver_app"]);
  });

  it("memanggil Sentry API dengan Authorization Bearer dan memetakan issue, untuk project yang diminta", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify([
          {
            id: "1",
            shortId: "TAPGO-1",
            title: "TypeError: x is not a function",
            culprit: "app.ts in handler",
            level: "error",
            status: "unresolved",
            count: "42",
            userCount: 7,
            firstSeen: "2026-09-20T00:00:00Z",
            lastSeen: "2026-09-23T00:00:00Z",
            permalink: "https://sentry.io/organizations/tapgo/issues/1/"
          }
        ]),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ErrorMonitoringService(BASE_CONFIG);
    const result = await service.recentIssues("driver_app");

    expect(result.configured).toBe(true);
    if (!result.configured) throw new Error("unreachable");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.shortId).toBe("TAPGO-1");

    const [url, init] = fetchMock.mock.calls[0]!;
    // Slug project driver_app dipakai (tapgo-driver-app), bukan project lain.
    expect(String(url)).toContain("/projects/tapgo/tapgo-driver-app/issues/");
    expect(init?.headers).toMatchObject({ authorization: "Bearer token-abc" });
  });

  it("melempar error yang jelas saat Sentry API menjawab non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })));
    const service = new ErrorMonitoringService(BASE_CONFIG);
    await expect(service.recentIssues("backend")).rejects.toThrow(/403/);
  });
});
