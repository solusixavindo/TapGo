import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { PPOB_PROVIDER_UNAVAILABLE } from "../domain/ppobModels.js";
import {
  PpobProviderAvailability,
  PpobProviderGateway,
  PpobProviderPurchaseRequest,
  PpobProviderPurchaseResult
} from "../domain/PpobProviderGateway.js";

/**
 * Implementasi fail-closed Stage R2.7: belum ada biller nyata, jadi modul
 * menolak pembelian sebelum saldo disentuh. Stage R2.8 menukar class ini
 * dengan gateway provider sungguhan tanpa mengubah lapisan lain.
 */
export class NoPpobProviderGateway implements PpobProviderGateway {
  getAvailability(): PpobProviderAvailability {
    return {
      available: false,
      reason: "PPOB provider is not connected yet"
    };
  }

  purchase(_request: PpobProviderPurchaseRequest): Promise<PpobProviderPurchaseResult> {
    // Tidak boleh tercapai: PpobOrderService menolak lebih dulu lewat
    // getAvailability(). Tetap fail-closed bila dipanggil langsung.
    throw new AppError(
      "PPOB provider is not connected yet",
      StatusCodes.SERVICE_UNAVAILABLE,
      PPOB_PROVIDER_UNAVAILABLE
    );
  }
}
