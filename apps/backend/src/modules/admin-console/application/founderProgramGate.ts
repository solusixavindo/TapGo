import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";

/**
 * Satu-satunya tempat yang memutuskan apakah Program Founder boleh diubah.
 *
 * Dipanggil di DUA lapis, sengaja: rute HTTP (gagal cepat, sebelum validasi)
 * dan AdminConsoleService (inti). Lapis inti wajib ada karena skrip operasi
 * (scripts/seed-founder-*.ts) memanggil service langsung tanpa lewat rute —
 * saklar yang hanya dipasang di rute akan bisa dilewati begitu saja.
 */
export function assertFounderProgramEnabled(): void {
  if (!env.FOUNDER_PROGRAM_ENABLED) {
    throw new AppError(
      "Program Founder sedang dinonaktifkan",
      StatusCodes.FORBIDDEN,
      "FOUNDER_PROGRAM_DISABLED"
    );
  }
}
