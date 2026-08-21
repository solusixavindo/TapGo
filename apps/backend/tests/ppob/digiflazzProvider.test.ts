import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  digiflazzSign,
  mapDigiflazzStatus
} from "../../src/modules/ppob/infrastructure/DigiflazzPpobProvider.js";

describe("Digiflazz adapter (unit)", () => {
  // Golden vector: nilai acuan dihitung LANGSUNG dari formula dokumentasi
  // resmi (md5(username + apiKey + ref_id)) lewat implementasi referensi
  // Node, bukan dari fungsi yang diuji — sehingga test gagal bila fungsi
  // menyimpang dari formula.
  it("sign mengikuti formula md5(username + apiKey + ref_id)", () => {
    const reference = (u: string, k: string, r: string) =>
      createHash("md5").update(`${u}${k}${r}`).digest("hex");

    expect(digiflazzSign("username", "apikey", "some1d")).toBe(
      reference("username", "apikey", "some1d")
    );
    expect(digiflazzSign("tapgo", "secret-key", "PPB-A2B3C4D5E6")).toMatch(/^[0-9a-f]{32}$/);
    // Perubahan sekecil apa pun pada ref_id mengubah signature.
    expect(digiflazzSign("tapgo", "secret-key", "PPB-A2B3C4D5E6")).not.toBe(
      digiflazzSign("tapgo", "secret-key", "PPB-A2B3C4D5E7")
    );
  });

  it('status "Sukses" memetakan ke SUCCESS dengan serial number', () => {
    const outcome = mapDigiflazzStatus({
      ref_id: "PPB-A2B3C4D5E6",
      status: "Sukses",
      rc: "00",
      message: "Sukses",
      sn: "SN/2026/08/001"
    });
    expect(outcome).toEqual({
      kind: "SUCCESS",
      providerReference: "PPB-A2B3C4D5E6",
      serialNumber: "SN/2026/08/001"
    });
  });

  it('sn kosong pada "Sukses" tetap SUCCESS dengan serialNumber null', () => {
    const outcome = mapDigiflazzStatus({ ref_id: "PPB-X", status: "Sukses", sn: "" });
    expect(outcome).toMatchObject({ kind: "SUCCESS", serialNumber: null });
  });

  it('status "Pending" memetakan ke PROCESSING', () => {
    expect(mapDigiflazzStatus({ ref_id: "PPB-X", status: "Pending", rc: "03" })).toEqual({
      kind: "PROCESSING",
      providerReference: "PPB-X"
    });
  });

  it('status "Gagal" memetakan ke FAILED dengan rc sebagai failureCode', () => {
    const outcome = mapDigiflazzStatus({
      ref_id: "PPB-X",
      status: "Gagal",
      rc: "07",
      message: "Nomor tidak terdaftar"
    });
    expect(outcome).toEqual({
      kind: "FAILED",
      providerReference: "PPB-X",
      failureCode: "DIGIFLAZZ_RC_07",
      failureReason: "Nomor tidak terdaftar"
    });
  });

  it("status asing dilempar, TIDAK ditebak sukses (fail-closed)", () => {
    expect(() => mapDigiflazzStatus({ ref_id: "PPB-X", status: "Aneh" })).toThrowError(
      /unknown status/
    );
    expect(() => mapDigiflazzStatus({ ref_id: "PPB-X" })).toThrowError(/unknown status/);
  });

  it("pemetaan status toleran terhadap kapitalisasi dan spasi", () => {
    expect(mapDigiflazzStatus({ ref_id: "R", status: " SUKSES " }).kind).toBe("SUCCESS");
    expect(mapDigiflazzStatus({ ref_id: "R", status: "pending" }).kind).toBe("PROCESSING");
    expect(mapDigiflazzStatus({ ref_id: "R", status: "GAGAL" }).kind).toBe("FAILED");
  });
});
