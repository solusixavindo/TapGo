/**
 * Kesiapan seorang driver menerima pesanan, dihitung dari aturan YANG SAMA dengan RideService.acceptOrder
 * (status profil, kendaraan terverifikasi, cek wajah ulang, saldo komisi). Dipakai konsol admin untuk menjawab
 * "kenapa driver ini tidak bisa menerima order?" tanpa menebak. Murni: tidak membaca database, mudah diuji.
 *
 * Kode blocker mengikuti kode error yang dilihat driver di aplikasi supaya admin dan driver membicarakan hal yang sama.
 */

export type ReadinessBlocker = {
  code: string;
  message: string;
  /** Langkah perbaikan untuk admin. */
  fix: string;
};

export type DriverReadiness = {
  canAccept: boolean;
  blockers: ReadinessBlocker[];
  /** Hal yang bukan penghalang tetapi layak diketahui admin. */
  notes: string[];
};

export type DriverReadinessInput = {
  userStatus: string;
  profileStatus: string;
  availability: string;
  lastSeenAt: Date | null;
  vehicles: Array<{ type: string; verificationStatus: string; isActive: boolean }>;
  /** null = belum punya dompet. */
  walletBalance: number | null;
  faceRecheckDue: boolean;
  commission: { enabled: boolean; percent: number; minCashBalance: number };
  now: Date;
};

const STALE_LOCATION_MS = 10 * 60 * 1000;

const rupiah = (value: number) => `Rp${Math.round(value).toLocaleString("id-ID")}`;

export function evaluateDriverReadiness(input: DriverReadinessInput): DriverReadiness {
  const blockers: ReadinessBlocker[] = [];
  const notes: string[] = [];

  if (input.userStatus !== "ACTIVE") {
    blockers.push({
      code: "ACCOUNT_NOT_ACTIVE",
      message: `Akun pengguna berstatus ${input.userStatus}.`,
      fix: "Aktifkan kembali akun di Direktori Member (khusus VIP)."
    });
  }

  if (input.profileStatus !== "ACTIVE") {
    blockers.push({
      code: "RIDE_DRIVER_NOT_ACTIVE",
      message: `Profil driver berstatus ${input.profileStatus}, bukan ACTIVE.`,
      fix: "Setelah pengajuan disetujui, Super Admin harus menekan \"Aktifkan driver\" di Dokumen Mitra."
    });
  }

  const eligibleVehicle = input.vehicles.some((vehicle) => vehicle.verificationStatus === "VERIFIED" && vehicle.isActive);
  if (!eligibleVehicle) {
    blockers.push({
      code: "RIDE_VEHICLE_NOT_ELIGIBLE",
      message: input.vehicles.length === 0 ? "Belum ada kendaraan terdaftar." : "Tidak ada kendaraan yang terverifikasi dan aktif.",
      fix: "Verifikasi kendaraan driver, atau minta driver mengajukan ulang bila datanya belum lengkap."
    });
  }

  if (input.faceRecheckDue) {
    blockers.push({
      code: "RIDE_DRIVER_FACE_RECHECK_REQUIRED",
      message: "Driver wajib melakukan cek wajah ulang sebelum menerima pesanan.",
      fix: "Minta driver membuka aplikasi dan menyelesaikan swafoto verifikasi."
    });
  }

  // Komisi pesanan tunai ditahan dari Saldo TapGo saat pesanan diterima (hanya bila komisi menyala).
  if (input.commission.enabled) {
    const balance = input.walletBalance ?? 0;
    if (input.commission.minCashBalance > 0 && balance < input.commission.minCashBalance) {
      blockers.push({
        code: "RIDE_CASH_MIN_BALANCE",
        message: `Saldo TapGo ${rupiah(balance)}, di bawah minimal ${rupiah(input.commission.minCashBalance)} untuk pesanan tunai.`,
        fix: "Minta driver mengisi Saldo TapGo (top up) di tapgolion.id/topup."
      });
    } else if (balance <= 0) {
      blockers.push({
        code: "RIDE_COMMISSION_BALANCE_INSUFFICIENT",
        message: `Saldo TapGo Rp0: komisi ${input.commission.percent}% tidak dapat ditahan, sehingga pesanan tunai ditolak.`,
        fix: "Minta driver mengisi Saldo TapGo (top up) di tapgolion.id/topup."
      });
    } else {
      const maxFare = Math.floor((balance * 100) / input.commission.percent);
      notes.push(
        `Saldo ${rupiah(balance)} hanya cukup untuk komisi pesanan tunai sampai sekitar ${rupiah(maxFare)} (komisi ${input.commission.percent}%).`
      );
    }
  }

  if (input.availability !== "ONLINE") {
    notes.push(`Driver sedang ${input.availability === "OFFLINE" ? "offline" : input.availability}: tidak menerima tawaran sampai online.`);
  } else if (!input.lastSeenAt || input.now.getTime() - input.lastSeenAt.getTime() > STALE_LOCATION_MS) {
    notes.push("Lokasi terakhir driver sudah lama (lebih dari 10 menit): tawaran berbasis jarak mungkin tidak muncul.");
  }

  return { canAccept: blockers.length === 0, blockers, notes };
}
