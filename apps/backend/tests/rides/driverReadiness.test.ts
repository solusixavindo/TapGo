import { describe, expect, it } from "vitest";
import { DriverReadinessInput, evaluateDriverReadiness } from "../../src/modules/rides/application/driverReadiness.js";

/**
 * "Driver tidak bisa menerima order" (12 Nov 2026): daftar penyebab yang mungkin, masing-masing harus terdeteksi dengan
 * kode yang sama dengan yang dilihat driver di aplikasi, dan driver yang siap tidak boleh dilaporkan bermasalah.
 */
const READY: DriverReadinessInput = {
  userStatus: "ACTIVE",
  profileStatus: "ACTIVE",
  availability: "ONLINE",
  lastSeenAt: new Date("2026-11-12T10:00:00Z"),
  vehicles: [{ type: "MOTORCYCLE", verificationStatus: "VERIFIED", isActive: true }],
  walletBalance: 50_000,
  faceRecheckDue: false,
  commission: { enabled: true, percent: 8, minCashBalance: 0 },
  now: new Date("2026-11-12T10:03:00Z")
};

const codes = (input: Partial<DriverReadinessInput>) =>
  evaluateDriverReadiness({ ...READY, ...input }).blockers.map((blocker) => blocker.code);

describe("evaluateDriverReadiness", () => {
  it("driver yang siap: tanpa penghalang", () => {
    const result = evaluateDriverReadiness(READY);
    expect(result.canAccept).toBe(true);
    expect(result.blockers).toEqual([]);
    // Saldo Rp50.000 dengan komisi 8% cukup sampai tarif Rp625.000.
    expect(result.notes.join(" ")).toContain("Rp625.000");
  });

  it("profil belum diaktifkan Super Admin (PENDING) adalah penghalang, dengan langkah perbaikan", () => {
    const result = evaluateDriverReadiness({ ...READY, profileStatus: "PENDING" });
    expect(result.canAccept).toBe(false);
    expect(result.blockers[0]).toMatchObject({ code: "RIDE_DRIVER_NOT_ACTIVE" });
    expect(result.blockers[0]!.fix).toContain("Aktifkan driver");
  });

  it("saldo nol saat komisi menyala menolak pesanan tunai", () => {
    expect(codes({ walletBalance: 0 })).toEqual(["RIDE_COMMISSION_BALANCE_INSUFFICIENT"]);
    expect(codes({ walletBalance: null })).toEqual(["RIDE_COMMISSION_BALANCE_INSUFFICIENT"]);
  });

  it("saldo di bawah minimum tunai adalah penghalang tersendiri", () => {
    expect(codes({ walletBalance: 3000, commission: { enabled: true, percent: 8, minCashBalance: 10_000 } })).toEqual(["RIDE_CASH_MIN_BALANCE"]);
  });

  it("saldo kecil tetapi positif bukan penghalang, hanya catatan batas tarif", () => {
    const result = evaluateDriverReadiness({ ...READY, walletBalance: 2000 });
    expect(result.canAccept).toBe(true);
    expect(result.notes.join(" ")).toContain("Rp25.000");
  });

  it("komisi mati: saldo tidak relevan", () => {
    expect(codes({ walletBalance: 0, commission: { enabled: false, percent: 8, minCashBalance: 0 } })).toEqual([]);
  });

  it("kendaraan: tidak ada, belum terverifikasi, atau tidak aktif", () => {
    expect(codes({ vehicles: [] })).toEqual(["RIDE_VEHICLE_NOT_ELIGIBLE"]);
    expect(codes({ vehicles: [{ type: "CAR", verificationStatus: "PENDING", isActive: true }] })).toEqual(["RIDE_VEHICLE_NOT_ELIGIBLE"]);
    expect(codes({ vehicles: [{ type: "CAR", verificationStatus: "VERIFIED", isActive: false }] })).toEqual(["RIDE_VEHICLE_NOT_ELIGIBLE"]);
  });

  it("cek wajah ulang dan akun nonaktif terdeteksi; beberapa penghalang dilaporkan sekaligus", () => {
    expect(codes({ faceRecheckDue: true })).toEqual(["RIDE_DRIVER_FACE_RECHECK_REQUIRED"]);
    expect(codes({ userStatus: "SUSPENDED", profileStatus: "PENDING", walletBalance: 0 })).toEqual([
      "ACCOUNT_NOT_ACTIVE",
      "RIDE_DRIVER_NOT_ACTIVE",
      "RIDE_COMMISSION_BALANCE_INSUFFICIENT"
    ]);
  });

  it("offline atau lokasi basi hanya catatan, bukan penghalang", () => {
    const offline = evaluateDriverReadiness({ ...READY, availability: "OFFLINE" });
    expect(offline.canAccept).toBe(true);
    expect(offline.notes.join(" ")).toContain("offline");
    const stale = evaluateDriverReadiness({ ...READY, now: new Date("2026-11-12T11:00:00Z") });
    expect(stale.canAccept).toBe(true);
    expect(stale.notes.join(" ")).toContain("lebih dari 10 menit");
  });
});
