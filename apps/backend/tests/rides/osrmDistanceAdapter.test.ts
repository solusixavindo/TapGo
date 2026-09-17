import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OsrmDistanceAdapter, mapOsrmRouteResponse } from "../../src/modules/rides/infrastructure/OsrmDistanceAdapter.js";
import { DistanceEstimate, DistancePort, GeoPoint } from "../../src/modules/rides/domain/ridePorts.js";

const PICKUP: GeoPoint = { lat: -6.12, lng: 106.15 };
const DROPOFF: GeoPoint = { lat: -6.131, lng: 106.141 };

/** DistancePort palsu yang mengembalikan nilai tetap, untuk membuktikan
 * fallback benar-benar dipanggil (bukan hanya tidak melempar). */
class StubFallback implements DistancePort {
  calls = 0;
  async estimate(): Promise<DistanceEstimate> {
    this.calls += 1;
    return {
      distanceMeters: 4242,
      durationSeconds: 600,
      etaSeconds: 150,
      source: "STUB_FALLBACK",
    };
  }
}

describe("mapOsrmRouteResponse (unit)", () => {
  it("mengambil distance/duration dari route pertama saat code Ok", () => {
    const result = mapOsrmRouteResponse({
      code: "Ok",
      routes: [{ distance: 1234.6, duration: 321.4 }],
    });
    expect(result).toEqual({ distanceMeters: 1235, durationSeconds: 321 });
  });

  it("menolak respons dengan code selain Ok (fail-closed, bukan menebak)", () => {
    expect(() =>
      mapOsrmRouteResponse({ code: "NoRoute", routes: [] }),
    ).toThrowError(/tidak valid/);
  });

  it("menolak respons tanpa routes sama sekali", () => {
    expect(() => mapOsrmRouteResponse({ code: "Ok" })).toThrowError(/tidak valid/);
  });

  it("menolak distance/duration non-finite (NaN/undefined)", () => {
    expect(() =>
      mapOsrmRouteResponse({ code: "Ok", routes: [{ distance: NaN, duration: 10 }] }),
    ).toThrowError(/tidak valid/);
    expect(() =>
      mapOsrmRouteResponse({ code: "Ok", routes: [{ duration: 10 }] }),
    ).toThrowError(/tidak valid/);
  });

  it("menyertakan routePolyline saat geometry ada di respons", () => {
    const result = mapOsrmRouteResponse({
      code: "Ok",
      routes: [{ distance: 1000, duration: 200, geometry: "abc123~xyz" }],
    });
    expect(result.routePolyline).toBe("abc123~xyz");
  });

  it("tidak menyertakan key routePolyline sama sekali saat geometry kosong/tidak ada", () => {
    const result = mapOsrmRouteResponse({
      code: "Ok",
      routes: [{ distance: 1000, duration: 200 }],
    });
    expect("routePolyline" in result).toBe(false);
  });
});

describe("OsrmDistanceAdapter (unit, fetch distubbing)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("stub not configured", { status: 500 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mengirim koordinat lng,lat sesuai konvensi OSRM dan mengembalikan hasil jalan asli", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({ code: "Ok", routes: [{ distance: 2000, duration: 400 }] }),
          { status: 200 },
        );
      }),
    );

    const fallback = new StubFallback();
    const adapter = new OsrmDistanceAdapter("http://localhost:5001", fallback);
    const result = await adapter.estimate({
      pickup: PICKUP,
      dropoff: DROPOFF,
      serviceType: "MOTORCYCLE",
    });

    expect(requestedUrl).toContain(
      `/route/v1/driving/${PICKUP.lng},${PICKUP.lat};${DROPOFF.lng},${DROPOFF.lat}`,
    );
    expect(requestedUrl).toContain("overview=full");
    expect(requestedUrl).toContain("geometries=polyline");
    expect(result).toEqual({
      distanceMeters: 2000,
      durationSeconds: 400,
      etaSeconds: 100,
      source: "OSRM_ROAD_V1",
    });
    expect(fallback.calls).toBe(0);
  });

  it("meneruskan routePolyline dari OSRM ke hasil estimate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: "Ok",
            routes: [{ distance: 2000, duration: 400, geometry: "route_geom_encoded" }],
          }),
          { status: 200 },
        ),
      ),
    );

    const fallback = new StubFallback();
    const adapter = new OsrmDistanceAdapter("http://localhost:5001", fallback);
    const result = await adapter.estimate({
      pickup: PICKUP,
      dropoff: DROPOFF,
      serviceType: "MOTORCYCLE",
    });

    expect(result.routePolyline).toBe("route_geom_encoded");
  });

  it("jatuh ke fallback saat OSRM merespons HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503 })));

    const fallback = new StubFallback();
    const adapter = new OsrmDistanceAdapter("http://localhost:5001", fallback);
    const result = await adapter.estimate({
      pickup: PICKUP,
      dropoff: DROPOFF,
      serviceType: "MOTORCYCLE",
    });

    expect(result.source).toBe("STUB_FALLBACK");
    expect(fallback.calls).toBe(1);
  });

  it("jatuh ke fallback saat OSRM merespons code bukan Ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "NoRoute", routes: [] }), { status: 200 }),
      ),
    );

    const fallback = new StubFallback();
    const adapter = new OsrmDistanceAdapter("http://localhost:5001", fallback);
    const result = await adapter.estimate({
      pickup: PICKUP,
      dropoff: DROPOFF,
      serviceType: "MOTORCYCLE",
    });

    expect(result.source).toBe("STUB_FALLBACK");
    expect(fallback.calls).toBe(1);
  });

  it("jatuh ke fallback saat jaringan gagal/timeout (fetch melempar)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    );

    const fallback = new StubFallback();
    const adapter = new OsrmDistanceAdapter("http://localhost:5001", fallback);
    const result = await adapter.estimate({
      pickup: PICKUP,
      dropoff: DROPOFF,
      serviceType: "MOTORCYCLE",
    });

    expect(result.source).toBe("STUB_FALLBACK");
    expect(fallback.calls).toBe(1);
  });

  it("durationSeconds/etaSeconds punya batas bawah 60 detik meski OSRM melaporkan rute sangat pendek", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code: "Ok", routes: [{ distance: 50, duration: 10 }] }),
            { status: 200 },
          ),
      ),
    );

    const fallback = new StubFallback();
    const adapter = new OsrmDistanceAdapter("http://localhost:5001", fallback);
    const result = await adapter.estimate({
      pickup: PICKUP,
      dropoff: DROPOFF,
      serviceType: "MOTORCYCLE",
    });

    expect(result.durationSeconds).toBe(60);
    expect(result.etaSeconds).toBe(60);
  });
});
