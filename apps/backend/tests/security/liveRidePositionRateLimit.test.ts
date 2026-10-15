import { describe, expect, it } from "vitest";
import { isLiveRidePositionRequest } from "../../src/core/security/rateLimit.js";

describe("rute posisi hidup dikecualikan dari batas IP umum", () => {
  it("mengenali kirim lokasi driver dan baca posisi driver oleh penumpang", () => {
    expect(isLiveRidePositionRequest({ method: "POST", path: "/api/v1/driver/location" })).toBe(true);
    expect(isLiveRidePositionRequest({ method: "GET", path: "/api/v1/rides/RID-ABCDEFGHJK/driver-location" })).toBe(true);
    expect(isLiveRidePositionRequest({ method: "GET", path: "/api/v1/rides/RID-ABCDEFGHJK/driver-location/" })).toBe(true);
  });

  it("tidak meluas ke rute lain yang sensitif (SOS, terima tawaran, login, admin)", () => {
    for (const [method, path] of [
      ["POST", "/api/v1/driver/sos"],
      ["POST", "/api/v1/driver/orders/RID-ABCDEFGHJK/accept"],
      ["GET", "/api/v1/driver/offers"],
      ["POST", "/api/v1/auth/login"],
      ["GET", "/api/v1/rides/RID-ABCDEFGHJK"],
      ["GET", "/api/v1/admin/rides/RID-ABCDEFGHJK/driver-location"],
      ["GET", "/api/v1/driver/location"],
      ["POST", "/api/v1/rides/RID-ABCDEFGHJK/driver-location"],
      ["POST", "/api/v1/driver/location/extra"],
    ] as const) {
      expect(isLiveRidePositionRequest({ method, path }), `${method} ${path}`).toBe(false);
    }
  });
});
